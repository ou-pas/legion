// A task's PR flow, screen side: where the draft stands and what it says. Each of these questions
// decides a piece of UI (does the PR tab exist, does a draft await a decision, what is its title),
// and each used to be an expression buried in `TaskPage.tsx`'s JSX.
import { parseJsonOr } from "../api/json.js";
import { type Task } from "../api/tasks.js";

/** The artifact the agent drops at the end of a task. */
export const PR_DRAFT = "pr.md";

export type PrUrl = { repo: string; url: string };

/** PRs already opened, as the task carries them. The field is JSON in the database: a task that
 *  never had one carries `""`, not `"[]"`, and an unreadable value means "no PR", not a blank page
 *  (`api/json.ts`). */
export function prUrlsOf(task: Pick<Task, "prUrls">): PrUrl[] {
  return parseJsonOr<PrUrl[]>(task.prUrls, []);
}

/** The PR tab only exists when there is something to do there: a dropped draft, an opened PR, or
 *  pushed code.
 *
 *  `pushedCode` came with automatic opening (slice nav/12): the PR now opens at the end of a session
 *  that pushed, without `pr.md`. When that opening fails there is neither draft nor URL, and without
 *  this third term the tab did not exist, so there was no gesture to retry. */
export function hasPrTab(
  artifactNames: readonly string[],
  prUrls: readonly PrUrl[],
  pushedCode = false,
): boolean {
  return artifactNames.includes(PR_DRAFT) || prUrls.length > 0 || pushedCode;
}

/** Pushed code and no PR to hold it: that arms the "Open PR" button, in the channel and on the task
 *  page. `pr.md` arms nothing since 14/09 (interview "affichage bouton pr sur channel"): a draft
 *  without commits cannot succeed (the forge answers "No commits between main and legion/…"), so it
 *  must not arm a button that can only fail. `hasPrTab` above keeps `pr.md`: reading a draft stays
 *  useful even when opening is impossible. */
export function pendingPr(prUrls: readonly PrUrl[], pushedCode: boolean): boolean {
  return pushedCode && prUrls.length === 0;
}

/** The "(Re)open PR" gesture follows the PUSH and nothing else.
 *
 *  From 14/09 to 15/09 it depended on the forge state, hidden on an `open` or `merged` PR because
 *  "the mark is enough". A mark is not a gesture: when automatic opening half failed (one repo of
 *  two, token without rights, forge answering 502) the PR view offered NO button, and the only way
 *  out was rerunning the agent. The server finds an already opened PR instead of creating a second
 *  one (`existing`): the click is idempotent, and its worst case is a readable forge refusal.
 *
 *  The forge state now only decides the LABEL, at the caller. */
export function canOpenPr(pushedCode: boolean): boolean {
  return pushedCode;
}

/** The draft read as a PR: first line is the title (Markdown `#` stripped), the rest the body.
 *  `null` when nothing was dropped: the empty state, not an error. */
export function parsePrDraft(draft: string | null): { title: string; body: string } {
  const lines = (draft ?? "").trim().split("\n");
  return {
    title: (lines[0] ?? "").replace(/^#+\s*/, "").trim(),
    body: lines.slice(1).join("\n").trim(),
  };
}
