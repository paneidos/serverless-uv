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
};

export type ServiceWithUv = {
    // Custom properties are not copied to base service
    initialServerlessConfig: { uv?: PluginConfig };

    provider: Service["provider"] & {
        architecture?: Architecture;
    };
} & Service;
