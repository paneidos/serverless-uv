import * as path from "node:path";
import { describe, expect, it } from "@jest/globals";
import Serverless from "serverless";
import type Plugin from "serverless/classes/Plugin";
import UVPlugin from "../../src/index";

type JsonSchema = {
    properties: Record<string, unknown>;
    patternProperties: Record<string, JsonSchema>;
};

async function slsProject(name: string): Promise<Serverless> {
    const sls = new Serverless({
        serviceDir: path.resolve(__dirname, "../projects/", name),
        configurationFilename: "serverless.yml",
        configuration: {
            service: "basic-test",
            provider: {
                name: "aws",
            },
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
