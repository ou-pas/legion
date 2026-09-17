// A service refusal → its response, in one place (06/09). The domain returns its refusal, named and
// carrying its status; the route only translates it. Without this, the same three `if (!result.ok)`
// lines were copied into every route.
//
// A `value` envelope rather than spread fields: some services return arrays
// (`taskPrMergeStates`, `listOpenChangeRequests`), which no `{ ok: true } & T` covers, and the
// envelope keeps response bodies exactly as they were. Adding `ok` to an existing body would be a
// contract change the compiler cannot see.
//
// Versus `errors.ts`: an exception carrying its status crosses layers unseen; a `Result` is read by
// the caller, who may decide something else. Expected refusals go here; anything that escapes the
// service stays an exception for `app.onError`.
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** 400 the request, 404 not found, 409 conflicting state, 502 a dependency that did not answer.
 *  Never 500: nobody expects it, so it is an exception. */
export type RefusalStatus = 400 | 404 | 409 | 502;

export type Refusal = { ok: false; status: RefusalStatus; error: string };
export type Result<T = void> = { ok: true; value: T } | Refusal;

/** Without a value (`Result<void>`), the route returns `{ ok: true }`. */
export const done = <T = void>(value?: T): Result<T> => ({ ok: true, value: value as T });

export const refuse = (status: RefusalStatus, error: string): Refusal => ({
  ok: false,
  status,
  error,
});

/** Success returns the value itself, never the envelope. `okStatus` is for creations (201). */
export function fromResult<T>(
  c: Context,
  result: Result<T>,
  okStatus: ContentfulStatusCode = 200,
): Response {
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value === undefined ? { ok: true } : result.value, okStatus);
}
