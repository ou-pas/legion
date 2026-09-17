// Persistent filesystem exposed to agents ONLY through server-side-checked operations.
// Blueprint invariant (§7): folder ACL + separate verbs (read / write / delete), path
// escape blocked, never a raw disk mount. Backend today: local disk under LEGION_DATA.
import fs from "node:fs";
import path from "node:path";

export type FsGrant = {
  folderPath: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
};
export type FsOp = "list" | "read" | "write" | "mkdir" | "delete";

const DATA_ROOT = path.resolve(process.env.LEGION_DATA ?? "data", "fs");

/** Physical root for a project: operator-chosen fsRoot, or the default data dir. */
export function projectRoot(projectSlug: string, fsRoot: string | null): string {
  return fsRoot ? path.resolve(fsRoot) : path.join(DATA_ROOT, projectSlug);
}

/** Normalize an agent-supplied path to a clean absolute-style "/a/b" — no traversal. */
function normalize(p: string): string | null {
  const clean = path.posix.normalize("/" + p.replace(/\\/g, "/"));
  if (clean.includes("..")) return null;
  return clean === "/" ? "/" : clean.replace(/\/+$/, "");
}

function verbAllowed(grant: FsGrant, op: FsOp): boolean {
  if (op === "list" || op === "read") return grant.canRead;
  if (op === "write" || op === "mkdir") return grant.canWrite;
  return grant.canDelete;
}

/** Resolves an agent's relative path ("pr.md") to a granted folder.
 *
 *  The bug of 23/08 (seen on Obs 4, present since at least 20/08): relative paths resolved to "the
 *  first write-granted folder", and the list put the agent's personal folders before the session's
 *  artifacts folder. An agent writing `pr.md` relatively landed silently in `/agents/<name>/`: no
 *  artifact on screen, no PR button, while it believed it had delivered. Same session, the absolute
 *  path landed right.
 *
 *  A relative path now goes to the session's work folder (its artifacts folder, the one of the
 *  `expectedArtifacts` contract), passed explicitly, never inferred from list order. Personal
 *  folders stay reachable by absolute path: writing there is deliberate. */
export function resolveAgentPath(rawPath: string, workFolder: string): string {
  if (!rawPath || rawPath.startsWith("/")) return rawPath;
  return `${workFolder}/${rawPath}`;
}

/** Server-side authorization: the path must sit under a grant allowing the verb.
 *  Overlapping grants: ANY matching grant that allows the verb wins (review #4). */
export function authorize(
  grants: FsGrant[],
  op: FsOp,
  rawPath: string,
): { ok: true; clean: string } | { ok: false; reason: string } {
  const clean = normalize(rawPath);
  if (!clean) return { ok: false, reason: "invalid path" };
  let matchedDenied: string | null = null;
  for (const g of grants) {
    const root = normalize(g.folderPath);
    if (!root) continue;
    const prefix = root === "/" ? "/" : root + "/"; // review #6: "/" must match subpaths
    if (clean === root || clean.startsWith(prefix)) {
      if (verbAllowed(g, op)) return { ok: true, clean };
      matchedDenied = `verb '${op}' not granted on ${root}`;
    }
  }
  return { ok: false, reason: matchedDenied ?? "path outside granted folders" };
}

function diskPath(root: string, clean: string): string {
  const p = path.join(root, clean);
  // belt & suspenders: resolved path must stay inside the root.
  // root + path.sep, not startsWith(root): "…/defaultX" must not pass for "…/default" (review #8).
  const resolved = path.resolve(p);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("path escape");
  return p;
}

