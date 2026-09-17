// THE WORDS OF THE BROKEN SCREEN. Two causes, two promises — and the difference is the whole point
// of these four sentences: one of them can say "reloading is enough", the other cannot.
//
// The tone is the product's: a fact, then the exit. No apology, no "oops", no "an error occurred" —
// which says neither what happened nor what to do.
export const CRASH_TEXT = {
  /** The screen is older than the server: this is not a failure, and we can promise it. */
  stale: {
    title: "This screen predates the update",
    body: "Legion rebuilt itself while this was open. Reloading is enough — nothing that was saved is lost.",
  },

  /** Everything else. We do not promise that reloading repairs it, we say what it does. */
  broken: {
    title: "This screen stopped",
    body: "Something broke while displaying it. The rest of the application keeps working; reloading starts again from a clean page.",
  },

  reload: "Reload",
  detail: "See the technical detail",
} as const;
