// Opening a task's change request: one path, two triggers.
//
// Product rule of 30/08 (slice nav/12): every task that writes code must end in a PR. Unrelated to
// the approval gate: the gate says whether a human validates a result, the PR says where the code
// lands and how it is reviewed. A task without a gate still wrote code.
//
// `POST /api/tasks/:id/pr` already did nearly everything: find the repositories a task session
// really pushed to (`repo_push` with `changes > 0`), derive the branch accounting for a fix task,
// call `createChangeRequests`, merge `prUrls`, notify. Two things made it useless: only a human
// click triggered it, and `pr.md` blocked it.
//
// The route body moved here unchanged and gained a second caller, `markSessionTerminal`. The
// trigger is the fact: a session ending while its task's trace carries a `repo_push` with
// `changes > 0` opens the PR (per task, not per session, since 07/09; see `openPrAfterSession`).
// The server does it, not the agent: an invariant resting on an agent remembering is one we lose.
// The button stays to reopen a closed PR.
//
// Three properties the new path must keep, which is why the code is shared rather than copied:
//   · a `mock` session never opens a real PR (the boolean is computed here, once);
//   · opening is idempotent: `createChangeRequests` finds a request already open on the branch and
//     returns its URL, so two session ends do not create two PRs. No lock on top, that would be a
//     second mechanism to keep in step with the forge;
//   · a failure is never fatal (see `openPrAfterSession`).
import fs from "node:fs";
import path from "node:path";
import { publish } from "../shared/events.js";
import { createChangeRequests } from "../integrations/forge-access.js";
import type { ChangeRequest } from "../integrations/forge.js";
import { NOTIF_EVENT, notifyOut } from "../notifications/notify.js";
import { taskArtifactsDir } from "../tasks/artifacts/dir.js";
import { taskBranch } from "../tasks/lifecycle.js";
import { prDraft, type PushedRepo } from "./pr-draft.js";
import {
  mergeTaskPrUrls,
  pushEventsOf,
  sessionIdsOfTask,
  sessionRow,
  sessionsOfTask,
  type SessionEventRow,
  type SessionRow,
} from "./open-pr-store.js";

/** The artifact the agent drops when it writes its own PR. Mirrors `PR_DRAFT` on the screen side
 *  (`web/src/tasks/pr-state.ts`). */
export const PR_DRAFT = "pr.md";

export type OpenPrResult = { prs: ChangeRequest[]; errors: string[] };

/** What `openTaskPr` returns, three outcomes the route never confuses:
 *  · `not-found`: the task does not exist, the 404;
 *  · `no-push`: the task exists but no session pushed code, the 422 (rule of 14/09, interview "PR
 *    button on channel"): the forge would refuse anyway ("No commits between main and legion/…"),
 *    so say it before calling;
 *  · `opened`: opening (or finding) was attempted, `prs`/`errors` carry the per-repository result. */
export type OpenPrOutcome =
  | { status: "not-found" }
  | { status: "no-push" }
  | ({ status: "opened" } & OpenPrResult);

/** The repositories the given sessions really pushed to.
 *
 *  The runner's criterion: a `repo_push` event with `changes > 0` (`runner-payload/session-runner.mjs`).
 *  A zero-change push exists (the branch is pushed as a precaution when the start point is unknown),
 *  and opening an empty PR on it would be noise.
 *
 *  Sorted by event id, so a repository's last push wins: that is its head commit. Events arrive
 *  already read (`pushEventsOf`); this function only applies the rule: group, keep the last, drop
 *  zero-change pushes. */
export function pushedRepos(events: readonly SessionEventRow[]): PushedRepo[] {
  const byRepo = new Map<string, PushedRepo>();
  for (const row of events) {
    if (row.type !== "repo_push") continue;
    let p: { repo?: string; commit?: string; changes?: number };
    try {
      p = JSON.parse(row.payload) as typeof p;
    } catch {
      continue; // broken payload: one unreadable repository does not hide the others
    }
    const changes = p.changes ?? 0;
    if (changes <= 0) continue;
    const repo = p.repo ?? "repo";
    byRepo.set(repo, { repo, commit: p.commit ?? null, changes });
  }
  return [...byRepo.values()];
}

/** Repositories pushed by all the task's sessions: a task rerun, resumed after an inbox pause or
 *  after a failure has several, on the same branch. */
export function pushedReposOfTask(taskId: string): PushedRepo[] {
  return pushedRepos(pushEventsOf(sessionIdsOfTask(taskId)));
}

/**
 * Opens (or finds) the task's change request on each pushed repository.
 *
 * `{ status: "not-found" }` when the task does not exist: the route's 404.
 * `{ status: "no-push" }` when the task exists but no session pushed code: the 422. The forge would
 * refuse anyway, and the fallback targeting the agent's granted repositories went with it (rule of
 * 14/09: it protected against a purged trace that does not exist; `session_events` is never
 * deleted outside a full goal deletion).
 * `{ status: "opened", prs, errors }` otherwise: failures are named per repository, never silent,
 * and a partial success returns what it has.
 */
