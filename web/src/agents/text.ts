// The text of the AGENTS domain: the registry you scan, the page where an agent is read and
// corrected, and — the reason this screen exists — the list of what it is allowed to reach.
//
// The grant list borrows its scope names from `ui/vocabulary.ts` instead of restating them: the
// same word must label the group heading rendered by `PermissionList` and the collapsed summary
// rendered here, and two copies of "MCP servers" is exactly the drift no reviewer catches.
import { defineText } from "../i18n/catalog.js";
import { UI_TEXT } from "../ui/vocabulary.js";
import { plural } from "../ui/plural.js";

export const AGENT_TEXT = defineText({
  /** Said in the registry row AND in the page header: one agent, one wording. */
  chip: {
    noInbox: "no inbox",
    inSession: "in session",
    projectModel: "project model",
    projectModelWhy: "No model of its own: this agent runs on the project model",
  },

  /** "1 repo (read) · 6 skills · 2 rules · 1 secret" — an agent's grants in one line. Zeros are
   *  SILENT: what is not granted has nothing to say, and a registry row listing five zeros is no
   *  longer scannable. */
  capabilities: {
    noRepoAccess: "no repo access",
    noRepoGranted: "no repo granted",
    /** The repo access level, read the way it is spoken — not the enum value. */
    repos: (count: number, access: "read" | "write") =>
      `${count} ${plural(count, "repo")} (${access})`,
    skills: (n: number) => `${n} ${plural(n, "skill")}`,
    rules: (n: number) => `${n} ${plural(n, "rule")}`,
    mcp: (n: number) => `${n} MCP`,
    secrets: (n: number) => `${n} ${plural(n, "secret")}`,
  },

  /** The registry — /p/:projectId/agents. */
  registry: {
    title: "Agents",
    /** The sentence comes in pieces so it does not swallow the link that ends it. */
    sub: "An agent carries a role and its grants — click a row to open it. The registries (skills, rules, MCP) are managed in",
    subLinkLabel: "Library",
    cardTitle: "Project agents",
    listLabel: "Agent registry",
    loading: "Loading the project agents…",

    /** The filter only appears once it earns its place: at two agents a search field is furniture. */
    filterLabel: "Filter the agent registry",
    filterFieldLabel: "Filter agents by name or title",
    filterPlaceholder: "name, title…",
    shown: (shown: number, total: number) => `${shown} of ${total} agents`,
    clearFilter: "Clear the filter",

    emptyTitle: "No agent on this project",
    emptyWhy:
      "An agent carries a role and its grants. Add one from the library below — it arrives with its private folder and nothing else.",
    noMatchTitle: "No agent matches",
    noMatch: (needle: string, total: number) =>
      `The filter “${needle}” matches neither a name nor a title among the ${total} agents on this project.`,
  },

  /** The cross-project library: the role and the settings travel, the grants stay per project.
   *  Deliberately worded like the chain library (`chains/text.ts`) — same mechanism, same screen
   *  shape, and a reader who has met one should not have to re-learn the other. */
  library: {
    title: "Agent library",
    desc: "“Promote” an agent (button on its page) adds it here; “Add to project” instantiates it with its private folder by default — its access (folders, repos, MCP…) is set afterwards.",
    listLabel: "Agent templates",
    empty: "No template yet.",
    add: "Add to project",
    alreadyAdded: "already on this project",
    builtin: "· ships with Legion, cannot be deleted",
    remove: "Delete the template (existing agents do not move)",
  },

  /** The agent page — read and correct what the agent IS. */
  page: {
    title: "Agent",
    loading: "Loading the agent…",
    missingTitle: "Agent not found",
    missingWhy: "It may have been deleted, or the id in the URL belongs to no loaded agent.",
    backHome: "Back to the dashboard",
    backToRegistry: "Agent registry",
    close: "Close — back to the agent registry",

    unsaved: "unsaved changes",
    save: "Save",
    promote: "Promote to template",
    promotedTitle: "Agent promoted",
    promotedWhy:
      "It is in the agent library, under the registry — its role and its settings travel, its grants stay on this project.",

    /** A fallback list looks EXACTLY like the real one: unsaid, you configure tier aliases
     *  believing you are choosing among the models actually available. */
    fallbackTitle: "Unverified model list",
    fallbackWhy:
      "The SDK could not be queried (no credential, or offline): only the tier aliases are offered. They stay valid — it is the full list that is missing.",

    paneLabel: "Agent settings and grants",
    roleCard: "Job description",
    engineCard: "Engine",
    grantsCard: "Grants",
  },

  /** The role — what the agent IS, composed into its system prompt. */
  role: {
    label: (name: string) => `Role of ${name}`,
    hint: "Composed into the system prompt under “## Role”, after the shared base and the description of its grants. 20,000 characters max.",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    /** Never a greyed button: when a session of the agent is alive, the reason is written out —
     *  its spec has already left. */
    locked: "sent to the running session — no longer editable",
  },

  /** The engine settings: which model, with what effort and thinking, and how far it sees. */
  settings: {
    model: "Model",
    modelLabel: (name: string) => `Model of agent ${name}`,
    modelEmpty: (defaultModel: string) => `project model (${defaultModel})`,

    repoAccess: "Repo access",
    repoAccessLabel: (name: string) => `Repo access level of ${name}`,
    repoNone: "no access",
    repoRead: "read",
    repoWrite: "write (push)",

    /** The machine preference is SOFT — it sorts the fleet, it does not refuse. The chosen
     *  machine of a task (`tasks/runner-choice.tsx`) is the hard one. */
    machine: "Machine",
    machineHint: "sorted first in the fleet; falls back if it does not answer",
    machineLabel: (name: string) => `Preferred machine of ${name}`,
    machineAny: "no preference — the fleet decides",
    machineDisabled: " — disabled",
    machineAsleep: " — asleep",

    inbox: "Inbox",
    inboxHint: "can ask the operator a question, or file one",
    inboxCheckbox: "inbox access",

    network: "Network",
    networkLabel: (name: string) => `Network environment of ${name}`,
    networkHint:
      "an environment RESTRICTS its sessions to a list of hosts; without one they reach out freely",
    /** The empty option says what "none" DOES, not just that it is empty. It changed twice on
     *  25/08, in both directions, which is the proof it has to be written here. */
    networkNone: "no environment — no restriction",
    networkOpen: " — open",
    networkHosts: (count: number) => ` — ${count} ${plural(count, "host")}`,

    browser: "Browser",
    browserHint: "UI checks: screenshots into the artifacts, no internet access",
    browserCheckbox: "shared runner browser",

    /** Two axes of the SAME model, set once then forgotten: folded away rather than holding the
     *  margin open. */
    reasoning: "Effort and thinking",
    effort: "Effort",
    effortLabel: (name: string) => `Reasoning effort of ${name}`,
    modelDefault: "model default",
    thinking: "Thinking",
    thinkingLabel: (name: string) => `Extended thinking of ${name}`,
    thinkingAdaptive: "adaptive",
    thinkingFixed: "fixed budget",
    thinkingOff: "disabled",
    budget: "Budget",
    budgetHint: "tokens, ≥ 1024",
    budgetLabel: (name: string) => `Thinking budget of ${name}`,
  },

  /** The grants, in detail. Least privilege: everything starts unchecked, every grant is
   *  explicit. Each empty state NAMES THE WAY OUT — a right nobody can find is a right nobody
   *  grants. */
  permissions: {
    label: (name: string) => `Grants given to ${name}`,
    libraryLink: "Library",
    projectLink: "Project",

    noRepo: "No repository — add one in",
    /** A disabled checkbox WITHOUT a reason reads as a dead click. The reason is written in the
     *  open rather than in a `title` a disabled control never shows anyway. */
    repoAccessFirst: "Set “Repo access” to read or write above first.",

    noSecret: "No secret on this project — add one in",
    /** The Claude credential reaches every session whether or not it is checked here. */
    authSecret: "Claude credential — no grant needed",

    mcpTitle: UI_TEXT.permission.scope.mcp,
    mcpEmptyBadge: "0 MCP server",
    noMcp: "No server — add one in",

    toolsTitle: UI_TEXT.permission.scope.tools,
    toolsDefaultBadge: (size: number) => `default set, ${size} tools`,
    toolsCountBadge: (used: number, size: number) => `${used} of ${size} tools`,
    inboxToolsLocked:
      "This agent has inbox access: inbox_ask and inbox_send cannot be removed — it could no longer reach you.",
    wholeServer: "whole MCP server",
    /** Outside the catalogue: inherited, server since deleted, or a server catalogue that moved.
     *  Checked and uncheckable — silencing it would hide the entry that fails EVERY save. */
    unknownTool: "outside the allowlist — uncheck to remove it",
    defaultSet: "Default set — no restriction of its own.",
    backToDefaultSet: "Back to the default set",

    skillsTitle: UI_TEXT.permission.scope.skills,
    skillsEmptyBadge: "0 skill",
    noSkill: "No skill — drop one in",
    inheritedSkills: "Project default skills",
    inheritedSkillsBadge: (n: number) => `${n} ${plural(n, "inherited skill")}`,
    projectDefault: "project default",

    folders: "Mounted folders",
    foldersBadge: (n: number) => `${n} ${plural(n, "mounted folder")}`,
    noFolder: "No mounted folder — this agent writes nowhere on disk.",
    /** Deleting is a write right, not a fourth level. */
    canDelete: "delete",

    /** The "default for this project" rules apply WITHOUT being checked: silencing them made the
     *  card read "this agent has one rule, switched off" when it had four. */
    projectRules: "Default rules of this project",
    projectRulesBadge: (n: number) => `${n} ${plural(n, "rule")} applied to every agent`,
    projectRuleDetail: "default of this project",
    noRule: "No rule — create one in",
  },
});
