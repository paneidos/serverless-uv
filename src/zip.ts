import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";

export async function zipDirectory(
    directory: string,
    target: string,
): Promise<void> {
    const zipfile = new yazl.ZipFile();
    const written = pipeline(zipfile.outputStream, createWriteStream(target));
    for await (const file of fs.glob("**", {
        cwd: directory,
        withFileTypes: true,
    })) {
        const fullPath = path.join(file.parentPath, file.name);
        if (fullPath === directory) {
            continue;
        }
        const relativeDir = path.relative(directory, file.parentPath);
        const relativePath = path.join(relativeDir, file.name);
        if (file.isFile()) {
            const fileStat = await fs.stat(fullPath);
            zipfile.addFile(fullPath, relativePath, {
                mode: fileStat.mode,
            });
        } else if (file.isDirectory()) {
            zipfile.addEmptyDirectory(relativePath);
        }
    }
    zipfile.end();
    await written;
}
