// Linear: issues to Legion tasks (operator's request, 18/08). A deliberately light sync: read issues,
// link a task, and move the issue to "In Progress" when the task starts. Closing happens through
// "Closes ABC-123" in the PR body (native GitHub↔Linear integration).
//
// The token is `LINEAR_TOKEN`, and its header format is read, not assumed. Linear takes
// `Authorization: Bearer <token>` for an OAuth token and the raw form for a personal key; the wrong
// one fails every GraphQL request. This file used to hard-code `Bearer` (fixed 15/09): the adoption
// probe tries raw first, so a pasted personal key was accepted, shown connected, and refused at every
// use here. The format is now observed at paste time, stored in `metadata.authFormat`, and read back
// by `freshAuthorization`.
//
// `LINEAR_API_KEY` is no longer read, and its row is not renamed: the value is a personal key that
// would be sent as `Bearer` and refused, a broken secret that looks valid. It stays unread and the
// operator reconnects Linear in one click from Integrations. No fallback to the old name: Legion has
// a single operator, and a path kept for a population that does not exist is speculative generality.
import { freshAuthorization } from "../connections/secret-access.js";

const API = "https://api.linear.app/graphql";

export type LinearIssue = {
  id: string;
  identifier: string; // e.g. ONE-42, the one put in "Closes"
  title: string;
  description: string;
  url: string;
  state: string;
  stateType: string;
  project: string | null;
  // Issue filters (v24), nullable: `assignee` is `null` when nobody is assigned (normal); `team` is
  // `null` only if Linear omits it (defensive, always present in practice). Non-null means `id` and
  // `name` are set.
  assignee: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
};

/** A person or a team: the same pair on both sides of the filter. */
export type LinearRef = { id: string; name: string };

/** What the filter menus are made of, told by the workspace, not by loaded issues. Measured on 01/09
 *  against the real workspace: 26 members, only 10 of whom appeared in the 50 most recently updated
 *  issues, so the UI offered a shadow of its own batch and the operator was not in it.
 *
 *  Teams and states are fetched with people for a functional reason: since the filter goes to Linear,
 *  the returned issues are the filter's result. Deriving the menus from it would shrink them at each
 *  choice (team A chosen, team B gone, no way back). */
export type LinearOptions = {
  members: LinearRef[];
  teams: LinearRef[];
  /** The state label (D3: "Backlog", "Todo"), free text per team. */
  states: string[];
};

/** The three filter dimensions as they travel to Linear. A missing dimension means no constraint. */
export type IssueQuery = { assigneeId?: string; teamId?: string; state?: string };

/** What "open" means: anything but done or canceled. Used twice: in the issue filter, and to pick
 *  offerable state labels (a menu offering "Done" would promise an empty list, since done issues are
 *  never loaded). */
const OPEN_STATE_TYPES = ["triage", "backlog", "unstarted", "started"] as const;

/** What the UI recognises when Linear is not connected, a coupling by string that neither `tsc` nor
 *  the linter reads. `IssuesPage.tsx` tests `message.includes("LINEAR_TOKEN")` to replace its generic
 *  error with the "not connected yet" state and its button to Integrations. One constant rather than
 *  two identical literals, so both `throw`s cannot drift.
 *
 *  The action changed (15/09): the message used to say to paste a personal key into Secrets; it now
 *  says to connect, one click. */
export const NO_LINEAR_TOKEN =
  "Linear is not connected on this project: the LINEAR_TOKEN secret is missing. Connect Linear from Integrations.";

/** The ready-made `Authorization` header, not the bare token. Linear reads a personal key raw and an
 *  OAuth token as `Bearer`, so the format is observed at adoption and read back here
 *  (`freshAuthorization`, `AUTH_FORMAT`). */
function linearAuth(projectId: string): string | null {
  return freshAuthorization(projectId, "LINEAR_TOKEN");
}

