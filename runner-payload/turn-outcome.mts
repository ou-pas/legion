// The SDK's `result` can lie in `subtype`, not in `is_error`.
//
// Measured on 03/09 on task `xHt_lTLVWl`, six times in a row: the SDK returns a `result` of subtype
// `success` whose text is "API Error: 529 Overloaded". The CLI exits 0, session-runner only looked
// at `subtype`, the session ends `destroyed`, and the task goes to `review` as finished work: zero
// tool calls, zero changes, billed anyway.
//
// The SDK carries the right signal, documented in its own type (`sdk.d.ts`, `SDKResultMessage`):
// "subtype "success" carries the final assistant text in result — or, with is_error true, the error
// text when the turn ended on an API error". `is_error` is on both variants and tells the truth when
// `subtype` lies; `api_error_status` comes with it when the SDK knows it.
//
// Reading that signal rather than guessing from "API Error:" covers every error the SDK phrases
// differently (quota, authentication, network) with one mechanism.

import type { SDKResultMessage, SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";

/** What is read from the `result` message, derived from the SDK's type so names stay its own, but
 *  with optional fields: the SDK declares them all present, and this must stay correct on a
 *  truncated message (a session killed before the end, a test fixture). */
type ResultRead = Pick<SDKResultMessage, "subtype"> &
  Partial<
    Pick<
      SDKResultMessage,
      "is_error" | "total_cost_usd" | "num_turns" | "duration_ms" | "duration_api_ms"
    >
  > &
  // `api_error_status` only exists on the SDK's success variant, so outside the union's `keyof`,
  // and that is precisely the case this module reads.
  Partial<Pick<SDKResultSuccess, "api_error_status">>;

/** A turn whose result counts as a session failure even when `subtype` says `success`. Covers any
 *  API error the SDK saw during the turn (overload, quota, authentication, network), not just the
 *  measured 529. The SDK's error subtypes (`error_max_turns`, `error_during_execution`, …) stay
 *  failures: `is_error` is true there too, the condition only adds the missed case. */
export function turnFailed(msg: ResultRead): boolean {
  return msg.subtype !== "success" || Boolean(msg.is_error);
}

/** A `result` that ends nothing (14/09): this message's second lie, after `subtype`.
 *
 *  When a session resumes, the SDK emits a summary `result` before any work: `num_turns: 0`, a few
 *  hundred milliseconds, `subtype: "success"`. The runner took it for the end of a turn and closed
 *  the input stream, after which the CLI did its real turn with no channel: every `Bash` refused
 *  ("The user doesn't want to take this action right now"), every `mcp__legion__*` cut ("interrupted
 *  before a result was received"). The agent then said it was stopping, its session ended with code
 *  0, and its task went to `review` as finished work. Three tasks were filed as delivered that way,
 *  including an interview writing "all my tools are cut off".
 *
 *  Measured before fixing, on the production database: twelve zero-turn `result`s in all history,
 *  all twelve on a resumed session, none on a fresh one; of the last twenty-five resumes, the six
 *  carrying one all had at least one tool refusal, against two of the other nineteen.
 *
 *  A turn that fails at zero turns is not this case: it does end something, and `turnFailed`
 *  handles it. */
export function endsNothing(msg: ResultRead): boolean {
  return msg.num_turns === 0 && !turnFailed(msg);
}

/** The fields session-runner publishes in the trace's `result` event. `isError` and
 *  `apiErrorStatus` are additions: a consumer that does not know them reads the same fields as
 *  before.
 *
 *  `durationMs` (10/09) is the run's own duration, which the SDK gives and nobody recorded. The only
 *  duration a screen could show was the session row's `endedAt - startedAt`, wall time: on
 *  `uI2d0wsDLd9w`, eleven hours mostly spent waiting between resumes. `durationApiMs` separates
 *  waiting on the model from the rest of the turn. */
export function resultEventFields(msg: ResultRead) {
  return {
    subtype: msg.subtype,
    costUsd: msg.total_cost_usd,
    numTurns: msg.num_turns,
    durationMs: msg.duration_ms ?? null,
    durationApiMs: msg.duration_api_ms ?? null,
    isError: Boolean(msg.is_error),
    apiErrorStatus: msg.api_error_status ?? null,
  };
}
