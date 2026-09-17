// Pushed code yields a PR (slice nav/12), in the order of the slice's criteria:
//
//  AC#1: a session ending after a push opens a PR whatever its end status (`destroyed` or `failed`)
//  and whether or not the task has an approval gate; a session that pushed nothing opens none; a
//  `mock` session never opens a real PR and touches neither secrets nor network.
//
//  AC#2: a missing `pr.md` no longer blocks anything. The fallback is a pure function
//  (`pr-draft.ts`): input = the task and pushed repositories, output = title and body, which makes
//  the criterion checkable without a forge or container. An agent-written `pr.md` still wins,
//  checked end to end on what the adapter really receives.
//
//  AC#3: opening is idempotent and never fatal. Two session ends on the same branch do not create
//  two PRs (the adapter finds the open one, `existing: true`), and a forge failure is named in the
//  task's trace without touching the session's or the task's status.
//
// No network is touched: a fake adapter is registered in GitHub's place, which is what the
// `integrations/forge.ts` port exists for.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-open-pr-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY = "0123456789abcdef0123456789abcdef";
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { eq } = await import("drizzle-orm");
const { encryptSecret } = await import("../shared/crypto.js");
const { registerForge } = await import("../integrations/forge.js");
const forge = await import("../integrations/forge.js");
const { mergedTitlesByRepo, clearTokenOwnerLoginCache } =
  await import("../integrations/forge-access.js");
