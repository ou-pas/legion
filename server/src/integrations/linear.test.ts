// Linear issue filters (v24). Protects `mapIssue` (above all null or missing assignee/team: a blind
// `String(undefined)` would give `{id:"undefined"}` rather than `null`) and the shape of the
// `FAKE_ISSUES` demo set, which must stay rich enough for combined filters (see
// /artifacts/CTnl9zZmW4/plan-filtres-issues-linear.md, phase A3).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAKE_ISSUES, FAKE_OPTIONS, issueFilter, mapIssue, mapOptions } from "./linear.js";

describe("mapIssue", () => {
  it("maps a complete node, assignee and team filled (id and name)", () => {
    const issue = mapIssue({
      id: "i1",
      identifier: "ONE-1",
      title: "T",
      description: "D",
      url: "https://x",
      state: { name: "Backlog", type: "backlog" },
      project: { name: "acme-app" },
      assignee: { id: "usr-1", name: "Alice Martin" },
      team: { id: "team-1", name: "Atelier Core" },
    });
    assert.deepEqual(issue.assignee, { id: "usr-1", name: "Alice Martin" });
    assert.deepEqual(issue.team, { id: "team-1", name: "Atelier Core" });
  });

  it("assignee: null (unassigned issue) → null, not {id:'undefined'}", () => {
    const issue = mapIssue({
      id: "i2",
      identifier: "ONE-2",
      title: "T",
      description: "",
      url: "",
      state: { name: "Todo", type: "unstarted" },
      project: null,
      assignee: null,
      team: { id: "team-1", name: "Atelier Core" },
    });
    assert.equal(issue.assignee, null);
  });

  it("assignee missing from the object (key not provided) → null", () => {
    const issue = mapIssue({
      id: "i3",
      identifier: "ONE-3",
      title: "T",
      description: "",
      url: "",
      state: { name: "Todo", type: "unstarted" },
      team: { id: "team-1", name: "Atelier Core" },
    });
    assert.equal(issue.assignee, null);
  });

  it("team missing → null (defensive: an issue always has a team in practice)", () => {
    const issue = mapIssue({
      id: "i4",
      identifier: "ONE-4",
      title: "T",
      description: "",
      url: "",
      state: { name: "Todo", type: "unstarted" },
      assignee: { id: "usr-1", name: "Alice Martin" },
    });
    assert.equal(issue.team, null);
  });

  it("a non-string id in assignee/team stays defensive (String(...) on the id, never throws)", () => {
    const issue = mapIssue({
      id: "i5",
      identifier: "ONE-5",
      title: "T",
      description: "",
      url: "",
      state: { name: "Todo", type: "unstarted" },
      assignee: { id: 42, name: "Numeric" },
    });
    assert.deepEqual(issue.assignee, { id: "42", name: "Numeric" });
  });

  it("non-regression: state/stateType/project unchanged, missing project → null", () => {
    const issue = mapIssue({
      id: "i6",
      identifier: "ONE-6",
      title: "T",
      description: "D",
      url: "https://x",
      state: { name: "In progress", type: "started" },
    });
    assert.equal(issue.state, "In progress");
    assert.equal(issue.stateType, "started");
    assert.equal(issue.project, null);
    assert.equal(issue.assignee, null);
    assert.equal(issue.team, null);
  });
});

describe("FAKE_ISSUES: demo set usable for combined filters", () => {
  it("at least 6 issues", () => {
    assert.ok(FAKE_ISSUES.length >= 6, `${FAKE_ISSUES.length} issues, attendu >= 6`);
  });

  it("at least 3 distinct assignees", () => {
    const ids = new Set(FAKE_ISSUES.map((i) => i.assignee?.id).filter((id): id is string => !!id));
    assert.ok(ids.size >= 3, `${ids.size} distinct assignees, expected >= 3`);
  });

  it("at least one unassigned issue (assignee: null)", () => {
    assert.ok(FAKE_ISSUES.some((i) => i.assignee === null));
  });

  it("at least 2 distinct teams", () => {
    const ids = new Set(FAKE_ISSUES.map((i) => i.team?.id).filter((id): id is string => !!id));
    assert.ok(ids.size >= 2, `${ids.size} distinct teams, expected >= 2`);
  });
});

