// Reads a TEXT column holding JSON (`tasks.prUrls`, `tasks.externalRef`, `tasks.expectedArtifacts`…)
// without the page depending on it to render. A `JSON.parse` that throws during render blanks the
// WHOLE page with no message; three sites on the task page parsed that way (28/08), none tolerating
// an unreadable value. Bad data is an anomaly, not a reason to lose the page: the fallback is what a
// task that never had the field would carry. Empty (`""`, `null`) and a literal `"null"` take the
// same path: `JSON.parse("null")` succeeds, and `.branch` on it would throw.

/** The JSON of `raw`, or `fallback` when it is empty, unreadable or `null`. */
export function parseJsonOr<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return (JSON.parse(raw) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}
