import type Serverless from "serverless";
import type Service from "serverless/classes/Service.js";

export const ARCHITECTURES = ["arm64", "x86_64"] as const;
export type Architecture = (typeof ARCHITECTURES)[number];

declare module "serverless" {
    interface FunctionDefinition {
        architecture?: Architecture;
        layers?: Array<string | { Ref: string }>;

        uv?: {
            enabled?: boolean;
        };
    }
}

export type PluginConfig = {
    enabled?: boolean;
    cacheDir?: string;
    cacheEnabled?: boolean;
};

export type ServiceWithUv = {
    provider: Service["provider"] & {
        architecture?: Architecture;
    };

    custom: Service["custom"] & { uv: PluginConfig };
} & Service;

export type ServerlessWithUv = Serverless & {
    service?: ServiceWithUv;
};
