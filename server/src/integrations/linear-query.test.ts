// The filter's journey from the HTTP query to the GraphQL request body.
//
// It replays what was measured live on 01/09 against the real workspace: more than 250 open issues,
// Legion fetches 50 (`first: 50`, `orderBy: updatedAt`), and AI-1942 is the 217th. While the three
// filters were applied by the UI to that truncated batch, no combination could show it: it never left
// the server.
//
// The fake Linear below is not a mock that says yes. It reads the body's `filter`, interprets it with
// the API's documented semantics (`in`, `eq`, two fields of one WorkflowStateFilter are an AND),
// applies it to 260 issues, then truncates to 50 like the real one. A filter that did not travel would
// return the same 50 issues and fail the test: the only setup proving the filter travels rather than
// being applied afterwards.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-linear-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
// The demo fallback must stay off here: it would short-circuit the network being observed.
delete process.env.LEGION_LINEAR_FAKE;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { encryptSecret } = await import("../shared/crypto.js");
const { listIssues, listOptions } = await import("./linear.js");
const { AUTH_FORMAT } = await import("../connections/providers.js");

const PROJECT = "p-linear";
db.insert(schema.projects)
  .values({
    id: PROJECT,
    name: "Linear",
    slug: "linear-test",
    defaultModel: "sonnet",
    createdAt: new Date(),
  })
  .run();
db.insert(schema.secrets)
  .values({
    id: "s-linear",
    projectId: PROJECT,
    // An OAuth connection token, the only name `linear.ts` reads since 15/09. A personal key stored as
    // `LINEAR_API_KEY` is no longer read at all: not a fallback, a break.
    name: "LINEAR_TOKEN",
    ciphertext: encryptSecret("lin_oauth_test"),
    createdAt: new Date(),
  })
  .run();

// A second project whose token is a pasted personal key. It differs from the first only by what
// `metadata` kept from the probe, which is all the header format depends on.
const PASTED_PROJECT = "p-linear-colle";
db.insert(schema.projects)
  .values({
    id: PASTED_PROJECT,
    name: "Linear pasted",
    slug: "linear-colle",
    defaultModel: "sonnet",
    createdAt: new Date(),
  })
  .run();
db.insert(schema.secrets)
  .values({
    id: "s-linear-colle",
    projectId: PASTED_PROJECT,
    name: "LINEAR_TOKEN",
    ciphertext: encryptSecret("lin_api_colle"),
    metadata: JSON.stringify({ authFormat: AUTH_FORMAT.raw }),
    createdAt: new Date(),
  })
  .run();

// ── the simulated workspace ──
// 260 open issues, most recently updated first (the `orderBy: updatedAt` order). AI-1942 is at index
// 216, so the 217th: outside the fifty, as in the real workspace.
const TEAMS = [
  { id: "team-1", name: "Core" },
  { id: "team-2", name: "Growth" },
];
const STATES = [
  { name: "Backlog", type: "backlog" },
  { name: "Todo", type: "unstarted" },
  { name: "In Progress", type: "started" },
];
type Node = Record<string, unknown>;

const CORPUS: Node[] = Array.from({ length: 260 }, (_, i) => ({
  id: `i-${i}`,
  identifier: `AI-${1000 + i}`,
  title: `Issue ${i}`,
  description: "",
  url: `https://linear.app/i/${i}`,
  state: STATES[i % 3],
  project: null,
  assignee: { id: `usr-${i % 8}`, name: `Person ${i % 8}` },
  team: TEAMS[i % 2],
}));
const WANTED = 216; // rank 217
CORPUS[WANTED] = {
  ...CORPUS[WANTED],
  identifier: "AI-1942",
  title: "The weekly report is generated twice",
  assignee: { id: "usr-me", name: "Operator" },
  team: TEAMS[0],
  state: STATES[1],
};
// A done issue, the most recent: it must never come out, filter or not. That is the `state.type.in`
// constraint adding the label must not drop.
const CLOSED: Node = {
  ...CORPUS[0],
  id: "i-closed",
  identifier: "AI-9999",
  state: { name: "Done", type: "completed" },
  assignee: { id: "usr-me", name: "Operator" },
  team: TEAMS[0],
};
const WORKSPACE = [CLOSED, ...CORPUS];

const USERS = [
  { id: "usr-me", name: "Operator", active: true },
  { id: "usr-0", name: "Person 0", active: true },
  { id: "usr-absent", name: "No Issue", active: true },
  { id: "usr-off", name: "Gone", active: false },
];

/** Linear's documented semantics, applied to the corpus. */
function keeps(node: Node, filter: Node): boolean {
  const state = (filter.state ?? {}) as Node;
  const type = (state.type as { in?: string[] })?.in;
  const name = (state.name as { eq?: string })?.eq;
  const assignee = (filter.assignee as { id?: { eq?: string } })?.id?.eq;
  const team = (filter.team as { id?: { eq?: string } })?.id?.eq;
  const s = node.state as { name: string; type: string };
  if (type && !type.includes(s.type)) return false;
  if (name && s.name !== name) return false;
  if (assignee && (node.assignee as { id: string } | null)?.id !== assignee) return false;
  if (team && (node.team as { id: string } | null)?.id !== team) return false;
  return true;
}

