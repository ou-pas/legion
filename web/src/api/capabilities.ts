import { json, post } from "./client.js";

export type Rule = {
  id: string;
  projectId: string;
  name: string;
  content: string;
  allAgents: boolean;
  status: "active" | "suggested";
  createdAt: string;
  /** v41. Empty = a short rule, its whole `content` goes into the prompt. Otherwise the prompt
   *  carries this summary and `content` is placed in the session workspace, read when it applies. */
  summary: string;
  /** v41. JSON `string[]` of the repositories concerned. Empty = the rule applies everywhere. */
  repoNames: string;
  /** v42. No `.claude/rules/*.md` of a cloned repository can replace it. False by default: the
   *  repository wins, because for a convention it is the up-to-date one. Lock the rules that exist
   *  TO constrain the agent. */
  locked: boolean;
  /** v60. JSON `string[]` of globs, in the grammar of Claude Code's `paths:` frontmatter. Empty =
   *  always applies; otherwise it enters context only when the session opens a matching file.
   *  `repoNames` says WHERE, `allAgents` FOR WHOM, this one WHEN: three independent axes. */
  paths: string;
};
export type McpServer = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  url: string | null;
  command: string | null;
  allowedHosts: string[];
  /** v35: active on every agent of the project, like a rule. */
  allAgents: boolean;
  createdAt: string;
};
export type SkillInfo = { name: string; description: string };
/** A skill's SKILL.md (what the model reads first) and the inventory of its other files, to show
 *  the real weight without serving them all. */
export type SkillDetail = {
  name: string;
  content: string;
  truncated: boolean;
  files: { path: string; bytes: number }[];
};

/** The tool catalog as the server declares it (`GET /api/tool-catalog`, v32): the allowlist
 *  `validateAllowedTools` applies, and the default set of an agent without its own.
 *
 *  It replaces a static mirror in `api/agents.ts` that failed silently: the server accepted
 *  `WebSearch`/`WebFetch` (agent `interviewer`, D18) while the screen could not tick them, and the
 *  grants card filed two legitimate tools as "outside the allowlist", one click from removal. A
 *  copied list ends up lying; this one is READ. */
export type ToolCatalog = {
  baseSdkTools: string[];
  legionMcpTools: string[];
  /** Applied when `agents.allowedTools` is NULL. */
  defaultTools: string[];
  /** Without them an `inboxAccess` agent can no longer talk to the human: the server refuses (400). */
  requiredInboxTools: string[];
  /** Under the same runtime gate as the inbox, ticked or not. */
  inboxGatedTools: string[];
};

export const capabilitiesApi = {
  toolCatalog: (): Promise<ToolCatalog> => fetch("/api/tool-catalog").then(json),
  skills: (): Promise<SkillInfo[]> => fetch("/api/skills").then(json),
  skill: (name: string): Promise<SkillDetail> =>
    fetch(`/api/skills/${encodeURIComponent(name)}`).then(json),
  uploadSkill: (body: { name: string; files: { path: string; b64: string }[] }) =>
    post("/api/skills", body),
  deleteSkill: (name: string) =>
    fetch(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" }).then(json),
  mcpServers: (projectId: string): Promise<McpServer[]> =>
    fetch(`/api/mcp-servers?projectId=${projectId}`).then(json),
  createMcpServer: (body: {
    projectId: string;
    name: string;
    config: Record<string, unknown>;
    allowedHosts?: string[];
    allAgents?: boolean;
  }) => post("/api/mcp-servers", body),
  patchMcpServer: (id: string, body: { allAgents: boolean }) =>
    fetch(`/api/mcp-servers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json),
  deleteMcpServer: (id: string) => fetch(`/api/mcp-servers/${id}`, { method: "DELETE" }).then(json),
  rules: (projectId: string): Promise<Rule[]> =>
    fetch(`/api/rules?projectId=${projectId}`).then(json),
  createRule: (body: {
    projectId: string;
    name: string;
    content: string;
    allAgents?: boolean;
    summary?: string;
    /** Names must exist on the project: an unknown repository is REFUSED by name, not silently
     *  dropped, since a rule scoped to a ghost name would never apply. */
    repoNames?: string[];
    locked?: boolean;
    /** v60. Globs relative to the session workspace, so prefixed `repos/<name>/`. Refused if they
     *  leave the workspace (absolute path, `..`); never refused for matching nothing, since an
     *  unmatched glob is an intention, not a typo. */
    paths?: string[];
  }): Promise<Rule> => post("/api/rules", body),
  patchRule: (
    id: string,
    body: {
      name?: string;
      content?: string;
      allAgents?: boolean;
      status?: "active" | "suggested";
      summary?: string;
      repoNames?: string[];
      locked?: boolean;
      paths?: string[];
    },
  ) =>
    fetch(`/api/rules/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json),
  deleteRule: (id: string) => fetch(`/api/rules/${id}`, { method: "DELETE" }).then(json),
};