const { conventionalTitle, prDraft, titleExamplesPrompt } = await import("./pr-draft.js");
const { openPrAfterSession, openTaskPr } = await import("./open-pr.js");
const { markSessionTerminal, onSessionEnded } = await import("../sessions/session-terminal.js");
// The session-end hook (06/09): `index.ts` wires it in production, this test wires it here. That is
// exactly what AC#1 checks below: closing a session triggers opening, without `session-terminal.ts`
// knowing the forge.
onSessionEnded((sessionId) => void openPrAfterSession(sessionId).catch(() => {}));
// A task branch is formatted from its type, name and scope (slice nav/15): recompute it here rather
// than copying a digest into an assertion.
const { formatBranch } = await import("../tasks/task-branch.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { BRANCH_TYPE } = await import("../tasks/task-branch.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { REVIEW_COMMENT_STATUS } = await import("./review-enums.js");

const P = "p1",
  A = "a1",
  R = "r1",
  T = "t1";
const ARTIFACTS = join(dir, "fs", "p", "artifacts", T);

// The fake GitHub: records what it is asked, returns what it is told to.
type Created = { repo: string; branch: string; title: string; body: string };
const created: Created[] = [];
type Assigned = { repo: string; number: number; login: string };
const assigned: Assigned[] = [];
/** What the fake repository answers when asked for its latest merged titles (slice nav/18). A name
 *  absent from the map makes the read throw: criterion 3's failure path, which must be as easy to
 *  play as the happy path. */
const mergedTitles = new Map<string, string[]>();
let nextResult: import("../integrations/forge.js").CreateResult = {
  ok: true,
  url: "https://forge.test/pr/1",
  existing: false,
};
const fakeGitHub: import("../integrations/forge.js").ForgeAdapter = {
  kind: "github",
  changeRequestLabel: "pull request",
  projectPath: (url: string) => forge.pathOfRepoUrl(url),
  compareBranch: async (_t, repo, branch) => ({
    repo: repo.name,
    branch,
    files: null,
    error: null,
  }),
  listOpen: async () => [],
  mergeState: async () => "unknown",
  mergeStateWithPrState: async () => ({
    mergeState: "unknown" as const,
    prState: REVIEW_COMMENT_STATUS.open,
  }),
  checks: async () => ({ state: "unknown" as const, failing: [] }),
  checkLog: async () => null,
  createRepoHook: async () => ({ ok: true as const, id: "hook-test", existing: false }),
  listMergedTitles: async (_token: string, repo: { name: string }) => {
    const titles = mergedTitles.get(repo.name);
    if (titles === undefined) throw new Error(`read refused for ${repo.name}`);
    return titles;
  },
  getTokenOwnerLogin: async () => "test-operator",
  listVerifiedEmails: async () => null,
  listRepos: async () => null,
  assignChangeRequest: async (_token, repo, number, login) => {
    assigned.push({ repo: repo.name, number, login });
    return true;
  },
  create: async (_token, repo, opts) => {
    created.push({ repo: repo.name, ...opts });
    return nextResult;
  },
};
registerForge(fakeGitHub);

function reset(opts: { approvalGate?: boolean } = {}): void {
  created.length = 0;
  assigned.length = 0;
  clearTokenOwnerLoginCache();
  nextResult = { ok: true, url: "https://forge.test/pr/1", existing: false };
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.secrets).run();
  db.delete(schema.repos).run();
  db.delete(schema.agents).run();
  db.delete(schema.runners).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: A,
      projectId: P,
      name: "ag",
      rolePrompt: "r",
      repoNames: JSON.stringify(["front"]),
      createdAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: R, name: "local", kind: RUNNER_KIND.process }).run();
  db.insert(schema.repos)
    .values({
      id: "rp-front",
      projectId: P,
      name: "front",
      url: "https://github.com/o/front.git",
      createdAt: now,
    })
    .run();
  db.insert(schema.repos)
    .values({
      id: "rp-back",
      projectId: P,
      name: "back",
      url: "https://github.com/o/back.git",
      createdAt: now,
    })
    .run();
  db.insert(schema.tasks)
    .values({
      id: T,
      projectId: P,
      name: "Tidy the blockers",
      description: "The task brief.",
      status: TASK_STATUS.doing,
      assigneeAgentId: A,
      approvalGate: opts.approvalGate ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  rmSync(ARTIFACTS, { recursive: true, force: true });
}

/** The project token. Without it, resolution fails before the adapter: the failure path the last
 *  block uses. */
function withToken(): void {
  db.insert(schema.secrets)
    .values({
      id: "s1",
      projectId: P,
      name: "GITHUB_TOKEN",
      ciphertext: encryptSecret("t0k"),
      createdAt: new Date(),
    })
    .run();
}

function session(id: string, opts: { mock?: boolean } = {}): string {
  db.insert(schema.sessions)
    .values({
      id,
      taskId: T,
      agentId: A,
      runnerId: R,
      model: "m",
      status: "running",
      callbackToken: `c-${id}`,
      mock: opts.mock ?? false,
      startedAt: new Date(),
    })
    .run();
  return id;
}

function pushed(sessionId: string, repo: string, changes: number, commit = "a1b2c3d"): void {
  db.insert(schema.sessionEvents)
    .values({
      sessionId,
      type: "repo_push",
      payload: JSON.stringify({ repo, branch: "legion/t1", commit, changes }),
      createdAt: new Date(),
    })
    .run();
}

const task = () => db.select().from(schema.tasks).where(eq(schema.tasks.id, T)).get()!;
const prUrls = () => JSON.parse(task().prUrls) as { repo: string; url: string }[];
const warnings = () =>
  db
    .select()
    .from(schema.sessionEvents)
    .all()
    .filter((e) => e.type === "run_warning")
    .map((e) => (JSON.parse(e.payload) as { message: string }).message);

/** `markSessionTerminal` announces the end and returns: the hook opening the PR is fired, not
 *  awaited, by construction (it must delay and fail nothing). So wait for an observable
 *  consequence, with a cap.
 *
 *  The cap is generous and costs nothing: the loop exits as soon as the condition holds, and the
 *  server suite runs alongside the web one on a loaded machine. A tight cap would make an
 *  intermittently red test, a test one stops believing. */
async function until(cond: () => boolean, ms = 15_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return cond();
}

describe("pr-draft: the fallback is pure (AC#2)", () => {
  const TASK = { name: "Tidy the blockers", description: "The task brief." };
  const BRANCH = "chore/tidy-the-blockers-ab12cd34";
  const PUSHED = [
    { repo: "front", commit: "a1b2c3d", changes: 6 },
    { repo: "back", commit: "e4f5a6b", changes: 2 },
  ];

  it("without pr.md: title from the name, body from the brief and pushed repositories", () => {
    const { title, body } = prDraft({ draft: null, task: TASK, branch: BRANCH, pushed: PUSHED });
    assert.equal(title, "chore: Tidy the blockers");
    assert.match(body, /The task brief\./);
    assert.match(body, /`front` — 6 files · `a1b2c3d`/);
    assert.match(body, /`back` — 2 files · `e4f5a6b`/);
    assert.match(body, /did not drop a `pr\.md`/);
  });

  it("with pr.md: it wins, first line = title, the rest = body", () => {
    const { title, body } = prDraft({
      draft: "# The agent's title\n\nWhat the agent read in the diff.\n",
      task: TASK,
      branch: BRANCH,
      pushed: PUSHED,
    });
    assert.equal(title, "The agent's title");
    assert.equal(body, "What the agent read in the diff.");
  });

  it("an empty pr.md counts as absent: no untitled PR", () => {
    assert.equal(
      prDraft({ draft: "   \n\n ", task: TASK, branch: BRANCH, pushed: PUSHED }).title,
      "chore: Tidy the blockers",
    );
  });

  it("the stop reason goes into the body, and only when there is one", () => {
    const stopped = prDraft({
      draft: null,
      task: TASK,
      branch: BRANCH,
      pushed: PUSHED,
      endReason: "the agent process exited with code 1",
    });
    assert.match(stopped.body, /did not end normally/);
    assert.match(stopped.body, /code 1/);
    assert.doesNotMatch(
      prDraft({ draft: null, task: TASK, branch: BRANCH, pushed: PUSHED }).body,
      /did not end normally/,
    );
  });

  it("a too-long title is bounded, not left to the forge", () => {
    const { title } = prDraft({
      draft: null,
      task: { name: "x".repeat(200), description: "" },
      branch: BRANCH,
      pushed: [],
    });
    assert.ok(title.length <= 72, title.length.toString());
    assert.ok(title.endsWith("…"));
  });
});

// Slice nav/18: the title nobody re-reads.
//
// On 01/09, `AcmeHQ/frontend#526` was refused by its CI at 11:07 on a title starting with
// `legion: AI-1942 —`, then accepted at 11:20 after a hand-added "feat:". `legion` is a
// conventional type nowhere. Slice 15 had fixed exactly this fault on branches and left titles alone.
describe("the title carries a conventional type, never `legion:` (nav/18 AC#1)", () => {
  const TASK = { name: "AI-1942 — Extract the card wrapper", description: "" };

  // The repository's three branch types (`task-branch.ts`) and each one's commit type. Not the
  // identity: conventionalbranch.org says `feature`/`bugfix`, conventionalcommits.org `feat`/`fix`.
  for (const [branchType, commitType] of [
    [BRANCH_TYPE.chore, BRANCH_TYPE.chore],
    [BRANCH_TYPE.feature, "feat"],
    [BRANCH_TYPE.bugfix, "fix"],
  ]) {
    it(`branch \`${branchType}/…\` → title \`${commitType}: …\``, () => {
      const { title } = prDraft({
        draft: null,
        task: TASK,
        branch: `${branchType}/ai-1942-ab12cd34`,
        pushed: [],
      });
      assert.equal(title, `${commitType}: AI-1942 — Extract the card wrapper`);
    });
  }

  it("the type comes from the branch, not the task type: a fix pushes to its PR's branch", () => {
    // `taskBranch` returns `externalRef.branch` on a fix task: someone else's branch, which alone
    // decides what the title must say.
    assert.equal(
      prDraft({ draft: null, task: TASK, branch: "feature/AI-1900-the-wrapper", pushed: [] }).title,
      "feat: AI-1942 — Extract the card wrapper",
    );
  });

  it("a branch from another tool falls back to `chore`, never to nothing", () => {
    for (const branch of ["legion/JUoRZqThA5", "main", "", "release/2.4"])
      assert.match(
        prDraft({ draft: null, task: TASK, branch, pushed: [] }).title,
        /^chore: /,
        `branch "${branch}"`,
      );
  });

  it("no `legion:` comes out of this module any more", () => {
    for (const branch of ["chore/x-1", "feature/x-1", "bugfix/x-1", "legion/x"])
      assert.doesNotMatch(
        prDraft({ draft: null, task: TASK, branch, pushed: [] }).title,
        /legion:/,
      );
  });

  it("an already conventional task name is not prefixed twice", () => {
    assert.equal(
      prDraft({
        draft: null,
        task: { name: "fix(i18n): the button stays enabled", description: "" },
        branch: "chore/x-1",
        pushed: [],
      }).title,
      "fix(i18n): the button stays enabled",
    );
  });
});

describe("a session end opens the PR (AC#1)", () => {
  beforeEach(() => reset());

  it("pushed then ended in success: a PR on the pushed repository, and only there", async () => {
    withToken();
    const s = session("s-ok");
    pushed(s, "front", 6);
    markSessionTerminal(s, "destroyed", "the agent process exited with code 0");
    assert.ok(await until(() => prUrls().length === 1), "no PR opened");
    assert.deepEqual(
      created.map((c) => c.repo),
      ["front"],
    );
    assert.deepEqual(prUrls(), [{ repo: "front", url: "https://forge.test/pr/1" }]);
  });

  it("ended in failure, with an approval gate: the PR opens anyway", async () => {
    reset({ approvalGate: true });
    withToken();
    const s = session("s-ko");
    pushed(s, "front", 6);
    markSessionTerminal(s, "failed", "the agent process exited with code 1");
    assert.ok(await until(() => prUrls().length === 1), "no PR opened");
    // The end status does not decide whether to open, it decides the shape: the reason is in the body.
    assert.match(created[0]!.body, /code 1/);
  });

  it("nothing pushed: no PR, and no forge call", async () => {
    withToken();
    const s = session("s-empty");
    pushed(s, "front", 0); // the branch pushed as a precaution does not count
    // Called directly rather than through `markSessionTerminal`: the guard is in this function, and
    // awaiting it makes the test deterministic. Waiting on a non-consequence behind a timer proves
    // nothing more and fails intermittently.
    await openPrAfterSession(s);
    assert.deepEqual(created, []);
    assert.deepEqual(prUrls(), []);
  });

  it("the task pushed, not this session: the PR opens anyway (rerun after an orphan push)", async () => {
    // NrEQhvaC2W, 07/09: session 1 is killed by the sweep, its `repo_push` (changes: 1) arrives 35 s
    // after its recorded end, when nobody listens. Session 2 reruns, finds the commit already on
    // the branch, pushes zero changes, ends in success. Neither opened the PR: the "written code =
    // a PR" invariant was held per session.
    withToken();
    const first = session("s-orphan");
    markSessionTerminal(first, "failed", "container vanished without a reported result");
    pushed(first, "front", 1); // the push landing on an already terminal session
    const second = session("s-rerun");
    pushed(second, "front", 0);
    await openPrAfterSession(second);
    assert.deepEqual(
      created.map((c) => c.repo),
      ["front"],
    );
    assert.equal(prUrls().length, 1);
  });

  it("mock session: never a real PR, the adapter is not called", async () => {
    withToken();
    const s = session("s-mock", { mock: true });
    pushed(s, "front", 6);
    markSessionTerminal(s, "destroyed", "the agent process exited with code 0");
    assert.ok(await until(() => prUrls().length === 1), "no fake PR");
    assert.deepEqual(created, []);
    assert.match(prUrls()[0]!.url, /^https:\/\/github\.com\/mock\//);
  });

  it("the agent's draft wins all the way to what the forge receives", async () => {
    withToken();
    mkdirSync(ARTIFACTS, { recursive: true });
    writeFileSync(join(ARTIFACTS, "pr.md"), "# What the agent wrote\n\nIts own body.\n");
    const s = session("s-draft");
    pushed(s, "front", 6);
    markSessionTerminal(s, "destroyed", "the agent process exited with code 0");
    assert.ok(await until(() => created.length === 1), "no forge call");
    assert.equal(created[0]!.title, "What the agent wrote");
    assert.equal(created[0]!.body, "Its own body.");
    assert.equal(created[0]!.branch, formatBranch(BRANCH_TYPE.chore, "Tidy the blockers", T));
  });
});

// -------------------------------------------------------------------------------------------
describe("idempotent, and never fatal (AC#3)", () => {
  beforeEach(() => reset());

  it("two session ends on the same branch do not create two PRs", async () => {
    withToken();
    const s1 = session("s-1");
    pushed(s1, "front", 6);
    await openPrAfterSession(s1);
    // The forge finds the already open request: it carries idempotence, we did not invent a lock
    // on top.
    nextResult = { ok: true, url: "https://forge.test/pr/1", existing: true };
    const s2 = session("s-2");
    pushed(s2, "front", 3, "ffffff1");
    await openPrAfterSession(s2);
    assert.equal(created.length, 2, "the forge is asked twice");
    assert.deepEqual(prUrls(), [{ repo: "front", url: "https://forge.test/pr/1" }]);
  });

  it("forge down: the reason is in the trace, nothing else moves", async () => {
    withToken();
    nextResult = { ok: false, error: "403 — token has no right on this repository" };
    const s = session("s-down");
    pushed(s, "front", 6);
    markSessionTerminal(s, "destroyed", "the agent process exited with code 0");
    assert.ok(await until(() => warnings().length > 0), "no warning in the trace");
    assert.match(warnings()[0]!, /PR not opened.*403/);
    assert.deepEqual(prUrls(), []);
    assert.equal(
      db.select().from(schema.sessions).where(eq(schema.sessions.id, s)).get()!.status,
      "destroyed",
    );
    assert.equal(task().status, TASK_STATUS.doing);
  });

  it("no project token: the refusal is named, opening does not throw", async () => {
    const s = session("s-no-token");
    pushed(s, "front", 6);
    await openPrAfterSession(s); // must not reject
    assert.match(warnings()[0]!, /GITHUB_TOKEN missing/);
    assert.deepEqual(created, []);
  });

  it("unknown session: does not throw either", async () => {
    await openPrAfterSession("never-seen");
  });
});

// -------------------------------------------------------------------------------------------
// 14/09 (interview "PR button on channel"): `openTaskPr` now returns one of `OpenPrOutcome`'s three
// outcomes, which the route (`routes.ts`) maps to 404/422/201/502. The fallback to the agent's
// granted repositories went away with the third case.
describe("the human button goes through the same path", () => {
  beforeEach(() => reset());

  it("without pr.md, opening still succeeds: `pr.md` stays a preference", async () => {
    withToken();
    const s = session("s-button");
    pushed(s, "front", 6);
    const outcome = await openTaskPr(T);
    assert.equal(outcome.status, "opened");
    assert.equal(outcome.status === "opened" && outcome.prs.length, 1);
    // End to end: what the forge receives carries a conventional type (nav/18). The task has no
    // type, so its branch is `chore/…`, the module's honest default.
    assert.match(created[0]!.title, /^chore: /);
    assert.doesNotMatch(created[0]!.title, /legion:/);
  });

  it("unknown task: `not-found`, which the route returns as 404", async () => {
    assert.deepEqual(await openTaskPr("not-a-task"), { status: "not-found" });
  });

  it("no traced push: `no-push`, no forge call, the fallback is gone", async () => {
    withToken();
    session("s-no-push");
    const outcome = await openTaskPr(T);
    assert.deepEqual(outcome, { status: "no-push" });
    assert.deepEqual(created, []);
  });
});

// -------------------------------------------------------------------------------------------
// Level 2 (nav/18 AC#2, AC#3): the convention is read from the target repository.
//
// Acme's two repositories belong to the same project and do not put the issue identifier in the
// same place: `refactor: … (AI-2142)` in `frontend`, `feat(integrations): AI-2109 …` in `backend`.
// No hard-coded convention can be right for both, so we read it and give it as examples.
describe("examples come from the repository, one set per repository (nav/18 AC#2)", () => {
  beforeEach(() => {
    reset();
    withToken();
    mergedTitles.clear();
  });

  it("two repositories titling differently give two different example sets", async () => {
    mergedTitles.set("front", ["refactor: build the analysis cards on the DS Card (AI-2142)"]);
    mergedTitles.set("back", ["feat(integrations): AI-2109 expose a market category"]);

    const { byRepo, errors } = await mergedTitlesByRepo(P, ["front", "back"]);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      byRepo.map((r) => r.repo),
      ["back", "front"],
    );

    const prompt = titleExamplesPrompt(byRepo);
    // Each repository is named next to its titles: without the name, an agent pushing to two
    // repositories would not know which style to follow.
    assert.match(prompt, /back:\n {2}feat\(integrations\): AI-2109 expose a market category/);
    assert.match(
      prompt,
      /front:\n {2}refactor: build the analysis cards on the DS Card \(AI-2142\)/,
    );
    // And what an example teaches that no prose would say: where the identifier goes.
    assert.notEqual(
      prompt.indexOf("(AI-2142)") > prompt.indexOf("feat(integrations): AI-2109"),
      prompt.indexOf("AI-2109 expose") > prompt.indexOf("refactor: build"),
    );
  });

  it("the repository's non-conforming titles are not given as examples", () => {
    // A repository has titles older than its CI. Showing them would teach what we are correcting.
    const prompt = titleExamplesPrompt([
      {
        repo: "front",
        titles: [
          "WIP fix the thing",
          "Merge branch 'main' into x",
          "fix(i18n): the button stays enabled",
        ],
      },
    ]);
    assert.match(prompt, /fix\(i18n\): the button stays enabled/);
    assert.doesNotMatch(prompt, /WIP fix the thing/);
    assert.doesNotMatch(prompt, /Merge branch/);
  });

  it("a repository with no conforming title does not appear at all", () => {
    // Not "front:" followed by nothing, which would read as "this repository has no convention".
    assert.equal(titleExamplesPrompt([{ repo: "front", titles: ["Merge pull request #12"] }]), "");
  });
});

describe("a failed read blocks nothing, and says so (nav/18 AC#3)", () => {
  beforeEach(() => {
    reset();
    mergedTitles.clear();
  });

  it("the forge throws: no exception, the failure is named per repository", async () => {
    withToken();
    // `front` absent from the map → the read throws. `back` answers.
    mergedTitles.set("back", ["feat: something merged"]);
    const { byRepo, errors } = await mergedTitlesByRepo(P, ["front", "back"]);
    assert.deepEqual(
      byRepo.map((r) => r.repo),
      ["back"],
      "one broken repository does not hide the other",
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /^front: read refused/);
  });

  it("no project token: named error, no exception", async () => {
    const { byRepo, errors } = await mergedTitlesByRepo(P, ["front"]);
    assert.deepEqual(byRepo, []);
    assert.match(errors.join(" "), /GITHUB_TOKEN missing/);
  });

  it("repository without history: neither example nor error, a new repository is not broken", async () => {
    withToken();
    mergedTitles.set("front", []);
    const { byRepo, errors } = await mergedTitlesByRepo(P, ["front"]);
    assert.deepEqual(byRepo, []);
    assert.deepEqual(errors, []);
  });

  it("a forge that never answers: the cap hands control back, the failure is named", async () => {
    withToken();
    // The nastiest outage is silence, not refusal: a forge accepting the connection and never
    // answering would freeze the session launch, not just the examples. So the read is replaced
    // by a promise that never resolves.
    let repond: (titles: string[]) => void = () => {};
    registerForge({
      ...fakeGitHub,
      listMergedTitles: () =>
        new Promise<string[]>((r) => {
          repond = r;
        }),
    });
    try {
      const { byRepo, errors } = await mergedTitlesByRepo(P, ["front"], 20);
      assert.deepEqual(byRepo, []);
      assert.match(errors.join(" "), /reading the titles > 20 ms/);
    } finally {
      // The forge answers afterwards, as it really would, and the late answer must wake nothing.
      // Fire it here so no promise is left pending behind the test; the cap is only visible in its
      // return value.
      repond([]);
      registerForge(fakeGitHub);
    }
  });

  it("meanwhile the fallback title stays conventional: nothing depends on the read", () => {
    assert.equal(
      prDraft({
        draft: null,
        task: { name: "Tidy the blockers", description: "" },
        branch: "feature/x-1",
        pushed: [],
      }).title,
      "feat: Tidy the blockers",
    );
  });
});

// The session commit subject (nav/18 AC#4). The runner composed `legion: ${taskName.slice(0, 72)}`:
// a type that exists nowhere, cut at the character. On a squash repository the PR title overwrites
// it; on one allowing merge commits it lands as is on the default branch.
describe("the commit subject is conventional and cut at a separator (nav/18 AC#4)", () => {
  it("no more `legion:`: the same type as the PR title, from the same function", () => {
    assert.equal(
      conventionalTitle("feature/x-1", "Extract the wrapper"),
      "feat: Extract the wrapper",
    );
    assert.doesNotMatch(conventionalTitle("legion/x", "Extract the wrapper"), /legion:/);
  });

  it("the cut lands on a separator, never mid-word", () => {
    const name = "Extract the historical analysis card wrapper into the shared design system";
    const title = conventionalTitle("chore/x-1", name);
    assert.ok(title.length <= 72, `${title.length} : ${title}`);
    assert.ok(title.endsWith("…"), title);
    // The word before the ellipsis is a whole word of the original name.
    const lastWord = title.slice(0, -1).trim().split(" ").at(-1)!;
    assert.ok(
      name.split(" ").includes(lastWord),
      `"${lastWord}" is not a word of the original name`,
    );
  });

  it("a single word longer than the limit is still cut: an empty title would be worse", () => {
    const title = conventionalTitle("chore/x-1", "x".repeat(200));
    assert.ok(title.length <= 72 && title.length > 60, title.length.toString());
    assert.ok(title.startsWith("chore: x"));
  });
});

describe("assigning the PR to the token owner (request of 02/09)", () => {
  beforeEach(() => reset());

  it("created → assigned to the token's login", async () => {
    withToken();
    const s = session("s-created");
    pushed(s, "front", 6);
    await openPrAfterSession(s);
    assert.equal(assigned.length, 1, "no assignment");
    assert.equal(assigned[0]!.repo, "front");
    assert.equal(assigned[0]!.number, 1); // taken from the URL https://forge.test/pr/1
    assert.equal(assigned[0]!.login, "test-operator");
  });

  it("found (existing: true) → assigned too", async () => {
    withToken();
    nextResult = { ok: true, url: "https://forge.test/pr/1", existing: true };
    const s = session("s-existing");
    pushed(s, "front", 6);
    await openPrAfterSession(s);
    assert.equal(assigned.length, 1, "no assignment on a found PR");
    assert.equal(assigned[0]!.number, 1);
  });

  it("assignment failure → warning, creation stays a success", async () => {
    withToken();
    registerForge({
      ...fakeGitHub,
      assignChangeRequest: async () => false,
    });
    try {
      const s = session("s-assign-fail");
      pushed(s, "front", 6);
      markSessionTerminal(s, "destroyed", "the agent process exited with code 0");
      await until(() => prUrls().length === 1, 5_000);
      // The PR was created even though assignment failed
      assert.equal(prUrls().length, 1, "the PR was not created");
      assert.equal(prUrls()[0]!.repo, "front");
    } finally {
      registerForge(fakeGitHub);
    }
  });

  it("login cache: two PRs, a single GET /user", async () => {
    withToken();
    let getLoginCalls = 0;
    registerForge({
      ...fakeGitHub,
      getTokenOwnerLogin: async () => {
        getLoginCalls++;
        return "test-operator";
      },
    });
    try {
      const s1 = session("s-1");
      pushed(s1, "front", 6);
      await openPrAfterSession(s1);
      assert.equal(getLoginCalls, 1, "first call to getTokenOwnerLogin");

      const s2 = session("s-2");
      pushed(s2, "front", 3);
      nextResult = { ok: true, url: "https://forge.test/pr/2", existing: false };
      await openPrAfterSession(s2);
      assert.equal(getLoginCalls, 1, "second call: the login is cached");
    } finally {
      registerForge(fakeGitHub);
    }
  });
});