let sent: { query: string; variables?: Node }[] = [];
/** The `authorization` header of each call. No request body reveals it: it is a transport fact, and
 *  exactly where Linear tells an OAuth token (`Bearer`) from a personal key (raw). Without this capture
 *  nothing in the repository looks at the one string all authentication depends on. */
let sentAuth: string[] = [];
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

// oxlint-disable-next-line no-explicit-any -- fetch signature, replaced for the test
globalThis.fetch = (async (
  _url: unknown,
  init: { body?: string; headers?: Record<string, string> },
) => {
  const body = JSON.parse(init.body ?? "{}") as { query: string; variables?: Node };
  sent = [...sent, body];
  sentAuth = [...sentAuth, init.headers?.authorization ?? ""];
  const data = body.query.includes("users(")
    ? {
        users: { nodes: USERS },
        teams: { nodes: TEAMS },
        workflowStates: { nodes: [...STATES, { name: "Done", type: "completed" }] },
      }
    : {
        issues: {
          nodes: WORKSPACE.filter((n) => keeps(n, (body.variables?.filter ?? {}) as Node)).slice(
            0,
            50,
          ),
        },
      };
  return { ok: true, json: () => Promise.resolve({ data }) };
  // eslint-disable-next-line -- deliberately partial replacement: `gql` only uses ok/json
}) as unknown as typeof globalThis.fetch;

beforeEach(() => {
  sent = [];
  sentAuth = [];
});

// The header format alone decides whether anything works. Linear accepts `Bearer <token>` for an OAuth
// token and the raw value for a personal key, and refuses the swap: the wrong format breaks every call
// with an authentication message pointing at no line. Request bodies are covered by the rest of this
// file; the header was covered by nothing.
describe("the authentication header", () => {
  it("presents the connection token as Bearer", async () => {
    await listIssues(PROJECT);
    assert.deepEqual(
      sentAuth,
      ["Bearer lin_oauth_test"],
      "an OAuth token sent raw would be refused by Linear on every call",
    );
  });

  // The other half, the whole 15/09 bug. The adoption probe tries raw first, so a pasted personal key
  // passed, then this file hard-coded `Bearer` and every request was refused while the UI said
  // "connected". The format is now observed at paste time and read here; this test fails if it becomes
  // a call-site constant again.
  it("presents raw the personal key the probe observed raw", async () => {
    await listIssues(PASTED_PROJECT);
    assert.deepEqual(
      sentAuth,
      ["lin_api_colle"],
      "a personal key sent as Bearer is a credential connected on screen and dead in use",
    );
  });
});

describe("listIssues: the filter goes to Linear", () => {
  it("without a filter: the 50 most recent, and AI-1942 (217th) stays unfindable", async () => {
    const issues = await listIssues(PROJECT);
    assert.equal(issues.length, 50);
    assert.ok(
      !issues.some((i) => i.identifier === "AI-1942"),
      "AI-1942 in the first 50: the corpus no longer reproduces the 01/09 measurement",
    );
  });

  it("filtered by person: AI-1942 comes out, outside the fifty most recent updates", async () => {
    const issues = await listIssues(PROJECT, { assigneeId: "usr-me" });
    assert.ok(
      issues.some((i) => i.identifier === "AI-1942"),
      "the assigned issue stays invisible: the filter is still applied afterwards",
    );
    assert.ok(issues.every((i) => i.assignee?.id === "usr-me"));
  });

  it("the filter travels inside the request, as a variable", async () => {
    await listIssues(PROJECT, { assigneeId: "usr-me", teamId: "team-1", state: "Todo" });
    const [req] = sent;
    assert.ok(
      req?.query.includes("$filter: IssueFilter!"),
      "the request declares no filter variable",
    );
    assert.deepEqual(req?.variables?.filter, {
      state: { type: { in: ["triage", "backlog", "unstarted", "started"] }, name: { eq: "Todo" } },
      assignee: { id: { eq: "usr-me" } },
      team: { id: { eq: "team-1" } },
    });
  });

  it("filtered by team: everything comes from the requested team", async () => {
    const issues = await listIssues(PROJECT, { teamId: "team-2" });
    assert.ok(issues.length > 0);
    assert.ok(issues.every((i) => i.team?.id === "team-2"));
  });

  it("filtered by state: the requested label, nothing else", async () => {
    const issues = await listIssues(PROJECT, { state: "In Progress" });
    assert.ok(issues.length > 0);
    assert.ok(issues.every((i) => i.state === "In Progress"));
  });

  it("a done issue never comes out, even when the filter designates it", async () => {
    const issues = await listIssues(PROJECT, { assigneeId: "usr-me", teamId: "team-1" });
    assert.ok(
      !issues.some((i) => i.identifier === "AI-9999"),
      "adding the state label dropped the not-done constraint",
    );
  });
});

describe("listOptions: the workspace members", () => {
  it("a member with no issue is listed, a deactivated account is not", async () => {
    const opts = await listOptions(PROJECT);
    assert.ok(opts.members.some((m) => m.id === "usr-absent"));
    assert.ok(!opts.members.some((m) => m.id === "usr-off"));
  });

  it("the request asks for `active`, without which a closed account could not be excluded", async () => {
    await listOptions(PROJECT);
    assert.match(sent[0]?.query ?? "", /users\(first: \d+\) \{ nodes \{ id name active \} \}/);
  });

  it("the workspace's terminal states are not offered", async () => {
    const opts = await listOptions(PROJECT);
    assert.ok(!opts.states.includes("Done"));
  });
});
