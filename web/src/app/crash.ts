// What a broken screen means: pure rules, no rendering. Two causes behind one symptom.
//
// The STALE screen is by far the most frequent, and not a bug. Legion updates by rebuilding, and the
// screen is split into chunks whose names carry a content hash (`AgentPage-BoE_IbB8.js`). A page
// left open during an update keeps the OLD names; on the next navigation it requests a file the new
// build no longer serves, gets a 404, and the import fails. Reloading fixes it FOR SURE, the only
// case where that can be promised.
//
// The REAL crash is everything else. Reloading may help, and we cannot know: saying otherwise would
// be a promise we do not keep.
//
// The distinction is read from the message, for lack of better. Each engine has its sentence for a
// module it could not load and none is normalised, hence a list rather than one expression believed
// exhaustive. When in doubt it falls back to the crash: wrongly saying "just stale" would send a
// screen that cannot heal into a reload loop.

/** The three engines' sentences for "could not load this module".
 *
 *  Chromium: "Failed to fetch dynamically imported module".
 *  WebKit: "Importing a module script failed", the one that matters: Safari is the installed app's
 *  browser.
 *  Firefox: "error loading dynamically imported module".
 *  The last two are the case where the file was requested and no longer exists. */
const STALE = [
  "failed to fetch dynamically imported module",
  "importing a module script failed",
  "error loading dynamically imported module",
  "dynamically imported module",
  "load failed",
];

/** A `throw` can carry anything (a string, an object, `undefined`), and an error page crashing while
 *  reading the error is the worst place to crash. */
export function crashMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/** True when the screen is merely OLDER than the server. This boolean picks the sentence, so what
 *  is promised. */
export function isStaleScreen(error: unknown): boolean {
  const message = crashMessage(error).toLowerCase();
  return STALE.some((needle) => message.includes(needle));
}
