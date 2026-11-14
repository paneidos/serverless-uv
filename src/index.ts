import type Serverless from "serverless";
import type Plugin from "serverless/classes/Plugin";

class UVPlugin implements Plugin {
    serverless: Serverless;
    hooks: Plugin.Hooks;

    constructor(serverless: Serverless) {
        this.serverless = serverless;
        this.hooks = {};
    }
}

export default UVPlugin;
