// Brief attachments: files the operator attaches to a task.
//
// Not to be confused with an artifact: an artifact is a deliverable, produced by a session, read
// by the human at review. An attachment is an input: a screenshot of the defect, a CSV export, the
// mock-up to follow. Both live in the same run folder (`taskArtifactsDir`, the one agent grants
// cover), because inventing a second file channel for the same bytes would be the beginning of the
// end, but attachments live under an `attachments/` prefix, for three concrete reasons:
//
//  1. the Artifacts view must be able to say "attached by the operator" versus "dropped by the
//     agent" without guessing from a file name;
//  2. `expectedArtifacts` (a step's contract) must never be satisfied by a file the human dropped;
//  3. the existing artifact list only keeps root-level files, so a subfolder drops out by itself,
//     with no filter to maintain on the other side.
//
// The agent reaches them through its usual grants: `/artifacts/<scope>` is granted read, and
// `authorize` (fs-acl.ts) covers subpaths. Nothing new on the ACL side.
import fs from "node:fs";
import path from "node:path";
import { artifactKind, artifactMimeType, type ArtifactKind } from "./artifacts/mime.js";
import { artifactsPath } from "./artifacts/scope.js";
import { taskArtifactsDir } from "./artifacts/dir.js";
import { MAX_BINARY_WRITE } from "../projects/fs-acl.js";

/** The subfolder, relative to the run's artifacts folder. Named in one place. */
export const ATTACHMENTS_SUBDIR = "attachments";

/** The cap, named, and the same as the binary write channel's (slice 1): what an agent can drop,
 *  the operator can attach, and vice versa. Two caps for the same bytes would have produced an
 *  incomprehensible refusal on one side of the mirror. */
export const MAX_ATTACHMENT_BYTES = MAX_BINARY_WRITE;

/** A file name stays a file name: no path, no accent, no space. 120 characters is wide for
 *  "screenshot-board-2026-09-02.png" and short against ext4's 255 limit; the margin is for a future
 *  rename suffix, never for a novel. */
export const MAX_ATTACHMENT_NAME = 120;

export type Attachment = {
  name: string;
  size: number;
  mimeType: string;
  kind: ArtifactKind;
  /** The path the agent will use (`fs_read`), not the disk path: that makes the mention in the brief
   *  actionable rather than descriptive. */
  path: string;
};

/** The name the file will be stored under: sanitised, never refused for an accent.
 *
 *  Why sanitise rather than refuse: an operator's files are called "Capture d'écran 2026-09-02 à
 *  10.32.png". Refusing that name refuses the gesture. So it is brought back to a file name's
 *  alphabet, and the kept name is returned so the screen shows what really exists.
 *
 *  The function is idempotent, and that is not style: the stored name is what the read and delete
 *  routes pass through here again. If it changed on the second pass, an attached file would become
 *  unfindable. */
export function attachmentName(raw: unknown): string | null {
  const base = path.basename(
    String(raw ?? "")
      .trim()
      .replace(/\\/g, "/"),
  );
  const cleaned = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // é → e, rather than one more dash
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, MAX_ATTACHMENT_NAME);
  return cleaned.length > 0 ? cleaned : null;
}

const dirOf = (artifactsDir: string): string => path.join(artifactsDir, ATTACHMENTS_SUBDIR);

function describe(name: string, size: number, artifactsPath: string): Attachment {
  return {
    name,
    size,
    mimeType: artifactMimeType(name),
    kind: artifactKind(name),
    path: `${artifactsPath}/${ATTACHMENTS_SUBDIR}/${name}`,
  };
}

/** A run's attachments, sorted by name (a `readdir` order is not an order). `artifactsPath` is the
 *  path seen by the agent (`/artifacts/<scope>`), `artifactsDir` the disk folder: both are needed,
 *  and neither derives from the other here. */
