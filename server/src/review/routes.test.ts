// Pre-review HTTP wiring (06/09): the door, not the rule. `review.ts` holds and tests the rules;
// this file checks what gets lost on the way. The domain's two mutating bodies arrived one as
// `Record<string, unknown>` (no written contract) and the other as `String(body.x ?? "")` (a number
// coerced into a repository name). A schema now handles both, and those refusals are checked here.
//
// No forge is reached: everything here stops before, at the schema or at the first database read.
// Routes that really call GitHub (`/pr`, `/review-send`, `/pr-merge-state`) are tested in
// `open-pr.test.ts` and `review.test.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-review-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { mutationOriginGuard } = await import("../http/guard.js");
const { registerReviewRoutes } = await import("./routes.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");

const app = new Hono();
app.use("*", mutationOriginGuard);
registerReviewRoutes(app);

const P1 = "p1";
const T1 = "t1";
const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
const comment = {
  repoName: "legion",
  filePath: "server/src/http/app.ts",
  line: 12,
  side: "new",
  excerpt: "app.onError",
  body: "why here?",
};

beforeEach(() => {
  const now = new Date();
  db.delete(schema.reviewComments).run();
  db.delete(schema.repos).run();
  db.delete(schema.tasks).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P1, name: "P1", slug: "p1", createdAt: now }).run();
  // A comment is anchored in a project repository: `addReviewComment` refuses a name it does not
  // know, so a comment never goes to a PR that does not exist.
  db.insert(schema.repos)
    .values({
      id: "r1",
      projectId: P1,
      name: "legion",
      url: "https://github.com/x/legion",
      createdAt: now,
    })
    .run();
  db.insert(schema.tasks)
    .values({
      id: T1,
      projectId: P1,
      name: "task",
      status: TASK_STATUS.review,
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

describe("pre-review comments", () => {
  it("happy path: the comment is written, then read back by the read route", async () => {
    const res = await post(`/api/tasks/${T1}/review-comments`, comment);
    assert.equal(res.status, 201);

    const list = (await (await app.request(`/api/tasks/${T1}/review-comments`)).json()) as {
      body: string;
    }[];
    assert.equal(list.length, 1);
    assert.equal(list[0]!.body, "why here?");
  });

  it("the comment is deleted, and the list empties", async () => {
    const { id } = (await (await post(`/api/tasks/${T1}/review-comments`, comment)).json()) as {
      id: string;
    };
    assert.equal(
      (await app.request(`/api/review-comments/${id}`, { method: "DELETE" })).status,
      200,
    );
    assert.deepEqual(await (await app.request(`/api/tasks/${T1}/review-comments`)).json(), []);
  });

  it("an invented key is refused by name: the body is no longer an open bag", async () => {
    const res = await post(`/api/tasks/${T1}/review-comments`, { ...comment, resolvedBy: "me" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /resolvedBy/);
    assert.equal(db.select().from(schema.reviewComments).all().length, 0);
  });

  it("a line sent as text is refused by the schema, no longer coerced to a number", async () => {
    const res = await post(`/api/tasks/${T1}/review-comments`, { ...comment, line: "12" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /line/);
  });

  it("an empty body is refused by `review.ts`, with its message", async () => {
    const res = await post(`/api/tasks/${T1}/review-comments`, { ...comment, body: "   " });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /empty comment/);
  });

  // 404, not 400 (06/09): the id designates nothing. The same message came out as 404 from `/diff`
  // and 400 from here, depending on which route's `catch` caught it.
  it("an unknown task: writing is refused, saying so; reading returns an empty list", async () => {
    const res = await post("/api/tasks/ghost/review-comments", comment);
    assert.equal(res.status, 404);
    assert.match(await errorOf(res), /task not found/);
    // Reading does not know the task: it filters comments and finds none. An empty list, not an
    // error; the screen shows "no comments".
    assert.deepEqual(await (await app.request("/api/tasks/ghost/review-comments")).json(), []);
  });

  it("a write from another origin is stopped by the middleware", async () => {
    assert.equal(
      (await post(`/api/tasks/${T1}/review-comments`, comment, { origin: "https://evil.example" }))
        .status,
      403,
    );
  });
});

describe("rerunning on a conflict", () => {
  it("a missing PR number is refused by name, before any forge read", async () => {
    const res = await post(`/api/tasks/${T1}/resolve-conflict`, { repoName: "legion" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /number/);
  });

  it("a negative number is refused by the route, which requires a positive integer", async () => {
    const res = await post(`/api/tasks/${T1}/resolve-conflict`, {
      repoName: "legion",
      number: -3,
    });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /positive integer/);
  });

  it("a repository named by a number is refused, no longer coerced to a string", async () => {
    const res = await post(`/api/tasks/${T1}/resolve-conflict`, { repoName: 12, number: 3 });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /repoName/);
  });
});

// 14/09 (interview "PR button on channel"): the 422 stops before the forge; none is registered in
// this file (see the header), and both cases still pass.
describe("opening the PR", () => {
  it("no traced `repo_push`: a 422 naming it, the forge is never called", async () => {
    const res = await post(`/api/tasks/${T1}/pr`);
    assert.equal(res.status, 422);
    assert.match(await errorOf(res), /repo/);
  });

  it("unknown task: 404", async () => {
    const res = await post("/api/tasks/ghost/pr");
    assert.equal(res.status, 404);
  });
});

describe("a project's open PRs", () => {
  it("without `projectId`: a 400 naming it, before any forge call", async () => {
    const res = await app.request("/api/github/prs");
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /projectId/);
  });
});
