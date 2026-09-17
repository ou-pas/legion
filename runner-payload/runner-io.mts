// runner-io: the channels the runner opens and its modules receive.
//
// Types only: the functions `session-runner.mts` passes to its modules (the event log, the control
// plane call, the task update, steering). Several modules receive them; describing them in each
// would give diverging descriptions.
//
// Not in `session-runner.mts`, which creates them: an `import type` is an edge in the import graph
// (dependency-cruiser reads compile-time dependencies), so it would be a cycle with every module it
// imports. The contract lives beside both ends, like `session-spec.mts` for the spec.
//
// Modules fetch nothing themselves: a payload module doing its own `fetch` could no longer be tested
// outside a container.

/** A control plane call's result. `status` 0 means the request never left. */
export type CallResult = { ok: boolean; status: number; body: Record<string, unknown> };

/** The session's event log: numbered, acknowledged, replayed. Never throws: a lost event is admitted
 *  with a `run_warning`, it does not interrupt the work. */
export type Report = (type: string, payload?: Record<string, unknown>) => Promise<void>;

/** A POST on this session's `/internal` port (files, inbox, steering, events). */
export type CallInternal = (pathname: string, body: Record<string, unknown>) => Promise<CallResult>;

/** The task PATCH. A refusal (approval gate) is `ok: false` with its status, not an exception: the
 *  caller decides. */
export type UpdateTask = (body: { status?: string; note?: string }) => Promise<CallResult>;

/** One steering pass: messages received, `[]` if nobody spoke during the window, `null` if the
 *  session no longer listens (ended, or token refused: insisting would not help). */
export type PollSteers = (waitMs?: number) => Promise<{ text: string }[] | null>;

export type Sleep = (ms: number) => Promise<unknown>;
