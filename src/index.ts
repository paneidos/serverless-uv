import fs from "node:fs/promises";
import path from "node:path";
import envPaths, { type Paths } from "env-paths";
import type Serverless from "serverless";
import type Aws from "serverless/aws.js";
import type Plugin from "serverless/classes/Plugin.js";
import { fileHash } from "./hash.js";
import { SpawnResult } from "./spawn.js";
import type { Architecture, ServerlessWithUv, ServiceWithUv } from "./types.js";
import { generateLayer, generateRequirements } from "./uv.js";
import { zipDirectory } from "./zip.js";

async function fileExists(file: string): Promise<boolean> {
    try {
        await fs.stat(file);
        return true;
    } catch (_e) {
        return false;
    }
}

class UVPlugin implements Plugin {
    serverless: ServerlessWithUv;
    hooks: Plugin.Hooks;
    log: Plugin.Logging["log"];
    aws: Aws;
    envPaths: Paths;

    constructor(
        serverless: Serverless,
        _options: Serverless.Options,
        { log }: Plugin.Logging,
    ) {
        this.serverless = serverless as ServerlessWithUv;
        this.aws = serverless.getProvider("aws");
        this.log = log;
        this.envPaths = envPaths("serverless-uv", { suffix: "" });
        this.registerProperties();
        this.hooks = {
            "before:package:createDeploymentArtifacts": () =>
                this.compileRequirements(),
            "after:package:createDeploymentArtifacts": () =>
                this.buildRequirements(),
        };
    }

    registerProperties() {
        this.serverless.configSchemaHandler.defineCustomProperties({
            properties: {
                uv: {
                    type: "object",
                    properties: {
                        enabled: { type: "boolean" },
                        globalCache: { type: "boolean" },
                        cacheDir: { type: "string" },
                    },
                },
            },
        });
        this.serverless.configSchemaHandler.defineFunctionProperties("aws", {
            properties: {
                uv: {
                    type: "object",
                    properties: {
                        enabled: { type: "boolean" },
                    },
                },
            },
        });
    }

    get serviceName(): string {
        return this.serverless.service.service ?? "";
    }

    get stage(): string {
        return this.aws.getStage();
    }

    get uvBinaryPath(): string {
        return "uv";
    }

    get serviceDirectory(): string {
        return this.serverless.serviceDir;
    }

    get requirementsPath(): string {
        return path.join(
            this.serviceDirectory,
            ".serverless",
            "requirements.txt",
        );
    }

    async compileRequirements() {
        try {
            await generateRequirements(
                this.serviceDirectory,
                this.uvBinaryPath,
                this.requirementsPath,
            );
        } catch (e: unknown) {
            if (
                typeof e === "object" &&
                e != null &&
                e instanceof SpawnResult
            ) {
                this.log.error(e.std.toString());
                throw new Error(
                    `Failed to compile requirements.txt, error code: ${e.code}`,
                );
            } else {
                throw new Error(`Failed to compile requirements.txt: ${e}`);
            }
        }
    }

