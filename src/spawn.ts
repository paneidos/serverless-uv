import type child_process from "node:child_process";
import crossSpawn from "cross-spawn";

export class SpawnResult {
    code?: number;
    std: Buffer;
    stdout: Buffer;
    stderr: Buffer;

    constructor() {
        this.std = Buffer.alloc(0);
        this.stdout = Buffer.alloc(0);
        this.stderr = Buffer.alloc(0);
    }
}

export default function spawn(
    command: string,
    args?: readonly string[],
    options?: child_process.SpawnOptions,
): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
        const process = crossSpawn(command, args, options);
        const result = new SpawnResult();

        if (process.stdout != null) {
            process.stdout.on("data", (chunk) => {
                result.std = Buffer.concat([result.std, chunk]);
                result.stdout = Buffer.concat([result.stdout, chunk]);
            });
        }

        if (process.stderr != null) {
            process.stderr.on("data", (chunk) => {
                result.std = Buffer.concat([result.std, chunk]);
                result.stderr = Buffer.concat([result.stderr, chunk]);
            });
        }

        process.on("close", (code, signal) => {
            result.code = code ?? (signal == null ? -1 : 0);

            if (result.code === 0) {
                resolve(result);
            } else {
                reject(result);
            }
        });
    });
}
