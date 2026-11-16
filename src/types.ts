export const ARCHITECTURES = ["arm64", "x86_64"] as const;
export type Architecture = (typeof ARCHITECTURES)[number];

declare module "serverless" {
    interface FunctionDefinition {
        architecture?: Architecture;
        layers?: Array<string | { Ref: string }>;
    }
}