    #getLayerName(runtime: string, architecture: string): string {
        return `uv${runtime.replace(".", "")}${architecture.replace("x86_", "amd")}`;
    }

    #getLayerResourceName(runtime: string, architecture: string): string {
        return this.aws.naming.getLambdaLayerLogicalId(
            this.#getLayerName(runtime, architecture),
        );
    }

    get cacheDir(): string | null {
        const customCacheDir =
            this.serverless.service.custom?.uv?.cacheDir ??
            process.env.SERVERLESS_UV_CACHE_DIR ??
            this.envPaths.cache;
        const cacheEnabled =
            this.serverless.service.custom?.uv?.cacheEnabled ??
            process.env.SERVERLESS_UV_CACHE_ENABLED !== "false";
        return cacheEnabled && customCacheDir !== "" ? customCacheDir : null;
    }

    async buildLayer(
        runtime: string,
        architecture: Architecture,
        requirementsHash: string,
    ) {
        const layerName = this.#getLayerName(runtime, architecture);
        const layerArtifactName =
            this.aws.naming.getLayerArtifactName(layerName);
        const layerArtifactPath = path.join(
            this.serviceDirectory,
            ".serverless",
            layerArtifactName,
        );
        const layerSourcePath = layerArtifactPath.replace(/\.zip$/, "");

        const baseName = `${requirementsHash}_${architecture}_${runtime}`;
        const cacheDir = this.cacheDir;
        const buildSourcePath =
            cacheDir != null ? path.join(cacheDir, baseName) : layerSourcePath;
        const buildArtifactPath =
            cacheDir != null
                ? path.join(cacheDir, `${baseName}.zip`)
                : layerArtifactPath;

        const completionFile = path.join(
            buildSourcePath,
            ".completed_requirements",
        );

        if (!(await fileExists(completionFile))) {
            await fs.rm(buildSourcePath, { recursive: true, force: true });
            await fs.mkdir(buildSourcePath, { recursive: true });
            try {
                await generateLayer(
                    this.serviceDirectory,
                    this.uvBinaryPath,
                    runtime,
                    architecture,
                    buildSourcePath,
                    this.requirementsPath,
                );
            } catch (e) {
                if (e instanceof SpawnResult) {
                    this.log.error(e.std.toString());
                    throw new Error(
                        `Failed to build requirements for ${runtime} @ ${architecture}: exited with code ${e.code}`,
                    );
                }
                throw e;
            }
            await fs.writeFile(completionFile, "");
        }

        if (!(await fileExists(buildArtifactPath))) {
            try {
                await zipDirectory(buildSourcePath, buildArtifactPath);
            } catch (e) {
                await Promise.allSettled([
                    fs.rm(buildArtifactPath, { force: true }),
                ]);
                throw e;
            }
        }

        if (buildSourcePath !== layerSourcePath) {
            await fs.symlink(buildSourcePath, layerSourcePath);
        }

        if (buildArtifactPath !== layerArtifactPath) {
            await fs.symlink(buildArtifactPath, layerArtifactPath);
        }

        const layerNameSuffix = `${runtime.replace(".", "")}-${architecture.replace("x86_", "amd")}-uv`;

        this.serverless.service.layers ??= {};
        this.serverless.service.layers[layerName] = {
            architecture,
            artifact: path.join(".serverless", layerArtifactName),
            compatibleRuntimes: [runtime],
            description: "Python requirements generated by serverless-uv",
            name: `${this.serviceName}-${this.stage}-${layerNameSuffix}`,
        };
    }

    async buildRequirements() {
        const defaultEnabled = (this.serverless.service as ServiceWithUv).custom
            .uv?.enabled;
        const targets = new Map<string, [string, Architecture]>();
        const defaultRuntime = this.serverless.service.provider?.runtime;
        const defaultArchitecture: Architecture | undefined = (
            this.serverless.service as ServiceWithUv
        ).provider.architecture as Architecture | undefined;

        const functions = Object.values(this.serverless.service.functions);
        for (const func of functions) {
            if ((func.uv?.enabled ?? defaultEnabled) === false) {
                continue;
            }
            const runtime = func.runtime ?? defaultRuntime;
            const architecture = (func.architecture ??
                defaultArchitecture ??
                "x86_64") as Architecture;
            if (runtime?.startsWith("python")) {
                targets.set(`${runtime}:${architecture}`, [
                    runtime,
                    architecture,
                ]);
                const layerResource = this.#getLayerResourceName(
                    runtime,
                    architecture,
                );
                func.layers = [{ Ref: layerResource }, ...(func.layers ?? [])];
            }
        }

        const requirementsHash = await fileHash(
            "sha256",
            this.requirementsPath,
        );

        if (requirementsHash == null) {
            throw new Error("Failed to hash requirements");
        }

        for (const [runtime, architecture] of targets.values()) {
            await this.buildLayer(runtime, architecture, requirementsHash);
        }
    }
}

export default UVPlugin;
