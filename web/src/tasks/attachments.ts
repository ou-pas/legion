// Brief attachments, screen side: what a picked file becomes before it leaves. No rendering, no
// network: only the rule deciding what uploads and what is refused, so a test can read it alone.
import { bytesOf, toB64 } from "../api/base64.js";
import type { AttachmentUpload } from "../api/tasks.js";
import { TASK_PAGE_TEXT as T } from "./text/task-page.js";

/** The SAME cap as the server (`server/src/tasks/attachments.ts`, itself the artifacts binary
 *  channel's). Refused HERE, before sending: an 8 MB file crossing the network only to be refused
 *  wastes a wait, and the message would come after the gesture. The server refuses anyway; it keeps
 *  the door, the screen only saves the trip. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** A picked file, ready to go. Transport is the existing binary channel (base64 in JSON, see
 *  `api/base64.ts`). */
export type PickedAttachment = { name: string; size: number; contentBase64: string };

export type PickOutcome = {
  picked: PickedAttachment[];
  /** The ones not sent, WITH their size: the screen must say which and why, not "file refused". */
  refused: { name: string; size: number }[];
};

/** Reads the picked files (button or drag and drop) and splits what goes from what is refused. An
 *  empty file is refused like an oversized one: neither would succeed server side, and keeping quiet
 *  would suggest the drop worked. */
export async function readAttachments(files: File[]): Promise<PickOutcome> {
  const picked: PickedAttachment[] = [];
  const refused: { name: string; size: number }[] = [];
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES || file.size === 0) {
      refused.push({ name: file.name, size: file.size });
      continue;
    }
    const contentBase64 = toB64(await file.arrayBuffer());
    picked.push({ name: file.name, size: bytesOf(contentBase64), contentBase64 });
  }
  return { picked, refused };
}

/** What the screen says of files dropped while a session runs (07/09): a single steer sent is enough
 *  to say "forwarded" (the drop is one gesture, not five), otherwise the file waits for the next
 *  session. Outside a session, nothing: the prompt already says the agent reads attachments before
 *  starting. */
export function attachmentNotice(
  uploads: Pick<AttachmentUpload, "notified">[],
  ctx: { liveSession: boolean },
): string | null {
  if (!ctx.liveSession || uploads.length === 0) return null;
  return uploads.some((u) => u.notified === "steered")
    ? T.attachments.steered
    : T.attachments.queued;
}

const dd = (n: number): string => String(n).padStart(2, "0");

/** The name of a PASTED image (16/09). The clipboard gives none: Chrome, Safari and Firefox all
 *  return a `File` named `image.png`, whatever the capture.
 *
 *  `saveAttachment` (server) REPLACES a taken name, on purpose: attaching the same file twice is
 *  someone correcting their capture. Two DIFFERENT captures pasted in a row would both be
 *  `image.png` and the second would silently erase the first. So the name carries the paste TIME,
 *  and a rank if two pastes land in the same second.
 *
 *  The alphabet is the server's (`[A-Za-z0-9._-]`, see `attachmentName`): the name on the chip is
 *  exactly the stored one, with no sanitising on the way. */
export function pastedAttachmentName(
  file: { name: string; type: string },
  taken: readonly string[],
  at: Date,
): string {
  const ext =
    /\.[A-Za-z0-9]{1,8}$/.exec(file.name)?.[0].toLowerCase() ??
    `.${(file.type.split("/")[1] ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin"}`;
  const base =
    `screenshot-${at.getFullYear()}-${dd(at.getMonth() + 1)}-${dd(at.getDate())}` +
    `-${dd(at.getHours())}-${dd(at.getMinutes())}-${dd(at.getSeconds())}`;
  let name = `${base}${ext}`;
  for (let rank = 2; taken.includes(name); rank++) name = `${base}-${rank}${ext}`;
  return name;
}
