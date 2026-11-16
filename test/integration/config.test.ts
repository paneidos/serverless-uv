import * as path from "node:path";
import { describe, expect, it } from "@jest/globals";
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

describe("the config schema", () => {
    it("has a top-level uv property", async () => {
        const project = await slsProject("basic");
        expect(configSchema(project).properties).toHaveProperty("uv");
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
            uv: { enabled: false },
            functions: { tardis: { handler: "handler.tardis" } },
        });
        await uvPlugin(project).buildRequirements();
        expect(project.service.functions.tardis.layers).toBeUndefined();
        expect(project.service.layers).toEqual({});
    });

    it("skips a function with uv disabled", async () => {
        const project = await slsProject("basic", {
            functions: {
                tardis: { handler: "handler.tardis", uv: { enabled: false } },
            },
        });
        await uvPlugin(project).buildRequirements();
        expect(project.service.functions.tardis.layers).toBeUndefined();
        expect(project.service.layers).toEqual({});
    });
});
