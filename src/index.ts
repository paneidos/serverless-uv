import type Serverless from "serverless";
import type Plugin from "serverless/classes/Plugin";

class UVPlugin implements Plugin {
    serverless: Serverless;
    hooks: Plugin.Hooks;
    log: Plugin.Logging["log"];

    constructor(
        serverless: Serverless,
        _options: Serverless.Options,
        { log }: Plugin.Logging,
    ) {
        this.serverless = serverless;
        this.log = log;
        this.registerProperties();
        this.hooks = {};
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
}

export default UVPlugin;