async function gql(
  authorization: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(API, {
    method: "POST",
    // The header arrives ready-made; no caller composes it, since the format belongs to the kind of
    // token, not the call site. The hard-coded `Bearer ${token}` that was here (fixed 15/09) was true
    // of an OAuth token and false of a personal key.
    //
    // For calls Legion makes, `authorizationHeader` is now the only judge. Not for what goes out
    // through `${SECRET:…}` to a container or MCP server, which only sees a secret name and composes
    // its prefix by hand (detailed on `authorizationHeader`).
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: Record<string, unknown>;
    errors?: { message: string }[];
  };
  if (!res.ok || json.errors?.length)
    throw new Error(json.errors?.[0]?.message ?? `Linear API ${res.status}`);
  return json.data ?? {};
}

// Demo set (LEGION_LINEAR_FAKE=1): 7 issues to check combined filters (assignee × status × team)
// without a real Linear key: 3 distinct assignees plus 1 unassigned issue (ONE-103, which breaks a
// naive filter on `assignee.id`), 2 teams, 4 state types, and a unique assignee×team pair (usr-1 ×
// team-1 gives only ONE-101) showing a 3-dimension filter narrows to one result. ONE-107 has an empty
// description, to check the expand chevron does not appear (D5).
export const FAKE_ISSUES: LinearIssue[] = [
  {
    id: "fake-1",
    identifier: "ONE-101",
    title: "Add PDF export for client reports",
    description: "Clients want to download their monthly reports as PDF.",
    url: "https://linear.app/fake/issue/ONE-101",
    state: "Backlog",
    stateType: "backlog",
    project: "acme-app",
    assignee: { id: "usr-1", name: "Alice Martin" },
    team: { id: "team-1", name: "Atelier Core" },
  },
  {
    id: "fake-2",
    identifier: "ONE-102",
    title: "Fix the sort order of the ticket list",
    description: "Sorting by date ignores the time zone.",
    url: "https://linear.app/fake/issue/ONE-102",
    state: "Todo",
    stateType: "unstarted",
    project: "acme-app",
    assignee: { id: "usr-2", name: "Bruno Petit" },
    team: { id: "team-1", name: "Atelier Core" },
  },
  {
    id: "fake-3",
    identifier: "ONE-103",
    title: "Use one date format in the CSV export",
    description: "Some exports mix ISO and DD/MM/YYYY.",
    url: "https://linear.app/fake/issue/ONE-103",
    state: "In Progress",
    stateType: "started",
    project: "acme-app",
    assignee: null,
    team: { id: "team-2", name: "Atelier Growth" },
  },
  {
    id: "fake-4",
    identifier: "ONE-104",
    title: "Sort support feedback by priority",
    description: "Urgent tickets get lost in the pile.",
    url: "https://linear.app/fake/issue/ONE-104",
    state: "Triage",
    stateType: "triage",
    project: null,
    assignee: { id: "usr-3", name: "Chloé Dubois" },
    team: { id: "team-2", name: "Atelier Growth" },
  },
  {
    id: "fake-5",
    identifier: "ONE-105",
    title: "Add a date filter to the dashboard",
    description: "Operators want to narrow the period shown.",
    url: "https://linear.app/fake/issue/ONE-105",
    state: "Backlog",
    stateType: "backlog",
    project: "acme-app",
    assignee: { id: "usr-1", name: "Alice Martin" },
    team: { id: "team-2", name: "Atelier Growth" },
  },
  {
    id: "fake-6",
    identifier: "ONE-106",
    title: "Review load times of the Issues page",
    description: "First render takes over 2 seconds on a large workspace.",
    url: "https://linear.app/fake/issue/ONE-106",
    state: "In Progress",
    stateType: "started",
    project: "acme-app",
    assignee: { id: "usr-2", name: "Bruno Petit" },
    team: { id: "team-1", name: "Atelier Core" },
  },
  {
    id: "fake-7",
    identifier: "ONE-107",
    title: "Check the chevron of an issue without a description",
    description: "",
    url: "https://linear.app/fake/issue/ONE-107",
    state: "Backlog",
    stateType: "backlog",
    project: "acme-app",
    assignee: { id: "usr-3", name: "Chloé Dubois" },
    team: { id: "team-1", name: "Atelier Core" },
  },
];

// The demo workspace as raw nodes rather than ready options: `FAKE_OPTIONS` goes through the real
// `mapOptions`, so the keyless fallback shows exactly what mapping produces. Damien Roy has no open
// issue and is still listed (the point of the change); the former colleague is deactivated and is not;
// "Done" is a workspace state no open issue carries, so it is not offered.
const FAKE_WORKSPACE = {
  users: {
    nodes: [
      { id: "usr-1", name: "Alice Martin", active: true },
      { id: "usr-2", name: "Bruno Petit", active: true },
      { id: "usr-3", name: "Chloé Dubois", active: true },
      { id: "usr-4", name: "Damien Roy", active: true },
      { id: "usr-9", name: "Former Colleague", active: false },
    ],
  },
  teams: {
    nodes: [
      { id: "team-1", name: "Atelier Core" },
      { id: "team-2", name: "Atelier Growth" },
      { id: "team-3", name: "Atelier Data" },
    ],
  },
  workflowStates: {
    nodes: [
      { name: "Triage", type: "triage" },
      { name: "Backlog", type: "backlog" },
      { name: "Todo", type: "unstarted" },
      { name: "In Progress", type: "started" },
      { name: "Done", type: "completed" },
      { name: "Canceled", type: "canceled" },
    ],
  },
};

function mapRef(n: unknown): { id: string; name: string } | null {
  if (!n || typeof n !== "object") return null;
  const r = n as Record<string, unknown>;
  if (r.id === undefined || r.id === null) return null;
  return { id: String(r.id), name: String(r.name ?? "") };
}

/** A Linear GraphQL node to our model. Pure, so mapping is testable without network or database.
 *  Defensive: a missing object gives `null`, never a half-filled object (`String(undefined)` would give
 *  `"undefined"`). */
export function mapIssue(n: Record<string, unknown>): LinearIssue {
  return {
    id: String(n.id),
    identifier: String(n.identifier),
    title: String(n.title ?? ""),
    description: String(n.description ?? ""),
    url: String(n.url ?? ""),
    state: String((n.state as Record<string, unknown>)?.name ?? ""),
    stateType: String((n.state as Record<string, unknown>)?.type ?? ""),
    project: (n.project as Record<string, unknown>)?.name
      ? String((n.project as Record<string, unknown>).name)
      : null,
    assignee: mapRef(n.assignee),
    team: mapRef(n.team),
  };
}

/** The filter sent to Linear, pure so checkable without network.
 *
 *  The defect it closes: until 01/09 the three dimensions were applied by the UI to fifty issues
 *  already truncated by `first: 50`. Picking oneself among twenty-six people gave an empty screen half
 *  the time, and AI-1942 (rank 217 of more than 250 open issues) could not be found with any filter.
 *
 *  The constraints meet in one object, and `state` carries two: `type` says "not done", `name` the
 *  chosen label (D3). Two fields of one `WorkflowStateFilter` are an AND at Linear. */
export function issueFilter(q: IssueQuery): Record<string, unknown> {
  return {
    state: { type: { in: [...OPEN_STATE_TYPES] }, ...(q.state ? { name: { eq: q.state } } : {}) },
    ...(q.assigneeId ? { assignee: { id: { eq: q.assigneeId } } } : {}),
    ...(q.teamId ? { team: { id: { eq: q.teamId } } } : {}),
  };
}

/** The same filter applied to the demo set: without it the `LEGION_LINEAR_FAKE` menus would be the
 *  only ones in the app doing nothing. */
function matchesQuery(i: LinearIssue, q: IssueQuery): boolean {
  return (
    (!q.assigneeId || i.assignee?.id === q.assigneeId) &&
    (!q.teamId || i.team?.id === q.teamId) &&
    (!q.state || i.state === q.state)
  );
}

/** Open issues (backlog, todo, in progress), most recently updated first, narrowed by Linear itself to
 *  what the filter asks. */
export async function listIssues(projectId: string, q: IssueQuery = {}): Promise<LinearIssue[]> {
  if (process.env.LEGION_LINEAR_FAKE === "1") return FAKE_ISSUES.filter((i) => matchesQuery(i, q));
  const auth = linearAuth(projectId);
  if (!auth) throw new Error(NO_LINEAR_TOKEN);
  // The filter goes as a variable, not interpolated: a state label is free text typed by a human, and
  // pasting it into GraphQL would be an injection point as well as a syntax error source.
  const data = await gql(
    auth,
    `
    query($filter: IssueFilter!) {
      issues(first: 50, orderBy: updatedAt, filter: $filter) {
        nodes {
          id identifier title description url
          state { name type }
          project { name }
          assignee { id name }
          team { id name }
        }
      }
    }`,
    { filter: issueFilter(q) },
  );
  const nodes = ((data.issues as Record<string, unknown>)?.nodes ?? []) as Record<
    string,
    unknown
  >[];
  return nodes.map(mapIssue);
}

const byName = (a: LinearRef, b: LinearRef) => a.name.localeCompare(b.name, "en");

function nodesOf(data: Record<string, unknown>, key: string): Record<string, unknown>[] {
  return ((data[key] as Record<string, unknown>)?.nodes ?? []) as Record<string, unknown>[];
}

/** The workspace to the three menus. Pure like `mapIssue`, defensive the same way.
 *
 *  Three decisions, each on a case seen live on 01/09:
 *  - `active === false` is dropped: a deactivated account keeps past issues, and offering it promises a
 *    filter that never returns anything open;
 *  - a terminal state type ("Done", "Canceled") is not offered, for the same reason;
 *  - state labels are deduplicated by name: Linear creates one per team, so a three-team workspace has
 *    three "Todo" with different ids and the same meaning. */
export function mapOptions(data: Record<string, unknown>): LinearOptions {
  const refs = (
    key: string,
    keep: (n: Record<string, unknown>) => boolean = () => true,
  ): LinearRef[] =>
    nodesOf(data, key)
      .filter((n) => n.id !== undefined && n.id !== null && keep(n))
      .map((n) => ({ id: String(n.id), name: String(n.name ?? "") }))
      .sort(byName);
  const states = nodesOf(data, "workflowStates")
    .filter((n) => (OPEN_STATE_TYPES as readonly string[]).includes(String(n.type ?? "")))
    .map((n) => String(n.name ?? ""))
    .filter((name) => name.length > 0);
  return {
    members: refs("users", (n) => n.active !== false),
    teams: refs("teams"),
    states: [...new Set(states)].sort((a, b) => a.localeCompare(b, "en")),
  };
}

export const FAKE_OPTIONS: LinearOptions = mapOptions(FAKE_WORKSPACE);

/** The workspace's members, teams and state labels, in one round trip. */
export async function listOptions(projectId: string): Promise<LinearOptions> {
  if (process.env.LEGION_LINEAR_FAKE === "1") return FAKE_OPTIONS;
  const auth = linearAuth(projectId);
  if (!auth) throw new Error(NO_LINEAR_TOKEN);
  const data = await gql(
    auth,
    `
    query {
      users(first: 250) { nodes { id name active } }
      teams(first: 100) { nodes { id name } }
      workflowStates(first: 250) { nodes { name type } }
    }`,
  );
  return mapOptions(data);
}

/** Moves an issue to "In Progress" (its team's first started state). Fire-and-forget for the caller. */
export async function moveIssueInProgress(projectId: string, issueId: string): Promise<void> {
  if (process.env.LEGION_LINEAR_FAKE === "1") return;
  const auth = linearAuth(projectId);
  if (!auth) return;
  const data = await gql(
    auth,
    `
    query($id: String!) {
      issue(id: $id) {
        state { type }
        team { states(filter: { type: { eq: "started" } }) { nodes { id position } } }
      }
    }`,
    { id: issueId },
  );
  const issue = data.issue as Record<string, unknown> | undefined;
  if (!issue) return;
  if (((issue.state as Record<string, unknown>)?.type as string) === "started") return; // already in progress
  const states = (((issue.team as Record<string, unknown>)?.states as Record<string, unknown>)
    ?.nodes ?? []) as { id: string; position: number }[];
  const target = [...states].sort((a, b) => a.position - b.position)[0];
  if (!target) return;
  await gql(
    auth,
    `
    mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success }
    }`,
    { id: issueId, stateId: target.id },
  );
}
