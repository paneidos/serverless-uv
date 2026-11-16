import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function fileHash(type: string, path: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
        const hash = createHash(type);
        const stream = createReadStream(path);
        stream.on("error", (error) => {
            if ("code" in error && error.code === "ENOENT") {
                resolve(null);
            } else {
                reject(error);
            }
        });
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}
