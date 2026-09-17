// The port through which an answer restarts a session (06/09).
//
// Answering resumes the session, but the runner also needs the inbox (it asks questions, expires
// diagnostics), which closed a cycle hidden behind `await import()`. The inbox knows a contract,
// not the runner; `index.ts` wires the real implementation at boot.
import type { AnsweredBy } from "./inbox-enums.js";
import type { ImageRebuildTarget } from "./image-rebuild.js";

/** What the inbox asks of the runner on an answer: resume the waiting session, or rerun the whole
 *  task when the session is dead (diagnostic). */
export interface SessionResumer {
  /** `cause` (08/09): the wait reason being lifted, when it changes what the session should read
   *  in its conversation. Only the inbox knows it. */
  resume(
    sessionId: string,
    answer: string,
    opts: { answeredBy?: AnsweredBy; cause?: "dependency" | "update" | "relaunch" },
  ): Promise<void>;
  run(taskId: string): Promise<string>;
}

/** What the inbox asks of the runner when an image question is answered (12/09). One method: the
 *  runner decides what "rebuild" means (fleet image or project-declared image). No session is
 *  resumed; the queue picks tasks up once the probe sees the image back. */
export interface ImageRebuilder {
  answer(target: ImageRebuildTarget, choice: "rebuild" | "park"): Promise<void>;
}

let impl: SessionResumer | null = null;
let rebuilder: ImageRebuilder | null = null;

export function registerSessionResumer(resumer: SessionResumer): void {
  impl = resumer;
}

export function registerImageRebuilder(r: ImageRebuilder): void {
  rebuilder = r;
}

/** The wired implementation, or an error saying what to do: answering "ok" without rebuilding
 *  would leave tasks waiting forever. */
export function imageRebuilder(): ImageRebuilder {
  if (!rebuilder)
    throw new Error("ImageRebuilder not wired: index.ts must call registerImageRebuilder");
  return rebuilder;
}

/** The wired implementation, or an error saying what to do. An unwired port is an assembly
 *  mistake; hiding it would answer "ok" without resuming anyone. */
export function sessionResumer(): SessionResumer {
  if (!impl) throw new Error("SessionResumer not wired: index.ts must call registerSessionResumer");
  return impl;
}