const MAX_READ = 512 * 1024;
const MAX_WRITE = 5 * 1024 * 1024;
// Binary writes (slice "artifacts accept binary", 02/09): `write` used to force "utf8", so a PNG
// passed as `content` came out corrupt. `contentBase64` is decoded to a `Buffer` and written with no
// encoding: the bytes in are the bytes out.
//
// A named cap, separate from text: a screenshot weighs 200 KB to 2 MB, and 8 MB leaves room for a
// HiDPI PNG without turning artifacts into general object storage (operator's decision, 02/09: no
// MinIO).
export const MAX_BINARY_WRITE = 8 * 1024 * 1024;
// Binary reads (slice "the brief carries attachments", 02/09): a read always returned "utf8", so a
// PNG read back by the container was corrupt. Same cap as writing: whatever this channel wrote, it
// can read back. The 512 KB text cap stays that of a file a model actually reads.
const MAX_BINARY_READ = MAX_BINARY_WRITE;

/** An object rather than positionals: with three optional arguments of the same type,
 *  `fsExec(root, op, p, undefined, b64)` stops being readable. */
export type FsPayload = {
  /** Text write. */
  content?: string;
  /** Binary write: encoded bytes, never guessed from `content`. */
  contentBase64?: string;
  /** Binary read. The intent comes from the caller (the route knows a `.png` is an image); this
   *  module knows nothing of extensions or MIME types. */
  base64?: boolean;
};

type FsResult = { ok: true; result: unknown } | { ok: false; reason: string };

function listDir(p: string): FsResult {
  if (!fs.existsSync(p)) return { ok: true, result: [] };
  return {
    ok: true,
    result: fs.readdirSync(p, { withFileTypes: true }).map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "dir" : "file",
      size: e.isFile() ? fs.statSync(path.join(p, e.name)).size : undefined,
    })),
  };
}

function readEntry(p: string, base64: boolean | undefined): FsResult {
  const stat = fs.statSync(p);
  if (base64) {
    if (stat.size > MAX_BINARY_READ)
      return { ok: false, reason: `binary file too large (${stat.size} > ${MAX_BINARY_READ})` };
    return {
      ok: true,
      result: { contentBase64: fs.readFileSync(p).toString("base64"), bytes: stat.size },
    };
  }
  if (stat.size > MAX_READ)
    return { ok: false, reason: `file too large (${stat.size} > ${MAX_READ})` };
  return { ok: true, result: fs.readFileSync(p, "utf8") };
}

// Binary first: `contentBase64` is the caller's explicit intent, never guessed from `content`.
function writeEntry(
  p: string,
  content: string | undefined,
  contentBase64: string | undefined,
): FsResult {
  if (contentBase64 !== undefined) {
    const bytes = Buffer.from(contentBase64, "base64");
    if (bytes.length > MAX_BINARY_WRITE)
      return {
        ok: false,
        reason: `binary content too large (${bytes.length} > ${MAX_BINARY_WRITE})`,
      };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
    return { ok: true, result: { written: bytes.length } };
  }
  if ((content ?? "").length > MAX_WRITE) return { ok: false, reason: "content too large" };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content ?? "", "utf8");
  return { ok: true, result: { written: (content ?? "").length } };
}

function mkdirEntry(p: string): FsResult {
  fs.mkdirSync(p, { recursive: true });
  return { ok: true, result: {} };
}

function deleteEntry(p: string): FsResult {
  if (!fs.existsSync(p)) return { ok: false, reason: "not found" };
  const stat = fs.statSync(p);
  if (stat.isDirectory())
    fs.rmdirSync(p); // refuses non-empty dirs — deliberate
  else fs.unlinkSync(p);
  return { ok: true, result: {} };
}

export function fsExec(
  rootDir: string,
  op: FsOp,
  clean: string,
  payload: FsPayload = {},
): FsResult {
  const { content, contentBase64, base64 } = payload;
  const p = diskPath(path.resolve(rootDir), clean);
  try {
    switch (op) {
      case "list":
        return listDir(p);
      case "read":
        return readEntry(p, base64);
      case "write":
        return writeEntry(p, content, contentBase64);
      case "mkdir":
        return mkdirEntry(p);
      case "delete":
        return deleteEntry(p);
    }
  } catch (err) {
    return { ok: false, reason: String((err as Error).message) };
  }
}