// AC#1 of slice 16: the people list comes from workspace members, not assignees of loaded issues.
// Measured on 01/09 against the real workspace: 26 members, 10 assignees visible in the 50 fetched
// issues; the operator was not in their own menu.
describe("mapOptions: menus come from the workspace", () => {
  const WORKSPACE = {
    users: {
      nodes: [
        { id: "u-b", name: "Bruno Petit", active: true },
        { id: "u-a", name: "Alice Martin", active: true },
        { id: "u-none", name: "No Issue", active: true },
        { id: "u-off", name: "Left In 2024", active: false },
      ],
    },
    teams: {
      nodes: [
        { id: "t-2", name: "Growth" },
        { id: "t-1", name: "Core" },
      ],
    },
    workflowStates: {
      nodes: [
        { name: "Todo", type: "unstarted" },
        { name: "Todo", type: "unstarted" }, // Linear creates one per team: same label, another state
        { name: "Backlog", type: "backlog" },
        { name: "Done", type: "completed" },
        { name: "Canceled", type: "canceled" },
      ],
    },
  };
  const opts = mapOptions(WORKSPACE);

  it("a member without open issues is listed", () => {
    assert.ok(
      opts.members.some((m) => m.id === "u-none"),
      "the member without issues is missing: the list is still derived from issues",
    );
  });

  it("a deactivated account is not listed", () => {
    assert.ok(!opts.members.some((m) => m.id === "u-off"));
    assert.equal(opts.members.length, 3);
  });

  it("members are sorted by name (fr locale)", () => {
    assert.deepEqual(
      opts.members.map((m) => m.name),
      ["Alice Martin", "Bruno Petit", "No Issue"],
    );
  });

  it("teams come from the workspace, sorted", () => {
    assert.deepEqual(opts.teams, [
      { id: "t-1", name: "Core" },
      { id: "t-2", name: "Growth" },
    ]);
  });

  it("state labels are deduplicated by name, and terminal states excluded", () => {
    assert.deepEqual(opts.states, ["Backlog", "Todo"]);
  });

  it("missing or empty nodes → three empty lists, never an exception", () => {
    assert.deepEqual(mapOptions({}), { members: [], teams: [], states: [] });
  });

  it("the keyless fallback has the same guarantees (FAKE_OPTIONS goes through mapOptions)", () => {
    const assigned = new Set(FAKE_ISSUES.map((i) => i.assignee?.id).filter(Boolean));
    const orphan = FAKE_OPTIONS.members.filter((m) => !assigned.has(m.id));
    assert.ok(orphan.length >= 1, "the demo set shows no member without open issues");
    assert.ok(!FAKE_OPTIONS.members.some((m) => m.name === "Former Colleague"));
    assert.ok(!FAKE_OPTIONS.states.includes("Done"));
  });
});

// AC#2: the filter goes to Linear. Its shape here; the full journey is in linear-query.test.ts.
describe("issueFilter: the three dimensions in one object", () => {
  const OPEN = ["triage", "backlog", "unstarted", "started"];

  it("without a filter: the only constraint is not done", () => {
    assert.deepEqual(issueFilter({}), { state: { type: { in: OPEN } } });
  });

  it("a person becomes assignee.id.eq", () => {
    assert.deepEqual(issueFilter({ assigneeId: "u-1" }).assignee, { id: { eq: "u-1" } });
  });

  it("a team becomes team.id.eq", () => {
    assert.deepEqual(issueFilter({ teamId: "t-1" }).team, { id: { eq: "t-1" } });
  });

  it("a state adds name.eq without losing the type constraint (the AND of WorkflowStateFilter)", () => {
    assert.deepEqual(issueFilter({ state: "In progress / blocked" }).state, {
      type: { in: OPEN },
      name: { eq: "In progress / blocked" },
    });
  });

  it("all three coexist", () => {
    const f = issueFilter({ assigneeId: "u-1", teamId: "t-1", state: "Todo" });
    assert.deepEqual(f, {
      state: { type: { in: OPEN }, name: { eq: "Todo" } },
      assignee: { id: { eq: "u-1" } },
      team: { id: { eq: "t-1" } },
    });
  });

  it("an empty dimension sets no constraint (empty string is not “nobody”)", () => {
    assert.deepEqual(issueFilter({ assigneeId: "", teamId: "", state: "" }), {
      state: { type: { in: OPEN } },
    });
  });
});
