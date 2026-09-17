// Review routes: change requests (GitHub PR / GitLab MR), the pr.md flow, pre-review (diff +
// comments). No forge is named here: everything goes through the port (`integrations/forge.ts`)
// and its composition (`forge-access.ts`).
import { Hono } from "hono";
import {
  addReviewComment,
  deleteReviewComment,
  fixCi,
  listReviewComments,
  resolveConflict,
  sendReview,
  taskDiff,
  taskPrMergeStates,
} from "../review/review.js";
import { listOpenChangeRequests } from "../integrations/forge-access.js";
import { z } from "zod";
import { parseBody } from "../http/parse-body.js";
import { done, fromResult, refuse } from "../http/from-result.js";
import { openTaskPr } from "./open-pr.js";

// No `crossOriginBlocked` calls here since 06/09: they duplicated `mutationOriginGuard`
// (http/guard.ts), which already covers the four mutating verbs outside `/internal` and `/webhooks`,
// and having them on four routes only suggested the others were unguarded.

/** Body of `POST /api/tasks/:id/resolve-conflict`: the PR to rescue, named by its repository.
 *  `POST /api/tasks/:id/fix-ci` takes exactly the same: the PR designates the gesture, not the job
 *  (the server re-probes it; a job number sent by the screen would already be stale). */
const changeRequestTargetBody = z.strictObject({ repoName: z.string(), number: z.number() });

/** A pre-review comment body. It used to be read as `Record<string, unknown>`: any key got in, and
 *  the contract was written nowhere. Values are still judged by `addReviewComment` (caps, coherent
 *  range, read-only demo project), which names them better than a type would. */
const reviewCommentBody = z.strictObject({
  repoName: z.string(),
  filePath: z.string(),
  line: z.number(),
  side: z.string().optional(),
  startLine: z.number().nullable().optional(),
  excerpt: z.string().optional(),
  body: z.string(),
});

export function registerReviewRoutes(app: Hono): void {
  // `listOpenChangeRequests` lives in `integrations/` and still throws a bare `Error` when the
  // forge does not answer: the `.then` returns that refusal as 502 instead of building a response
  // in a `catch`. These two lines go once `forge-access.ts` returns its own `Result`.
  app.get("/api/github/prs", async (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const prs = await listOpenChangeRequests(projectId).then(done, (e: Error) =>
      refuse(502, e.message),
    );
    return fromResult(c, prs);
  });

  // PR flow: the human gesture, no longer the only path (slice nav/12). The body lives in
  // `open-pr.ts`, shared with session end: a session that pushed code opens its PR on its own. The
  // button stays to reopen a closed request.
  //
  // `pr.md` is a preference, not a condition: without it, title and body are built from the task
  // and the pushed repositories (`pr-draft.ts`).
  //
  // The 422 is back for another reason (14/09, interview "PR button on channel"): with no
  // `repo_push` traced on the task, the forge always answers "No commits between main and
  // legion/…". The refusal is for the whole task, never per repository (that is the 201/502
  // response's contract). The fallback targeting the agent's granted repositories went with it.
  app.post("/api/tasks/:id/pr", async (c) => {
    const outcome = await openTaskPr(c.req.param("id"));
    if (outcome.status === "not-found") return c.json({ error: "task not found" }, 404);
    if (outcome.status === "no-push")
      return c.json({ error: "no repo pushed for this task — nothing to open" }, 422);
    const { prs, errors } = outcome;
    return c.json({ prs, errors }, prs.length ? 201 : 502);
  });

  // Pre-review (v32, item 07 reframed, crit.md loop). The task branch's diff, repository by
  // repository (failures named per repository, in the response).
  app.get("/api/tasks/:id/diff", async (c) => fromResult(c, await taskDiff(c.req.param("id"))));

  // Merge state of the task's already open PRs, read on demand when the PR tab looks (never a
  // background poller, see `mergeStatesOf`).
  app.get("/api/tasks/:id/pr-merge-state", async (c) =>
    fromResult(c, await taskPrMergeStates(c.req.param("id"))),
  );

  // "Resolve conflicts": reruns a session on the same task, instructed to merge the default branch
  // and resolve. Reloads and re-checks the merge state before rerunning (see `resolveConflict`),
  // never on the request body's word.
  app.post("/api/tasks/:id/resolve-conflict", async (c) => {
    const parsed = await parseBody(c, changeRequestTargetBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const repoName = parsed.value.repoName.trim();
    const { number } = parsed.value;
    if (!repoName || !Number.isInteger(number) || number <= 0)
      return c.json({ error: "repoName and number (positive integer) required" }, 400);
    return fromResult(c, await resolveConflict(c.req.param("id"), { repoName, number }), 201);
  });

  // "Fix CI": sister of the route above, on the other probe. It re-reads the checks' state at the
  // forge before launching (see `fixCi`) and refuses anything no longer red, including pending and
  // unknown. The job to fix is not in the body: the server finds it at click time.
  app.post("/api/tasks/:id/fix-ci", async (c) => {
    const parsed = await parseBody(c, changeRequestTargetBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const repoName = parsed.value.repoName.trim();
    const { number } = parsed.value;
    if (!repoName || !Number.isInteger(number) || number <= 0)
      return c.json({ error: "repoName and number (positive integer) required" }, 400);
    return fromResult(c, await fixCi(c.req.param("id"), { repoName, number }), 201);
  });

  // `listReviewComments` only reads the comments table and never looks up the task, so there is
  // nothing to catch.
  app.get("/api/tasks/:id/review-comments", (c) => c.json(listReviewComments(c.req.param("id"))));

  app.post("/api/tasks/:id/review-comments", async (c) => {
    const parsed = await parseBody(c, reviewCommentBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return fromResult(c, addReviewComment(c.req.param("id"), parsed.value), 201);
  });

  app.delete("/api/review-comments/:id", (c) =>
    fromResult(c, deleteReviewComment(c.req.param("id"))),
  );

  // Sending: block in the description (replaces the previous one), task to todo, session rerun on
  // the same branch. `launched: "queued"` = at capacity, the queue will take it.
  app.post("/api/tasks/:id/review-send", async (c) =>
    fromResult(c, await sendReview(c.req.param("id"))),
  );
}
