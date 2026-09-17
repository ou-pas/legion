// Pre-review (v32, item 07 reframed, 24/08):
//
//  1. A comment is bounded and anchored: project repository only, whole line ≥ 1, non-empty capped
//     body; a refusal is named (the screen shows it as is).
//  2. Sending is atomic: block injected (replacing the previous one, never stacked), comments
//     marked sent, task to todo, session rerun on the same branch. If the rerun fails, everything
//     is restored (comments reopened, original status).
//  3. A sent comment cannot be deleted: it is in a past session's description.
//  4. The diff names its failures per repository: an inaccessible repository hides no other, and
//     "branch never pushed" is not an error.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
// Static because it is a type: erased at compile time, it does not open the database before
// `LEGION_DB` is set, unlike the dynamic imports below.
import type { Result } from "../http/from-result.js";

const dir = mkdtempSync(join(tmpdir(), "legion-review-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  addReviewComment,
  deleteReviewComment,
  fixCi,
  listReviewComments,
  resolveConflict,
  reviewBlock,
  sendReview,
  taskDiff,
  taskPrMergeStates,
} = await import("./review.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
// A task branch is formatted from its type, name and run scope (slice nav/15). Recompute it here
// rather than copying a digest: what these tests check is the branch's stability, not its value.
const { formatBranch } = await import("../tasks/task-branch.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { addBlocker } = await import("../tasks/blockers.js");
const { BRANCH_TYPE } = await import("../tasks/task-branch.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { REVIEW_SIDE } = await import("./review-enums.js");
const { REVIEW_COMMENT_STATUS } = await import("./review-enums.js");
const BRANCH = formatBranch(BRANCH_TYPE.chore, "task", "t1");

// Review services return their refusal since 06/09 instead of throwing. These helpers are all that
// change costs the tests: the message is still checked to the character, and now the status is too.
function value<T>(r: Result<T>): T {
  assert.ok(r.ok, r.ok ? "" : `unexpected refusal: ${r.error}`);
  return r.value;
}
function refusalOf<T>(r: Result<T>): { status: number; error: string } {
  assert.ok(!r.ok, "a refusal was expected, a success arrived");
  return { status: r.status, error: r.error };
}

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";

type Spec = import("../sessions/runner/types.js").SessionSpec;
let provisioned: Spec | null = null;
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned = spec;
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

function reset(withRunner = true) {
  const now = new Date();
  provisioned = null;
  db.delete(schema.reviewComments).run();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.repos).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "agent", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.repos)
    .values({
      id: "r-front",
      projectId: PROJECT,
      name: "front",
      url: "https://github.com/o/front.git",
      createdAt: now,
    })
    .run();
  db.insert(schema.repos)
    .values({
      id: "r-back",
      projectId: PROJECT,
      name: "back",
      url: "https://github.com/o/back.git",
      createdAt: now,
    })
    .run();
  if (withRunner)
    db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: PROJECT,
      name: "task",
      description: "The brief.",
      status: TASK_STATUS.review,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

const COMMENT = {
  repoName: "front",
  filePath: "src/app.tsx",
  line: 42,
  excerpt: "const x = 1;",
  body: "Use the token, not the hard-coded value.",
};
/** The comment created on `t1`, the most repeated gesture in the file. */
const added = (input: Parameters<typeof addReviewComment>[1] = COMMENT) =>
  value(addReviewComment("t1", input));
const taskRow = () => db.select().from(schema.tasks).where(eq(schema.tasks.id, "t1")).get()!;

describe("addReviewComment / deleteReviewComment: bounded, named refusals", () => {
  beforeEach(() => reset());

  it("accepts a complete comment and lists it", () => {
    assert.equal(added().status, REVIEW_COMMENT_STATUS.open);
    assert.equal(listReviewComments("t1").length, 1);
  });
  it("refuses empty body, invalid line, repository outside the project, by name, as 400", () => {
    assert.deepEqual(refusalOf(addReviewComment("t1", { ...COMMENT, body: "  " })), {
      status: 400,
      error: "empty comment",
    });
    assert.deepEqual(refusalOf(addReviewComment("t1", { ...COMMENT, line: 0 })), {
      status: 400,
      error: "invalid line",
    });
    assert.deepEqual(refusalOf(addReviewComment("t1", { ...COMMENT, line: 2.5 })), {
      status: 400,
      error: "invalid line",
    });
    assert.deepEqual(refusalOf(addReviewComment("t1", { ...COMMENT, repoName: "ghost" })), {
      status: 400,
      error: "repo “ghost” outside the project",
    });
  });
  it("an unknown task: 404, not 400, the id designates nothing", () => {
    assert.deepEqual(refusalOf(addReviewComment("ghost", COMMENT)), {
      status: 404,
      error: "task not found",
    });
  });
  it("deletes an open comment; never a sent one (history is not rewritten)", async () => {
    deleteReviewComment(added().id);
    assert.equal(listReviewComments("t1").length, 0);
    const c2 = added();
    await sendReview("t1");
    // 409: the comment exists, its state forbids removing it.
    assert.deepEqual(refusalOf(deleteReviewComment(c2.id)), {
      status: 409,
      error: "comment already sent — it belongs to a past review",
    });
    assert.deepEqual(refusalOf(deleteReviewComment("ghost")), {
      status: 404,
      error: "comment not found",
    });
  });
});

describe("side and range (v33): a line number alone designates nothing", () => {
  beforeEach(() => reset());

  it("the default side is new, the one the agent finds on its branch", () => {
    assert.equal(added().side, REVIEW_SIDE.new);
  });

  it("two comments on the same line number but different sides coexist", () => {
    const a = added({ ...COMMENT, side: REVIEW_SIDE.old });
    const b = added({ ...COMMENT, side: REVIEW_SIDE.new });
    assert.notEqual(a.id, b.id);
    assert.deepEqual(
      listReviewComments("t1")
        .map((c) => c.side)
        .sort(),
      [REVIEW_SIDE.new, REVIEW_SIDE.old],
    );
  });

  it("refuses an unknown side, naming it", () => {
    assert.deepEqual(refusalOf(addReviewComment("t1", { ...COMMENT, side: "left" })), {
      status: 400,
      error: "invalid side (old | new)",
    });
  });

  it("a range is anchored on its last line; a one-line range is stored as null", () => {
    assert.equal(added({ ...COMMENT, startLine: 40 }).startLine, 40);
    assert.equal(added({ ...COMMENT, startLine: 42 }).startLine, null, "42-42 is 42");
  });

  it("refuses a range starting after its end, or an absurd bound", () => {
    assert.deepEqual(refusalOf(addReviewComment("t1", { ...COMMENT, startLine: 99 })), {
      status: 400,
      error: "the range starts after its last line",
    });
    assert.deepEqual(refusalOf(addReviewComment("t1", { ...COMMENT, startLine: 0 })), {
      status: 400,
      error: "invalid start line",
    });
  });

  it("the sent block carries the range and names the old side", () => {
    const range = reviewBlock([{ ...COMMENT, startLine: 40, side: REVIEW_SIDE.new }]);
    assert.ok(range.includes("### front/src/app.tsx:40-42"), range);
    assert.ok(!range.includes("deleted line"), "nothing to flag on the new side");
    const old = reviewBlock([{ ...COMMENT, side: REVIEW_SIDE.old }]);
    assert.ok(old.includes("### front/src/app.tsx:42 (deleted line — old side of the diff)"), old);
  });
});

describe("sendReview: atomic, block + todo + rerun, or nothing", () => {
  beforeEach(() => reset());

  it("injects the block, marks sent, moves to todo and reruns on the same branch", async () => {
    added();
    added({
      ...COMMENT,
      repoName: "back",
      filePath: "src/db.ts",
      line: 7,
      body: "The transaction is missing.",
    });
    const res = value(await sendReview("t1"));
    assert.equal(res.count, 2);
    assert.notEqual(res.launched, "queued");
    const t = taskRow();
    // "todo" is only an instant: runTask marks the task started right away, and the fake runner
    // ends at once. Since batch 82 a finished session tidies its task even on success, so the
    // observable state here would depend on a race. Assert what depends on no timing: the task
    // left the queue. The proof of the rerun is below, `provisioned` and its branch.
    assert.notEqual(t.status, TASK_STATUS.todo, "sending reran, it did not only move");
    assert.ok(t.description.startsWith("The brief."), "the original brief is kept");
    assert.ok(t.description.includes("## Operator review"));
    assert.ok(t.description.includes("### front/src/app.tsx:42"));
    assert.ok(t.description.includes("### back/src/db.ts:7"));
    assert.ok(listReviewComments("t1").every((c) => c.status === REVIEW_COMMENT_STATUS.sent));
    await new Promise((r) => setTimeout(r, 80)); // runLifecycle is fire-and-forget
    assert.ok(provisioned, "a session started");
    assert.equal(provisioned.repoBranch, BRANCH, "same branch as the first run");
    assert.ok(
      provisioned.taskDescription.includes("Operator review"),
      "the session reads the review",
    );
  });

  it("a second send replaces the first block, never stacked", async () => {
    added();
    await sendReview("t1");
    // The fake session ends at once: the task can be commented again.
    await new Promise((r) => setTimeout(r, 80));
    db.update(schema.sessions).set({ status: "destroyed" }).run();
    added({ ...COMMENT, line: 99, body: "Second pass." });
    await sendReview("t1");
    const d = taskRow().description;
    assert.equal(d.split("## Operator review").length, 2, "a single review block");
    assert.ok(d.includes(":99"), "it is the latest review");
    assert.ok(!d.includes(":42"), "the first one was replaced");
  });

  it("replaces a review block written under the French heading", async () => {
    db.update(schema.tasks)
      .set({ description: "The brief.\n\n## Revue de l'opérateur (ancien)\nold block" })
      .where(eq(schema.tasks.id, "t1"))
      .run();
    added();
    await sendReview("t1");
    const d = taskRow().description;
    assert.ok(d.startsWith("The brief.\n\n## Operator review"), d);
    assert.ok(!d.includes("old block"), "the French block was replaced, not kept");
  });

  // 409 for both: nothing to fix in the request, the state refuses, and it changes (a comment is
  // added, the session ends). The route's `catch` used to return 400.
  it("refuses no comment and an active session, naming them", async () => {
    assert.deepEqual(refusalOf(await sendReview("t1")), {
      status: 409,
      error: "no comment pending",
    });
    added();
    db.insert(schema.sessions)
      .values({
        id: "s-live",
        taskId: "t1",
        agentId: AGENT,
        runnerId: RUNNER,
        model: "m",
        status: "running",
        callbackToken: "tok",
        mock: true,
        startedAt: new Date(),
      })
      .run();
    const busy = refusalOf(await sendReview("t1"));
    assert.equal(busy.status, 409);
    assert.match(busy.error, /session is already working.*s-live/);
  });

  // The rerun stays an exception: it already carries its status (`launch-errors.ts`), and
  // `sendReview` rethrows it after restoring the state rather than flattening it.
  it("rerun impossible → everything restored: comments reopened, original status and brief", async () => {
    reset(false); // no runner: runTask throws "no enabled runner"
    added();
    await assert.rejects(() => sendReview("t1"), /runner/);
    const t = taskRow();
    assert.equal(t.status, TASK_STATUS.review);
    assert.equal(t.description, "The brief.");
    assert.ok(
      listReviewComments("t1").every(
        (c) => c.status === REVIEW_COMMENT_STATUS.open && c.sentAt === null,
      ),
    );
  });
});

describe("taskDiff: failures named per repository, missing branch ≠ error", () => {
  beforeEach(() => reset());

  it("aggregates the project's repositories on the task branch", async () => {
    // The loop over repositories lives in forge-access.ts (26/08, forge port): what is injected
    // here is "the project's diff", not "one repository's diff".
    const { branch, repos } = value(
      await taskDiff("t1", async (_projectId, br) => [
        {
          repo: "front",
          branch: br,
          files: [
            {
              path: "a.ts",
              status: "modified",
              additions: 1,
              deletions: 0,
              patch: "@@ -1 +1,2 @@",
            },
          ],
          error: null,
        },
        { repo: "back", branch: br, files: null, error: null }, // nothing pushed on back
      ]),
    );
    assert.equal(branch, BRANCH);
    assert.equal(repos.length, 2);
    // Repository read order is not guaranteed: look up by name, not index.
    const front = repos.find((r) => r.repo === "front")!;
    const back = repos.find((r) => r.repo === "back")!;
    assert.equal(front.files!.length, 1);
    assert.equal(back.files, null);
    assert.equal(back.error, null);
  });

  it("a failing repository is named in the response, without hiding the others", async () => {
    const { repos } = value(
      await taskDiff("t1", async (_projectId, br) => [
        { repo: "front", branch: br, files: [], error: null },
        { repo: "back", branch: br, files: null, error: "repository inaccessible (403)" },
      ]),
    );
    assert.equal(repos.find((r) => r.repo === "back")!.error, "repository inaccessible (403)");
    assert.deepEqual(repos.find((r) => r.repo === "front")!.files, []);
  });

  it("an unknown task: a named 404, the same message as everywhere else", async () => {
    assert.deepEqual(refusalOf(await taskDiff("ghost")), {
      status: 404,
      error: "task not found",
    });
  });
});

describe("taskPrMergeStates: what the PR tab looks at to offer conflict resolution", () => {
  beforeEach(() => reset());

  it("reads task.prUrls and passes it as is to the injected resolution", async () => {
    db.update(schema.tasks)
      .set({
        prUrls: JSON.stringify([{ repo: "front", url: "https://github.com/o/front/pull/62" }]),
      })
      .where(eq(schema.tasks.id, "t1"))
      .run();
    let received: unknown;
    const out = value(
      await taskPrMergeStates("t1", async (projectId, prs) => {
        received = [projectId, prs];
        return prs.map((p) => ({ ...p, number: 62, mergeState: "conflict" as const }));
      }),
    );
    assert.deepEqual(received, [
      PROJECT,
      [{ repo: "front", url: "https://github.com/o/front/pull/62" }],
    ]);
    assert.equal(out[0]!.mergeState, "conflict");
  });

  it("a damaged prUrls falls back to no PR, never a broken page", async () => {
    db.update(schema.tasks).set({ prUrls: "{not json" }).where(eq(schema.tasks.id, "t1")).run();
    const out = value(
      await taskPrMergeStates("t1", async (_pid, prs) =>
        prs.map((p) => ({ ...p, number: null, mergeState: "unknown" as const })),
      ),
    );
    assert.deepEqual(out, []);
  });
});

type ResolveRepos = typeof import("../integrations/forge-access.js").resolveForgeRepos;

/** A fake `resolveForgeRepos` always returning the same merge state whatever the repository: that
 *  is all `resolveConflict` looks at on the adapter. */
function fakeResolveRepos(state: "conflict" | "mergeable" | "unknown"): ResolveRepos {
  return ((_projectId: string, repoNames?: readonly string[]) => ({
    resolved: (repoNames ?? []).map((name) => ({
      repo: { name, url: `https://github.com/o/${name}.git`, forge: "github" as const },
      adapter: {
        kind: "github" as const,
        changeRequestLabel: "pull request",
        projectPath: () => null,
        compareBranch: async () => ({ repo: name, branch: "", files: null, error: null }),
        listOpen: async () => [],
        mergeState: async () => state,
        mergeStateWithPrState: async () => ({
          mergeState: state,
          prState: REVIEW_COMMENT_STATUS.open,
        }),
        checks: async () => ({ state: "unknown" as const, failing: [] }),
        checkLog: async () => null,
        listMergedTitles: async () => [],
        getTokenOwnerLogin: async () => "test-user",
        listVerifiedEmails: async () => null,
        listRepos: async () => null,
        assignChangeRequest: async () => true,
        create: async () => ({ ok: false as const, error: "n/a" }),
        createRepoHook: async () => ({ ok: true as const, id: "hook-test", existing: false }),
      },
      token: "tok",
    })),
    errors: (repoNames ?? []).length ? [] : [{ repo: "?", error: "no repository requested" }],
    truncated: 0,
  })) as ResolveRepos;
}

describe("resolveConflict: same mechanics as sendReview, block + todo + rerun, or nothing", () => {
  beforeEach(() => {
    reset();
    // `resolveConflict` refuses a {repo, number} pair the task does not already carry; these two
    // PRs are the ones the tests below target.
    db.update(schema.tasks)
      .set({
        prUrls: JSON.stringify([
          { repo: "front", url: "https://github.com/o/front/pull/62" },
          { repo: "back", url: "https://github.com/o/back/pull/9" },
        ]),
      })
      .where(eq(schema.tasks.id, "t1"))
      .run();
  });

  // 409: the PR exists and the request is correct; the merge state, re-read just now, makes the
  // gesture moot. It will change on its own, which a 400 did not suggest.
  it("re-checks the merge state before rerunning, refusing once it is no longer conflict", async () => {
    const merged = refusalOf(
      await resolveConflict("t1", { repoName: "front", number: 62 }, fakeResolveRepos("mergeable")),
    );
    assert.equal(merged.status, 409);
    assert.match(merged.error, /is no longer in conflict/);
    const unknown = refusalOf(
      await resolveConflict("t1", { repoName: "front", number: 62 }, fakeResolveRepos("unknown")),
    );
    assert.equal(unknown.status, 409);
    assert.match(unknown.error, /not known yet/);
    // Nothing moved: neither description nor status.
    const t = taskRow();
    assert.equal(t.status, TASK_STATUS.review);
    assert.equal(t.description, "The brief.");
  });

  it("injects the block, moves to todo and reruns on the same branch", async () => {
    const res = value(
      await resolveConflict("t1", { repoName: "front", number: 62 }, fakeResolveRepos("conflict")),
    );
    assert.notEqual(res.launched, "queued");
    const t = taskRow();
    assert.notEqual(t.status, TASK_STATUS.todo, "sending reran, it did not only move");
    assert.ok(t.description.startsWith("The brief."), "the original brief is kept");
    assert.ok(t.description.includes("## Conflict resolution"));
    assert.ok(t.description.includes("pull request #62"));
    assert.ok(t.description.includes("do NOT rebase"));
    await new Promise((r) => setTimeout(r, 80)); // runLifecycle is fire-and-forget
    assert.ok(provisioned, "a session started");
    assert.equal(provisioned.repoBranch, BRANCH, "same branch as the first run");
  });

  // 10/09: a blocker must not let a PR rot. The blocker says when the task can be finished;
  // resolving an open PR's conflict maintains work already delivered. Seen on `T6ywbnqS3Y`: blocked
  // by a follow-up task depending on its merge, so no gesture left on its PR, and the refusal came
  // out as a 500 on top.
  it("reruns even if the task has a blocker: the PR is already open", async () => {
    db.insert(schema.tasks)
      .values({
        id: "blocker",
        projectId: PROJECT,
        name: "the follow-up",
        status: TASK_STATUS.later,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    addBlocker("t1", "blocker");
    const res = value(
      await resolveConflict("t1", { repoName: "front", number: 62 }, fakeResolveRepos("conflict")),
    );
    assert.notEqual(res.launched, "queued");
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(provisioned, "a session started despite the blocker");
  });

  it("a second call replaces the first block, never stacked", async () => {
    await resolveConflict("t1", { repoName: "front", number: 62 }, fakeResolveRepos("conflict"));
    await new Promise((r) => setTimeout(r, 80));
    db.update(schema.sessions).set({ status: "destroyed" }).run();
    await resolveConflict("t1", { repoName: "back", number: 9 }, fakeResolveRepos("conflict"));
    const d = taskRow().description;
    assert.equal(d.split("## Conflict resolution").length, 2, "a single block");
    assert.ok(d.includes("#9"), "it is the latest call");
    assert.ok(!d.includes("#62"), "the first one was replaced");
  });

  it("replaces a conflict block written under the French heading", async () => {
    db.update(schema.tasks)
      .set({ description: "The brief.\n\n## Résolution de conflit (ancien)\nold block" })
      .where(eq(schema.tasks.id, "t1"))
      .run();
    await resolveConflict("t1", { repoName: "front", number: 62 }, fakeResolveRepos("conflict"));
    const d = taskRow().description;
    assert.ok(d.startsWith("The brief.\n\n## Conflict resolution"), d);
    assert.ok(!d.includes("old block"), "the French block was replaced, not kept");
  });

  it("refuses: a session is already working on the task", async () => {
    db.insert(schema.sessions)
      .values({
        id: "s-live",
        taskId: "t1",
        agentId: AGENT,
        runnerId: RUNNER,
        model: "m",
        status: "running",
        callbackToken: "tok",
        mock: true,
        startedAt: new Date(),
      })
      .run();
    const busy = refusalOf(
      await resolveConflict("t1", { repoName: "front", number: 62 }, fakeResolveRepos("conflict")),
    );
    assert.equal(busy.status, 409);
    assert.match(busy.error, /session is already working.*s-live/);
  });

  it("rerun impossible → everything restored: original status and description", async () => {
    reset(false); // no runner: runTask throws "no enabled runner"
    db.update(schema.tasks)
      .set({
        prUrls: JSON.stringify([{ repo: "front", url: "https://github.com/o/front/pull/62" }]),
      })
      .where(eq(schema.tasks.id, "t1"))
      .run();
    await assert.rejects(
      () => resolveConflict("t1", { repoName: "front", number: 62 }, fakeResolveRepos("conflict")),
      /runner/,
    );
    const t = taskRow();
    assert.equal(t.status, TASK_STATUS.review);
    assert.equal(t.description, "The brief.");
  });

  it("refuses a {repo, number} pair the task does not already carry, never guessed", async () => {
    // The task does have a PR on front#62 (set in beforeEach), but not on back#999: neither the
    // repository (`ghost`) nor the number alone is enough to allow it.
    assert.deepEqual(
      refusalOf(
        await resolveConflict(
          "t1",
          { repoName: "back", number: 999 },
          fakeResolveRepos("conflict"),
        ),
      ),
      {
        status: 404,
        error: "no open PR on back#999 attached to this task",
      },
    );
    assert.deepEqual(
      refusalOf(
        await resolveConflict(
          "t1",
          { repoName: "ghost", number: 62 },
          fakeResolveRepos("conflict"),
        ),
      ),
      {
        status: 404,
        error: "no open PR on ghost#62 attached to this task",
      },
    );
  });

  // 502, not 400: the forge did not answer. The message is the forge's, and the screen no longer
  // suggests fixing a request that was fine.
  it("a forge failure on the merge state is a 502, with the forge's message", async () => {
    const brokenForge = ((_projectId: string, names: string[]) => ({
      resolved: names.map((repo) => ({
        repo,
        token: "tok",
        adapter: {
          changeRequestLabel: "pull request",
          mergeState: async () => {
            throw new Error("502 Bad Gateway — github.com");
          },
        },
      })),
      errors: [],
    })) as unknown as ResolveRepos;
    assert.deepEqual(
      refusalOf(await resolveConflict("t1", { repoName: "front", number: 62 }, brokenForge)),
      {
        status: 502,
        error: "502 Bad Gateway — github.com",
      },
    );
  });
});

describe("reviewBlock: the format the agent reads", () => {
  it("groups by repo/path:line anchor, quotes the excerpt as a blockquote", () => {
    const block = reviewBlock([
      { repoName: "front", filePath: "a.tsx", line: 3, excerpt: "x\ny", body: "Fix it." },
    ]);
    assert.ok(block.includes("### front/a.tsx:3"));
    assert.ok(block.includes("> x\n> y"), "multi-line excerpt quoted line by line");
    assert.ok(block.includes("human instructions"));
  });
});

/** The same fake forge access with the CI probe wired in: `checks` returns the requested report,
 *  `checkLog` the wanted output (or `null` for a token without `actions:read`), and `compareBranch`
 *  the PR's files. Everything else comes from `fakeResolveRepos`. */
function fakeCiRepos(
  report: import("../integrations/forge.js").ChecksReport,
  opts: {
    log?: string | null;
    files?:
      | {
          path: string;
          status: string;
          additions: number;
          deletions: number;
          patch: string | null;
        }[]
      | null;
  } = {},
): ResolveRepos {
  const base = fakeResolveRepos("mergeable");
  return ((projectId: string, names?: readonly string[], cap?: number) => {
    const access = base(projectId, names, cap);
    return {
      ...access,
      resolved: access.resolved.map((r) => ({
        ...r,
        adapter: {
          ...r.adapter,
          checks: async () => report,
          checkLog: async () => opts.log ?? null,
          compareBranch: async () => ({
            repo: r.repo.name,
            branch: BRANCH,
            files: opts.files ?? null,
            error: null,
          }),
        },
      })),
    };
  }) as ResolveRepos;
}

const RED = {
  state: "failing" as const,
  failing: [
    {
      id: "102031171336",
      name: "tests (node 20)",
      url: "https://github.com/o/front/actions/runs/9/job/102031171336",
    },
  ],
};

describe("fixCi: sister of resolveConflict, block + todo + rerun, or nothing", () => {
  beforeEach(() => {
    reset();
    db.update(schema.tasks)
      .set({
        prUrls: JSON.stringify([{ repo: "front", url: "https://github.com/o/front/pull/62" }]),
      })
      .where(eq(schema.tasks.id, "t1"))
      .run();
  });

  it("injects the job, its verbatim log and the PR's files, then reruns on the same branch", async () => {
    const res = value(
      await fixCi(
        "t1",
        { repoName: "front", number: 62 },
        fakeCiRepos(RED, {
          log: "FAIL src/report.test.tsx\nAssertionError: expected null to be a Spinner element",
          files: [
            { path: "src/report.tsx", status: "modified", additions: 3, deletions: 1, patch: null },
          ],
        }),
      ),
    );
    assert.notEqual(res.launched, "queued");
    const t = taskRow();
    assert.ok(t.description.startsWith("The brief."), "the original brief is kept");
    assert.ok(t.description.includes("## CI fix"));
    assert.ok(t.description.includes("tests (node 20)"), "the failed job is named");
    assert.ok(
      t.description.includes("AssertionError: expected null to be a Spinner element"),
      "the job output, word for word",
    );
    assert.ok(
      t.description.includes("- src/report.tsx (modified)"),
      "the PR's files: the agent's scope",
    );
    assert.ok(t.description.includes("PROOF MUST BE POSITIVE"));
    await new Promise((r) => setTimeout(r, 80)); // runLifecycle is fire-and-forget
    assert.ok(provisioned, "a session started");
    assert.equal(provisioned.repoBranch, BRANCH, "same branch as the first run");
  });

  it("a token without actions:read does not remove the gesture: the block says so and the session starts", async () => {
    value(
      await fixCi(
        "t1",
        { repoName: "front", number: 62 },
        fakeCiRepos(RED, { log: null, files: null }),
      ),
    );
    const d = taskRow().description;
    assert.ok(d.includes("`actions:read`"), d);
    assert.ok(
      d.includes("https://github.com/o/front/actions/runs/9/job/102031171336"),
      "the job URL stays",
    );
  });

  // Guard against a stale open screen: a manual push may have turned the CI green between the chip
  // showing and the click. 409 for all three states: the request is fine, the state refuses.
  it("re-probes before launching: refuses once the CI is no longer red (passing, pending, unknown)", async () => {
    for (const [state, phrase] of [
      ["passing", /is no longer failing/],
      ["pending", /has not finished running/],
      ["unknown", /uncertainty/],
    ] as const) {
      const out = refusalOf(
        await fixCi("t1", { repoName: "front", number: 62 }, fakeCiRepos({ state, failing: [] })),
      );
      assert.equal(out.status, 409, state);
      assert.match(out.error, phrase);
    }
    // Nothing moved and nothing started: no description, no status, no session.
    const t = taskRow();
    assert.equal(t.status, TASK_STATUS.review);
    assert.equal(t.description, "The brief.");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(provisioned, null, "an uncertainty never launches a session");
  });

  it("refuses: a session is already working on the task", async () => {
    db.insert(schema.sessions)
      .values({
        id: "s-live",
        taskId: "t1",
        agentId: AGENT,
        runnerId: RUNNER,
        model: "m",
        status: "running",
        callbackToken: "tok",
        mock: true,
        startedAt: new Date(),
      })
      .run();
    const busy = refusalOf(await fixCi("t1", { repoName: "front", number: 62 }, fakeCiRepos(RED)));
    assert.equal(busy.status, 409);
    assert.match(busy.error, /session is already working.*s-live/);
  });

  it("refuses a {repo, number} pair the task does not carry: the route is open to anyone who can post", async () => {
    assert.deepEqual(
      refusalOf(await fixCi("t1", { repoName: "front", number: 999 }, fakeCiRepos(RED))),
      {
        status: 404,
        error: "no open PR on front#999 attached to this task",
      },
    );
    assert.deepEqual(
      refusalOf(await fixCi("t1", { repoName: "ghost", number: 62 }, fakeCiRepos(RED))),
      {
        status: 404,
        error: "no open PR on ghost#62 attached to this task",
      },
    );
  });

  it("a forge failure on the probe is a 502, with the forge's message", async () => {
    const broken = ((projectId: string, names: readonly string[], cap?: number) => {
      const access = fakeResolveRepos("mergeable")(projectId, names, cap);
      return {
        ...access,
        resolved: access.resolved.map((r) => ({
          ...r,
          adapter: {
            ...r.adapter,
            checks: async () => {
              throw new Error("502 Bad Gateway — github.com");
            },
          },
        })),
      };
    }) as ResolveRepos;
    assert.deepEqual(refusalOf(await fixCi("t1", { repoName: "front", number: 62 }, broken)), {
      status: 502,
      error: "502 Bad Gateway — github.com",
    });
  });

  it("a second call replaces the first block, never stacked", async () => {
    await fixCi(
      "t1",
      { repoName: "front", number: 62 },
      fakeCiRepos(RED, { log: "first failure" }),
    );
    await new Promise((r) => setTimeout(r, 80));
    db.update(schema.sessions).set({ status: "destroyed" }).run();
    await fixCi(
      "t1",
      { repoName: "front", number: 62 },
      fakeCiRepos(RED, { log: "second failure" }),
    );
    const d = taskRow().description;
    assert.equal(d.split("## CI fix").length, 2, "a single block");
    assert.ok(
      d.includes("second failure") && !d.includes("first failure"),
      "it is the latest call",
    );
  });

  it("replaces a CI block written under the French heading", async () => {
    db.update(schema.tasks)
      .set({ description: "The brief.\n\n## Correction de la CI (ancien)\nold block" })
      .where(eq(schema.tasks.id, "t1"))
      .run();
    await fixCi("t1", { repoName: "front", number: 62 }, fakeCiRepos(RED, { log: "failure" }));
    const d = taskRow().description;
    assert.ok(d.startsWith("The brief.\n\n## CI fix"), d);
    assert.ok(!d.includes("old block"), "the French block was replaced, not kept");
  });

  it("rerun impossible → everything restored: original status and description", async () => {
    reset(false); // no runner: runTask throws "no enabled runner"
    db.update(schema.tasks)
      .set({
        prUrls: JSON.stringify([{ repo: "front", url: "https://github.com/o/front/pull/62" }]),
      })
      .where(eq(schema.tasks.id, "t1"))
      .run();
    await assert.rejects(
      () => fixCi("t1", { repoName: "front", number: 62 }, fakeCiRepos(RED)),
      /runner/,
    );
    const t = taskRow();
    assert.equal(t.status, TASK_STATUS.review);
    assert.equal(t.description, "The brief.");
  });
});
