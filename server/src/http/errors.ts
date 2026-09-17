// One exception → one status, in one place (06/09).
//
// Before, each route did `catch (err) { return c.json({ error: err.message }, 400) }`, with three
// defects: everything was 400 (a missing project, a blocked session, a full fleet and a SQL typo
// alike, so the screen could decide nothing); the raw message of an unexpected exception reached
// the client (Node BP 6.20); and exceptions the `catch` did not expect left no trace in the log.
//
// Here: exceptions carrying their status (these and `CatalogError`), those whose meaning fixes it
// (`BlockedSessionError`, launch refusals), and the rest, a server fault that gets logged.
//
// Launch refusals are 503, not 500 or 507: the control plane is fine, the fleet cannot take work
// now, and 503 says "retry, your request is not at fault". 507 would point at the responding
// server's disk, not a fleet machine's.
import { ZodError } from "zod";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { nanoid } from "nanoid";
import { logControlEvent } from "../events/control-log-store.js";
import { CatalogError } from "../chains/catalog.js";
import { BlockedSessionError } from "../sessions/session-guard.js";
import {
  ChosenRunnerError,
  NoCapacityError,
  NoDiskError,
  NoReachableRunnerError,
} from "../sessions/runner/launch-errors.js";
import { TaskBlockedError } from "../tasks/blockers.js";

/** Thrown from a service or a route, it crosses layers without any `catch` recognising it. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(message, 400);
    this.name = "BadRequestError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

/** The current state refuses the action, and will until it changes. */
export class ConflictError extends HttpError {
  constructor(message: string) {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export type KnownFailure = { status: ContentfulStatusCode; error: string };

/** `choices.0.id — expected string`, same shape as `parse-body.ts`: the sender knows what to fix. */
function describeZod(err: ZodError): string {
  const issues = err.issues.map((i) => {
    const path = i.path.map(String).join(".");
    return path ? `${path} — ${i.message}` : i.message;
  });
  return `invalid body: ${issues.join(" · ")}`;
}

/** `null` when nobody recognises the exception. This list is the contract, readable at once. */
export function knownFailure(err: unknown): KnownFailure | null {
  if (err instanceof HttpError) return { status: err.status, error: err.message };
  if (err instanceof CatalogError) return { status: err.status, error: err.message };
  // A state conflict, not a malformed request: the screen can offer to unblock it.
  if (err instanceof BlockedSessionError) return { status: 409, error: err.message };
  // 10/09: these two came out as 500. Both are fixable states (lift the blocker, restart or change
  // the machine) and the message names the fix. Without them here the screen said "internal error"
  // five clicks in a row while the useful sentence stayed in the log.
  if (err instanceof TaskBlockedError || err instanceof ChosenRunnerError)
    return { status: 409, error: err.message };
  if (
    err instanceof NoCapacityError ||
    err instanceof NoReachableRunnerError ||
    err instanceof NoDiskError
  )
    return { status: 503, error: err.message };
  if (err instanceof ZodError) return { status: 400, error: describeZod(err) };
  return null;
}

/**
 * Mounted by `app.ts` and mountable by a route test on a bare `new Hono()` (06/09); otherwise each
 * domain would keep its own `catch` just so its test sees a status.
 *
 * Anything unknown is a server fault: the client gets "internal error" and a reference, the log
 * gets the detail (file paths, query fragments, env names never leave the machine). The reference
 * links the toast to the log line.
 */
export function httpErrorHandler(err: Error, c: Context): Response {
  const known = knownFailure(err);
  if (known) return c.json({ error: known.error }, known.status);

  const ref = nanoid(8);
  logControlEvent("error", "http", `${c.req.method} ${c.req.path} — ${err.message}`, {
    ref,
    name: err.name,
    stack: err.stack ?? null,
  });
  return c.json({ error: "internal error", ref }, 500);
}

/** JSON, not Hono's plain-text 404: the screen expects JSON everywhere and showed a parse error
 *  instead of the real status. The SPA fallback reserves `/api`, `/internal` and `/webhooks`
 *  (static.ts) and never reaches here. */
export function notFoundHandler(c: Context): Response {
  return c.json({ error: "unknown route" }, 404);
}
