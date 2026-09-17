// git-failure: what git actually said when it refused.
//
// Written on 07/09 for the silent trace of session 7fb0abeda02a: two checkpoint warnings cut at 200
// characters kept "Command failed: git push … To https://…" and dropped ` ! [rejected] … (fetch
// first)`. Git puts its reason at the end of stderr, and the cut kept the start. Nobody could tell
// whether a fetch, a rebase or a token was needed.
//
// Pure (no git, no fs): the only way to exercise it on real stderr without reproducing the outages
// that produced them (git-failure.test.ts).

/** Lines carrying a decision. Everything else ("To https://…", progress, following hints) is context
 *  the first line makes useless. */
const DECISIVE = /^\s*(!\s*\[rejected\]|error:|fatal:|remote:)/;
const HINT = /^\s*hint:/;

/** A failure's text in whatever form it arrives: an `execFile` `Error` (whose `message` glues stderr
 *  after "Command failed: …"), bare stderr, or anything else, in which case the value itself. */
const failureText = (failure: unknown): string =>
  failure == null ? "" : String((failure as { message?: unknown })?.message ?? failure);

/** The three rejection reasons meaning "the remote branch moved ahead". */
export type PushRejection = "fetch first" | "non-fast-forward" | "stale info";

/** A git failure's summary: the whole ` ! [rejected] <branch> (<reason>)` line, the
 *  `error:`/`fatal:`/`remote:` lines, and the first `hint:`. With no known line, the end of the text.
 *  The cap cuts the start: the reason is always at the end.
 *
 *  @param failure an `execFile` Error (whose message glues stderr after "Command failed: …") or the
 *    stderr itself
 *  @param max cap in characters
 *  @returns a single line, fragments separated by " · "
 */
export function gitFailureSummary(failure: unknown, max = 1_000): string {
  const text = failureText(failure);
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const meaningful = lines.filter((l) => !l.startsWith("Command failed:"));
  const decisive = meaningful.filter((l) => DECISIVE.test(l));
  const firstHint = meaningful.find((l) => HINT.test(l));
  const kept = decisive.length
    ? [...decisive, ...(firstHint ? [firstHint] : [])]
    : meaningful.slice(-3);
  const summary = kept.join(" · ");
  return summary.length > max ? `…${summary.slice(summary.length - max + 1)}` : summary;
}

/** The reason of a rejection meaning "the remote branch moved ahead", or null for any other refusal.
 *  The only case where the runner tries something on its own (fetch + rebase): a refused token, an
 *  unreachable remote or a protected branch are not fixed by rebasing. */
export function pushRejectedBehind(failure: unknown): PushRejection | null {
  const text = failureText(failure);
  const m = /!\s*\[rejected\][^\n]*\((fetch first|non-fast-forward|stale info)\)/.exec(text);
  // Group 1 cannot be empty when the regex matched (all three alternatives are inside it); it is
  // read as the optional value it is rather than asserted to the type.
  const raison = m?.[1];
  return raison ? (raison as PushRejection) : null;
}
