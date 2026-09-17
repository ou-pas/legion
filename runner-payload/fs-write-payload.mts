// The decision behind `fs_write` when it carries binary content, split from session-runner so it
// can be tested without a whole container (the module runs in the session image and is imported as
// is on both sides, like stuck and commit-convention).
//
// Found on 04/09 (task "read html artifacts"): `fs_write` only accepted binary through
// `contentBase64` passed in the call, so copied character by character through the model's output.
// At 3.5 kB already (a reduced JPEG capture) three attempts all produced a truncated file, and only
// the written size gave it away, afterwards. `localPath` adds a third way: a path already on this
// container's disk (a capture the agent just shrank with Bash, say). Same principle as
// `DesignSync.write_files` and its `localPath`: the content is read and encoded by this process,
// never retyped by the model.
//
// `readFile` is injected so this stays a pure decision function (which field wins, what to do if it
// is missing or the read fails), testable without a real disk.

const CONTENT_KEYS = ["content", "contentBase64", "localPath"] as const;

/** The call as the model wrote it: the three ways to provide content, plus whatever else the tool
 *  carries (the destination path, notably), which passes through unread. */
export type WriteInput = {
  content?: string;
  contentBase64?: string;
  localPath?: string;
  [k: string]: unknown;
};

export type Resolved =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Decides what `fs_write` sends to the control plane from the three ways to provide content.
 * `readFile` receives the `localPath` and must return a Buffer (or throw).
 */
export function resolveWritePayload(
  input: WriteInput,
  readFile: (localPath: string) => Buffer,
): Resolved {
  const provided = CONTENT_KEYS.filter((k) => input[k] !== undefined);
  // Refuse early and readably: with none of the three fields, a call would silently write an empty
  // file (the server treats a missing `content` as ""), and several would hide which one wins.
  if (provided.length !== 1) {
    return {
      ok: false,
      reason:
        "fs_write refused: provide exactly one of `content` (text), " +
        "`contentBase64` (binary) or `localPath` (binary already on this container's disk).",
    };
  }
  if (input.localPath === undefined) return { ok: true, payload: input };
  let bytes;
  try {
    bytes = readFile(input.localPath);
  } catch (err) {
    // `err` is `unknown` in a `catch`: the cast only restores the earlier reading, which falls back
    // on `err` itself when the thrown object has no `message`.
    return {
      ok: false,
      reason: `fs_write refused: cannot read localPath '${input.localPath}': ${(err as { message?: string })?.message ?? err}`,
    };
  }
  // `_localPath` is dropped from the payload on purpose: the content was just read and encoded. The
  // underscore says "removed on purpose", not "forgotten".
  const { localPath: _localPath, ...rest } = input;
  return { ok: true, payload: { ...rest, contentBase64: bytes.toString("base64") } };
}
