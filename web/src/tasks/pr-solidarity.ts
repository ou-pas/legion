// Solidarity of the change requests of a multi-repository task.
//
// The server only completes the task once ALL are merged (`server/src/review/merge-events.ts`,
// `states.every((s) => s.prState === "merged")`), and rightly: `unknown`/`closed` is not `merged`,
// so when in doubt the task does not move. But the screen never said so: the operator saw two links,
// merged one, and could not tell why the task stayed in review (real case on 03/09, two tasks with
// two repos each).
//
// Neutral wording: never a hardcoded "PR" or "pull request", because `prUrls` carries GitLab
// (framagit) merge requests as well as GitHub ones, and the kind cannot be told repo by repo here.
import { type PrMergeState } from "../api/review.js";
import { type PrUrl } from "./pr-state.js";
import { TASK_TEXT } from "./text/vocabulary.js";

/** The state of ONE change request as solidarity tells it:
 *  - `merged`: counts in the total, nothing to do.
 *  - `pending`: open, or closed without merge; the task waits for THAT one.
 *  - `unknown`: `prState` missing, the read never reached the forge (unreadable number in the URL,
 *    unresolved repo, see `mergeStatesOf` in `server/src/integrations/forge-access.ts`). NOT "not
 *    merged yet": one is to look into, the other to wait for. */
export type PrSolidarityState = "merged" | "pending" | "unknown";

export type PrSolidarityLine = { repo: string; state: PrSolidarityState };

/** `null`: a single request or none, nothing to be solidary with. The common case, and it must make
 *  no noise. */
export type PrSolidarity = { total: number; mergedCount: number; lines: PrSolidarityLine[] } | null;

/** `states` comes from `prMergeStatesQuery`, `undefined` until it answers, in which case every line
 *  falls back on `unknown`: the same value the server already returns when it does not know. */
export function prSolidarity(
  prUrls: readonly PrUrl[],
  states: readonly PrMergeState[] | undefined,
): PrSolidarity {
  if (prUrls.length <= 1) return null;
  const lines = prUrls.map((p): PrSolidarityLine => {
    const s = states?.find((m) => m.repo === p.repo && m.url === p.url);
    const state: PrSolidarityState =
      s?.prState === undefined ? "unknown" : s.prState === "merged" ? "merged" : "pending";
    return { repo: p.repo, state };
  });
  return {
    total: lines.length,
    mergedCount: lines.filter((l) => l.state === "merged").length,
    lines,
  };
}

/** The sentence to show: `title` carries the count and the rule, `body` NAMES what is missing
 *  (waiting repo, repo with unknown state). `null` in the common case, so no component renders an
 *  empty shell. */
export function solidarityMessage(
  solidarity: PrSolidarity,
): { title: string; body: string | null } | null {
  if (!solidarity) return null;
  const waiting = solidarity.lines.filter((l) => l.state === "pending").map((l) => l.repo);
  const unknown = solidarity.lines.filter((l) => l.state === "unknown").map((l) => l.repo);
  const body =
    [
      waiting.length > 0 ? TASK_TEXT.solidarity.waiting(waiting) : null,
      unknown.length > 0 ? TASK_TEXT.solidarity.unknown(unknown) : null,
    ]
      .filter((p): p is string => p !== null)
      .join(" · ") || null;
  return {
    title: `${TASK_TEXT.solidarity.count(solidarity.mergedCount, solidarity.total)} — ${TASK_TEXT.solidarity.rule}`,
    body,
  };
}
