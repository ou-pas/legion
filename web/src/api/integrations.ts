import { json, patch, post } from "./client.js";

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  state: string;
  stateType: string;
  project: string | null;
  /** Linear assignee/team (v24). `assignee` is `null` when nobody is assigned (normal case);
   *  `team` is `null` only if Linear does not provide it (defensive). When not `null`, `id` and
   *  `name` are both set. Contract: server/src/integrations/linear.ts. */
  assignee: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
};

/** Sent to the server, which passes them to Linear (01/09): filtering here would sort the fifty
 *  issues already fetched, an arbitrary sample of the workspace. An empty dimension = no constraint. */
export type LinearIssueFilter = { assigneeId?: string; teamId?: string; state?: string };

/** What the menus are built from: the workspace, not the displayed batch of issues. */
export type LinearOptions = {
  members: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  states: string[];
};

/** Inbound webhook state: never the secret, only whether it exists. The server presents it to the
 *  forges; the screen has no use for it. */
export type InboundWebhooks = {
  baseUrl: string | null;
  secretReady: boolean;
  connectedRepos: number;
};

export const integrationsApi = {
  inboundWebhooks: (): Promise<InboundWebhooks> => fetch("/api/inbound-webhooks").then(json),
  /** Sets the public URL (the funnel host, https). Empty string = clear the setting. */
  setInboundBaseUrl: (baseUrl: string): Promise<{ ok: true; baseUrl: string | null }> =>
    patch("/api/inbound-webhooks", { baseUrl }),
  /** Creates Legion's hook on this repo through the forge API. Refusals are named: no public URL,
   *  undeclared forge, missing token, API refusal. */
  connectRepoWebhook: (repoId: string): Promise<{ ok: true; id: string; existing: boolean }> =>
    post(`/api/repos/${repoId}/webhook`),
  linearIssues: (projectId: string, filter: LinearIssueFilter = {}): Promise<LinearIssue[]> => {
    // A state label is free text typed by a human ("In progress / blocked") and must be encoded,
    // or the query splits in two.
    const q = new URLSearchParams({ projectId });
    if (filter.assigneeId) q.set("assigneeId", filter.assigneeId);
    if (filter.teamId) q.set("teamId", filter.teamId);
    if (filter.state) q.set("state", filter.state);
    return fetch(`/api/linear/issues?${q.toString()}`).then(json);
  },
  linearOptions: (projectId: string): Promise<LinearOptions> =>
    fetch(`/api/linear/options?projectId=${projectId}`).then(json),
};
