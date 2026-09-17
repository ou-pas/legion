// A single-quoted shell literal, in `shared/` (a leaf) so `updates/` and `infra/images/` can both
// use it without an import cycle (09/09).
//
// Only the quote itself needs escaping (`'\''`: close, literal quote, reopen). Values are
// operator-chosen (runner name) or stored (repository URL, image tag), never third-party input,
// but they still end up in a shell string.
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// What a rebuild script says about its failures (13/09). Each failed image wrote its ⛔ line, but
// the script always ended with a check mark, the last line one reads; three runners failed their
// session image that day under a closing tick. Here for the same cycle reason as `shQuote`:
// fleet images (`updates/docker-update.ts`) and project images (`infra/images/project.ts`) both
// write this counter.
export const REBUILD_KO_INIT = "REBUILD_KO=0";
export const REBUILD_KO_ONE = "REBUILD_KO=$((REBUILD_KO+1))";

/** The closing lines. They ALWAYS carry the word "done": that is what `parseFleetOutcome` reads
 *  to tell a complete log from a rebuild still running. Only the sign changes, and that is the
 *  whole point. */
export const REBUILD_DONE_LINES = [
  'if [ "$REBUILD_KO" -gt 0 ]; then',
  '  say "⛔ done — $REBUILD_KO rebuild(s) failed."',
  "else",
  '  say "✓ done."',
  "fi",
];
