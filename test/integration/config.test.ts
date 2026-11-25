import fs from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import Serverless from "serverless";
import type Plugin from "serverless/classes/Plugin.js";
import UVPlugin from "../../src/index.js";

type JsonSchema = {
    properties: Record<string, unknown>;
    patternProperties: Record<string, JsonSchema>;
};

async function slsProject(
    name: string,
    configuration: Record<string, unknown> = {},
): Promise<Serverless> {
    const sls = new Serverless({
        serviceDir: path.resolve(import.meta.dirname, "../projects/", name),
        configurationFilename: "serverless.yml",
        configuration: {
            service: "basic-test",
            provider: {
                name: "aws",
                runtime: "python3.13",
            },
            ...configuration,
        },
        commands: [],
        options: {},
        log: {
            info: () => {},
        },
    });
    await sls.init();
    sls.pluginManager.addPlugin(UVPlugin as unknown as Plugin.PluginStatic);
    return sls;
}

async function copyProject(name: string): Promise<string> {
    const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), `serverless-uv-${name}-`),
    );
    await fs.cp(path.resolve(import.meta.dirname, "../projects/", name), dir, {
        recursive: true,
    });
    return dir;
}

function uvPlugin(sls: Serverless): UVPlugin {
    const plugin = sls.pluginManager.plugins.find((p) => p instanceof UVPlugin);
    if (plugin == null) {
        throw new Error("UVPlugin was not loaded");
    }
    return plugin as UVPlugin;
}

function configSchema(sls: Serverless): JsonSchema {
    return (sls.configSchemaHandler as unknown as { schema: JsonSchema })
        .schema;
}

// Keep tests out of the user-level cache dir.
let testCacheDir: string;
const originalCacheDir = process.env.SERVERLESS_UV_CACHE_DIR;

beforeAll(async () => {
    testCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "serverless-uv-"));
    process.env.SERVERLESS_UV_CACHE_DIR = testCacheDir;
});

afterAll(async () => {
    if (originalCacheDir === undefined) {
        delete process.env.SERVERLESS_UV_CACHE_DIR;
    } else {
        process.env.SERVERLESS_UV_CACHE_DIR = originalCacheDir;
    }
    await fs.rm(testCacheDir, { recursive: true, force: true });
});

describe("the config schema", () => {
    it("has a uv property under custom", async () => {
        const project = await slsProject("basic");
        const custom = configSchema(project).properties.custom as JsonSchema;
        expect(custom.properties).toHaveProperty("uv");
    });

    it("has a uv property on functions", async () => {
        const project = await slsProject("basic");
        const functions = configSchema(project).properties
            .functions as JsonSchema;
        const [functionSchema] = Object.values(functions.patternProperties);
        expect(functionSchema.properties).toHaveProperty("uv");
    });
});

describe("building requirements", () => {
    it("skips every function when uv is disabled globally", async () => {
        const project = await slsProject("basic", {
            custom: { uv: { enabled: false } },
            functions: { hello: { handler: "handler.hello" } },
        });
        await uvPlugin(project).buildRequirements();
        expect(project.service.functions.hello.layers).toBeUndefined();
        expect(project.service.layers).toEqual({});
    });

    it("skips a function with uv disabled", async () => {
        const project = await slsProject("basic", {
            functions: {
                hello: { handler: "handler.hello", uv: { enabled: false } },
            },
        });
        await uvPlugin(project).buildRequirements();
        expect(project.service.functions.hello.layers).toBeUndefined();
        expect(project.service.layers).toEqual({});
    });
});

describe("building a layer", () => {
    let serviceDir: string;

    beforeAll(async () => {
        serviceDir = await copyProject("basic");
        // An empty requirements file lets uv run without network or a lockfile.
        await fs.mkdir(path.join(serviceDir, ".serverless"));
        await fs.writeFile(
            path.join(serviceDir, ".serverless", "requirements.txt"),
            "",
        );
    });

    afterAll(async () => {
        await fs.rm(serviceDir, { recursive: true, force: true });
    });

    it("builds the layer into the cache dir and links it", async () => {
        const project = await slsProject(serviceDir, {
            functions: { hello: { handler: "handler.hello" } },
        });
        await uvPlugin(project).buildRequirements();

        expect(project.service.layers.uvpython313amd64).toMatchObject({
            architecture: "x86_64",
            artifact: path.join(".serverless", "uvpython313amd64.zip"),
            compatibleRuntimes: ["python3.13"],
        });
        expect(project.service.functions.hello.layers).toEqual([
            { Ref: "Uvpython313amd64LambdaLayer" },
        ]);

        const artifact = path.join(
            serviceDir,
            ".serverless",
            "uvpython313amd64.zip",
        );
        const target = await fs.readlink(artifact);
        expect(path.dirname(target)).toBe(testCacheDir);
        expect(target).toMatch(/_x86_64_python3\.13\.zip$/);
        expect((await fs.stat(target)).size).toBeGreaterThan(0);
    }, 60_000);
});

describe("building a layer twice", () => {
    let serviceDir: string;

    beforeAll(async () => {
        serviceDir = await copyProject("basic");
        await fs.mkdir(path.join(serviceDir, ".serverless"));
        await fs.writeFile(
            path.join(serviceDir, ".serverless", "requirements.txt"),
            "",
        );
    });

    afterAll(async () => {
        await fs.rm(serviceDir, { recursive: true, force: true });
    });

    it("reuses the links from the first build", async () => {
        const build = async () => {
            const project = await slsProject(serviceDir, {
                functions: { hello: { handler: "handler.hello" } },
            });
            await uvPlugin(project).buildRequirements();
            return fs.readlink(
                path.join(serviceDir, ".serverless", "uvpython313amd64.zip"),
            );
        };

        const first = await build();
        const second = await build();
        expect(second).toBe(first);
        // Replacing the link must not delete the cached build behind it.
        await expect(
            fs.stat(
                path.join(
                    first.replace(/\.zip$/, ""),
                    ".completed_requirements",
                ),
            ),
        ).resolves.toBeDefined();
    }, 60_000);
});

describe("the cache dir", () => {
    it("uses the dir from the environment", async () => {
        const project = await slsProject("basic");
        expect(uvPlugin(project).cacheDir).toBe(testCacheDir);
    });

    it("prefers the dir from custom config", async () => {
        const project = await slsProject("basic", {
            custom: { uv: { cacheDir: "/tmp/ci-cache" } },
        });
        expect(uvPlugin(project).cacheDir).toBe("/tmp/ci-cache");
    });

    it("is null when caching is disabled", async () => {
        const project = await slsProject("basic", {
            custom: { uv: { cacheEnabled: false } },
        });
        expect(uvPlugin(project).cacheDir).toBeNull();
    });
});
