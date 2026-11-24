import fs from "node:fs/promises";
import path from "node:path";
import type Serverless from "serverless";
import type Aws from "serverless/aws.js";
import type Plugin from "serverless/classes/Plugin.js";
import { fileHash } from "./hash.js";
import { SpawnResult } from "./spawn.js";
import type { Architecture, ServiceWithUv } from "./types.js";
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
    serverless: Serverless;
    hooks: Plugin.Hooks;
    log: Plugin.Logging["log"];
    aws: Aws;

    constructor(
        serverless: Serverless,
        _options: Serverless.Options,
        { log }: Plugin.Logging,
    ) {
        this.serverless = serverless;
        this.aws = serverless.getProvider("aws");
        this.log = log;
        this.registerProperties();
        this.hooks = {
            "before:package:createDeploymentArtifacts": () =>
                this.compileRequirements(),
            "after:package:createDeploymentArtifacts": () =>
                this.buildRequirements(),
        };
    }

    registerProperties() {
        this.serverless.configSchemaHandler.defineTopLevelProperty("uv", {
            type: "object",
            properties: {
                enabled: { type: "boolean" },
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

    async buildRequirements() {
        const defaultEnabled = (this.serverless.service as ServiceWithUv)
            .initialServerlessConfig.uv?.enabled;
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

        for (const [runtime, architecture] of targets.values()) {
            const baseName = `${requirementsHash}_${architecture}_${runtime}`;
            const directory = path.join(
                this.serviceDirectory,
                ".serverless",
                baseName,
            );
            const completionFile = path.join(
                directory,
                ".completed_requirements",
            );
            if (!(await fileExists(completionFile))) {
                await fs.rm(directory, { recursive: true, force: true });
                await fs.mkdir(directory);
                try {
                    await generateLayer(
                        this.serviceDirectory,
                        this.uvBinaryPath,
                        runtime,
                        architecture,
                        directory,
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
            const zipFile = path.join(
                this.serviceDirectory,
                ".serverless",
                `${baseName}.zip`,
            );
            if (!(await fileExists(zipFile))) {
                try {
                    await zipDirectory(directory, zipFile);
                } catch (e) {
                    await Promise.allSettled([fs.rm(zipFile, { force: true })]);
                    throw e;
                }
            }

            const layerName = this.#getLayerName(runtime, architecture);
            await fs.copyFile(
                zipFile,
                path.join(
                    this.serviceDirectory,
                    ".serverless",
                    `${layerName}.zip`,
                ),
            );

            const layerNameSuffix = `${runtime.replace(".", "")}-${architecture.replace("x86_", "amd")}-uv`;

            this.serverless.service.layers ??= {};
            this.serverless.service.layers[layerName] = {
                architecture,
                artifact: path.join(".serverless", `${layerName}.zip`),
                compatibleRuntimes: [runtime],
                description: "Python requirements generated by serverless-uv",
                name: `${this.serviceName}-${this.stage}-${layerNameSuffix}`,
            };
        }
    }
}

export default UVPlugin;