export async function openTaskPr(taskId: string): Promise<OpenPrOutcome> {
  const found = taskArtifactsDir(taskId);
  if (!found) return { status: "not-found" };
  const { dir, task } = found;

  const pushed = pushedReposOfTask(task.id);
  if (pushed.length === 0) return { status: "no-push" };
  const repoNames = pushed.map((p) => p.repo);

  const sessions = sessionsOfTask(task.id);
  // Mock touches neither secrets nor network. Same computation as the original route: all sessions
  // mock, otherwise one real session in the batch makes the PR real.
  const mock = sessions.length > 0 && sessions.every((s) => s.mock);

  const draftFile = path.join(dir, PR_DRAFT);
  const draft = fs.existsSync(draftFile) ? fs.readFileSync(draftFile, "utf8") : null;
  // `taskBranch`, not a local derivation: a fix task pushed to its PR's branch
  // (`externalRef.branch`), not to `legion/<scope>`. Used twice, for the forge and for the fallback
  // title's type (slice nav/18): same branch, same reading.
  const branch = taskBranch(task);
  const { title, body } = prDraft({
    draft,
    task,
    branch,
    pushed,
    endReason: lastFailureReason(sessions),
  });

  const result = await createChangeRequests({
    projectId: task.projectId,
    repoNames,
    branch,
    title,
    body,
    mock,
  });

  if (result.prs.length) {
    let existing: { repo: string; url: string }[] = [];
    try {
      existing = JSON.parse(task.prUrls) as { repo: string; url: string }[];
    } catch {
      existing = []; // unreadable column: start from the PRs just obtained
    }
    const merged = [
      ...existing.filter((e) => !result.prs.some((p) => p.repo === e.repo)),
      ...result.prs.map((p) => ({ repo: p.repo, url: p.url })),
    ];
    mergeTaskPrUrls(task.id, JSON.stringify(merged));
    // `existing` = the request was already open on this branch: do not notify again, or every
    // session end would ring for the same PR.
    for (const p of result.prs.filter((x) => !x.existing))
      notifyOut(NOTIF_EVENT.prCreated, {
        taskId: task.id,
        task: task.name,
        repo: p.repo,
        url: p.url,
      });
  }
  return { status: "opened", ...result };
}

/** The stop reason of the last session that ended in failure, `null` if none. The end status does
 *  not decide whether to open, it decides the shape: this sentence goes into the PR body (see
 *  `pr-draft.ts`). */
function lastFailureReason(sessions: readonly SessionRow[]): string | null {
  const ended = sessions
    .filter((s) => s.endedAt)
    .sort((a, b) => a.endedAt!.getTime() - b.endedAt!.getTime());
  const last = ended.at(-1);
  return last?.status === "failed" ? last.endReason : null;
}

/** The refusal text, in the trace. Named rather than rebuilt in two places. */
export const PR_NOT_OPENED = "PR not opened";

/**
 * The automatic path: called by `markSessionTerminal` for every session end.
 *
 * It never fails, and that is its main property. The session is over and the code pushed; failing
 * anything on a forge outage would lose the work twice. A failure is reported in the task's trace
 * (a `run_warning` on the session, already rendered by the timeline) and stops there; no status
 * moves.
 *
 * Does nothing when the session pushed nothing: by far the most frequent case, and it costs one
 * query.
 */
export async function openPrAfterSession(sessionId: string): Promise<void> {
  try {
    const session = sessionRow(sessionId);
    if (!session) return;
    // The question is asked of the task, not of the ending session (07/09). Held per session, the
    // rule missed twice on NrEQhvaC2W: the push of the session killed by the sweep arrived after its
    // recorded end, and the rerun, finding the commit already on the branch, pushed zero changes.
    // `openTaskPr` is idempotent at the forge: an already open PR is found, not duplicated.
    if (pushedReposOfTask(session.taskId).length === 0) return;
    const outcome = await openTaskPr(session.taskId);
    // The two other outcomes cannot happen here: the task exists (its session just ended) and the
    // push was checked just above. The `if` covers them by construction rather than by trusting the
    // caller.
    if (outcome.status !== "opened") return;
    if (outcome.errors.length)
      publish(sessionId, "run_warning", {
        message: `${PR_NOT_OPENED}: ${outcome.errors.join(" · ")}`,
      });
  } catch (err) {
    // Including a failure here: a bug in this module must not climb into a session's terminal path.
    // Say it in the trace, do not turn it into a failed session end.
    try {
      publish(sessionId, "run_warning", {
        message: `${PR_NOT_OPENED}: ${String((err as Error)?.message ?? err)}`,
      });
    } catch {
      // The database vanished under us (control plane shutting down): there is nowhere left to
      // write, and throwing here would do exactly what this function promises not to.
    }
  }
}
