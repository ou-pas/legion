// Reading files dropped on a dropzone, shared by skills and rules. No rendering: only the
// DataTransfer tree traversal and its exclusions. (`toB64`/`bytesOf` moved to `api/base64.ts` when a
// third domain needed them.)
import { toB64 } from "../api/base64.js";

export type DroppedFile = { path: string; b64: string };

/** Last segment of a relative path: the name shown on the chip. */
export function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export async function readEntry(
  entry: FileSystemEntry,
  base: string,
  out: DroppedFile[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) =>
      (entry as FileSystemFileEntry).file(res, rej),
    );
    if (file.name.startsWith(".")) return;
    const buf = await file.arrayBuffer();
    out.push({ path: base ? `${base}/${file.name}` : file.name, b64: toB64(buf) });
  } else if (entry.isDirectory) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries pages by 100: loop until exhausted
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
        reader.readEntries(res, rej),
      );
      if (batch.length === 0) break;
      for (const e of batch) await readEntry(e, base ? `${base}/${entry.name}` : "", out);
    }
  }
}