export function listAttachments(artifactsDir: string, artifactsPath: string): Attachment[] {
  const dir = dirOf(artifactsDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => describe(e.name, fs.statSync(path.join(dir, e.name)).size, artifactsPath))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A task's attachments, the entry point the spec build uses. It lives here rather than at the
 *  caller: where a task's attachments are stored is this module's knowledge, and recomposing it
 *  elsewhere (project root + run path + subfolder) would make two places to fix when storage
 *  changes. */
export function taskAttachments(taskId: string): Attachment[] {
  const ctx = taskArtifactsDir(taskId);
  return ctx ? listAttachments(ctx.dir, artifactsPath(ctx.task)) : [];
}

export type SaveResult =
  | { ok: true; attachment: Attachment; replaced: boolean }
  | { ok: false; reason: string };

/** Stores an attached file. Content arrives as base64, the same transport as slice 1's binary
 *  channel (`contentBase64`), deliberately: multipart here would make two transports for one
 *  channel, hence two refusal paths, two caps and two ways to get it wrong.
 *
 *  A taken name is replaced, and the response says so (`replaced`). Attaching the same file twice
 *  is someone fixing their screenshot; inventing a "capture-2.png" would grow a list of duplicates
 *  nobody reads. */
export function saveAttachment(
  artifactsDir: string,
  artifactsPath: string,
  rawName: unknown,
  contentBase64: unknown,
): SaveResult {
  const name = attachmentName(rawName);
  if (!name) return { ok: false, reason: "file name empty or unreadable" };
  if (typeof contentBase64 !== "string" || contentBase64.length === 0)
    return { ok: false, reason: "contentBase64 required (the file content, base64 encoded)" };
  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length === 0) return { ok: false, reason: `${name} is empty` };
  if (bytes.length > MAX_ATTACHMENT_BYTES)
    return {
      ok: false,
      reason: `${name} weighs ${bytes.length} bytes, the maximum for an attachment is ${MAX_ATTACHMENT_BYTES}`,
    };
  const dir = dirOf(artifactsDir);
  const file = path.join(dir, name);
  const replaced = fs.existsSync(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, bytes);
  return { ok: true, attachment: describe(name, bytes.length, artifactsPath), replaced };
}

/** The file on disk, or `null` if it does not exist (the route makes it a 404). The name goes
 *  through `attachmentName` again, so no `../` ever reaches `path.join`. */
export function attachmentFile(artifactsDir: string, rawName: unknown): string | null {
  const name = attachmentName(rawName);
  if (!name) return null;
  const file = path.join(dirOf(artifactsDir), name);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

export function removeAttachment(artifactsDir: string, rawName: unknown): { ok: boolean } {
  const file = attachmentFile(artifactsDir, rawName);
  if (!file) return { ok: false };
  fs.unlinkSync(file);
  return { ok: true };
}

/** What the agent reads in its brief. Rendered here rather than in `buildTaskBrief` because the
 *  wording is how this domain presents itself: it names the files (an agent unaware they exist will
 *  not look for them), says they come from the human and not a sibling session, and gives the exact
 *  path for `fs_read`. Empty = no section, not a section saying "no attachment". */
export function briefAttachmentsSection(attachments: Attachment[]): string | null {
  if (attachments.length === 0) return null;
  const count = attachments.length === 1 ? "1 attachment" : `${attachments.length} attachments`;
  return (
    `## Brief attachments\n` +
    `The brief carries ${count}, attached by the OPERATOR: ${attachments.map((a) => a.name).join(", ")}. ` +
    `They are INPUTS, not deliverables — read them before starting, they are part of the ask:\n` +
    attachments.map((a) => `- ${a.name} (${a.mimeType}, ${a.size} bytes) — ${a.path}`).join("\n") +
    "\n" +
    `Pull each one with fs_read on that path. An image comes back as the picture itself, ` +
    `so you SEE what the operator saw; a text file comes back as text.`
  );
}

/** What the running agent reads when a file arrives after the brief (07/09, "I launched it but
 *  forgot a screenshot"). The file is readable right away (no mount: `fs_read` goes through the
 *  /internal port), but the agent does not know it exists; the steer tells it. Same vocabulary as
 *  `briefAttachmentsSection` (OPERATOR, INPUT, fs_read, the exact path) on purpose: the agent read
 *  that language at start and recognises the gesture instead of meeting a differently shaped
 *  instruction mid-work. */
export function attachmentSteerText(attachments: readonly Attachment[]): string {
  const tail =
    `read it now with fs_read on that exact path ` +
    `(an image comes back as the picture itself) and take it into account before going on.`;
  const [only] = attachments;
  if (only && attachments.length === 1)
    return (
      `The OPERATOR just attached a file to this task's brief: ${only.name} ` +
      `(${only.mimeType}, ${only.size} bytes) — ${only.path}. It is an INPUT, part of the ask: ${tail}`
    );
  // Several at once (07/09, `attachment-notify.ts`): one line per file, the same verb.
  const lines = attachments
    .map((a) => `- ${a.name} (${a.mimeType}, ${a.size} bytes) — ${a.path}`)
    .join("\n");
  return (
    `The OPERATOR just attached ${attachments.length} files to this task's brief:\n${lines}\n` +
    `They are INPUTS, part of the ask: for each one, ${tail}`
  );
}
