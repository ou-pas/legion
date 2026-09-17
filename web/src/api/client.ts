// The transport: fetch JSON with the server's error relayed verbatim.
//
// "Failed to execute 'json' on 'Response': Unexpected end of JSON input" (26/08, stopping a session,
// twice): parsing the error response failed and replaced the real reason. `r.json()` was called on
// error responses that carry no JSON: a Hono 404 is plain text, a Vite proxy error is HTML while
// the control plane restarts, a 204 is empty. Every call in the app goes through `json`, so every
// network failure or missing route read as a parsing bug. The body is read as TEXT and parsed only
// if it is JSON; the status is always in the message, since it is what remains when the server said
// nothing.

/** What the server meant, whatever it actually sent. */
async function serverError(r: Response): Promise<string> {
  // An unreadable body (connection cut mid-read) must not replace the HTTP error with a read
  // error: that is exactly the defect fixed here.
  const raw = (await r.text().catch(() => "")).trim();
  if (!raw)
    return `${r.status}${r.statusText ? ` ${r.statusText}` : ""} — the server did not respond`;
  try {
    const body = JSON.parse(raw) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    // Text or HTML: bounded, since a whole error page in a toast drowns the status, the only
    // useful information.
  }
  return `${r.status} — ${raw.slice(0, 200)}`;
}

/** The return type stays as wide as `r.json()` on purpose: each API module DECLARES the expected
 *  shape (`Promise<Rule[]>`, `Promise<Environment>`…), and narrowing it here would move forty
 *  annotations without checking anything more. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = async (r: Response): Promise<any> => {
  if (!r.ok) throw new Error(await serverError(r));
  // 204, or 200 without body: an empty response is a success, not a syntax error.
  const raw = await r.text();
  return raw ? JSON.parse(raw) : null;
};

export const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then(json);
export const patch = (url: string, body: unknown) =>
  fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json);
