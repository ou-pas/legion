// Filters the `href` of a Markdown link written by an agent (report, `pr.md`, channel).
//
// Not an XSS fix: React 19 already neutralises `href="javascript:"` and browsers refuse top-level
// `data:` navigation. Defence in depth and anti-phishing: only `http:`, `https:`, `mailto:` and app
// paths (`/…`, `#…`) become links. Everything else (`javascript:`, `data:`, `vbscript:`, `file:`, a
// schemeless `//host`, a bare `example.com`) is refused, and the caller renders the text as written.
//
// It does not validate the URL (host, encoding, existence) or judge the destination: an `https://`
// to a dubious domain passes. (05/09)

const ALLOWED = /^(https?:|mailto:|\/(?!\/)|#)/i;

// Space, C0 controls and DEL: what a browser ignores when parsing a URL. A char-code filter rather
// than a regex class, which `no-control-regex` rejects; rightly in general, but controls are the
// target here.
const ignoredByBrowsers = (char: string): boolean =>
  char.charCodeAt(0) <= 0x20 || char.charCodeAt(0) === 0x7f;

/** The cleaned `href` if its scheme is allowed, `undefined` otherwise. Whitespace and control
 *  characters are removed before the test, anywhere in the string: a browser ignores them, so a
 *  tab slipped into `javascript:` does not hide it. */
export function safeHref(raw: string): string | undefined {
  const href = [...raw].filter((char) => !ignoredByBrowsers(char)).join("");
  return ALLOWED.test(href) ? href : undefined;
}
