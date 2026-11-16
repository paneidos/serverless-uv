import path from "node:path";

import spawn from "./spawn.js";
import type { Architecture } from "./types.js";

async function runUvCommand(serviceDir: string, uvBin: string, args: string[]) {
    return await spawn(uvBin, args, {
        cwd: serviceDir,
    });
}

export async function generateRequirements(
    serviceDir: string,
    uvBin: string,
    requirementsFile: string,
) {
    await runUvCommand(serviceDir, uvBin, [
        "export",
        "--frozen",
        "--no-dev",
        "--no-editable",
        "--no-header",
        "--no-emit-project",
        "-o",
        requirementsFile,
    ]);
}

function pythonPlatform(runtime: string, architecture: Architecture): string {
    switch (architecture) {
        case "x86_64":
            return "x86_64-manylinux_2_34";
        case "arm64":
            return "aarch64-manylinux_2_34";
    }
    throw new Error(`Invalid platform: ${runtime} @ ${architecture}`);
}

export async function generateLayer(
    serviceDir: string,
    uvBin: string,
    runtime: string,
    architecture: Architecture,
    targetDirectory: string,
    requirementsFile: string,
) {
    await runUvCommand(serviceDir, uvBin, [
        "pip",
        "install",
        "--no-build",
        "--no-installer-metadata",
        "--no-compile-bytecode",
        "--python-platform",
        pythonPlatform(runtime, architecture),
        "--python",
        runtime.replace("python", ""),
        "--target",
        path.join(targetDirectory, "python"),
        "-r",
        requirementsFile,
    ]);
}
