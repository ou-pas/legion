// Reading a body at a boundary (05/09), and telling the client what to fix.
//
// `c.req.json<T>()` checks nothing: `<T>` is a disguised `as`. On `/internal` the client is an
// agent whose body is model output, which is where it matters.
//
// The refusal is one line: the faulty key's path and what the schema says. An agent reads it in
// its tool result and fixes it next turn; a bare "400 Bad Request" would cost it a turn of
// guessing. Unreadable JSON is a 400 of the same family, not a 500.
import type { z } from "zod";

export type ParsedBody<T> = { ok: true; value: T } | { ok: false; error: string };

/** The bare minimum of `Context`, testable without mounting an app. */
type JsonRequest = { req: { json(): Promise<unknown> } };

export async function parseBody<T>(c: JsonRequest, schema: z.ZodType<T>): Promise<ParsedBody<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, error: "invalid body: unreadable JSON" };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: `invalid body: ${parsed.error.issues.map(describeIssue).join(" · ")}`,
  };
}

/** `choices.0.id — Invalid input: expected string, received number`. At the root (unknown key, non
 *  object body) zod's message already names the culprit, so no prefix. */
function describeIssue(issue: z.ZodIssue): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path} — ${issue.message}` : issue.message;
}
