// Mind map of the application: menus, sub-menus, pages and their content.
// The navigation (menus, rails, addresses, redirects) was re-read in web/src/router.tsx and
// web/src/projects/rail-sections.ts on 16/09/2026. The page contents come from a 09/09 survey of the screens,
// translated with the labels the screens show (web/src/*/text.ts):
// they were not re-audited item by item. Regenerate the page:
//   node docs/diagrams/carte-mentale.mjs
// The HTML output is standalone (no dependency), collapsible, with search.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as W from "./carte-mentale-travail.mjs";

// A node: { t: label, path?, badges?: [], note?, content?: [{ s: section, items: [] }], children?: [] }
// Known badges: redirects, no entry, same screen, installation, not wired, menu, heading, modal, ⌘K.

const TASK_RAIL = {
  t: "Task",
  path: "/p/$p/tasks/$id",
  note: "the task rail replaces the project rail, back row “Project”; /tasks/$id redirects here; the bare address opens the channel on an interview, the report if there is one, the trace otherwise",
  content: [...W.TASK_HEAD, ...W.TASK_PANEL.map((c) => ({ s: "Side panel, " + c.s, items: c.items }))],
  children: [
    { t: "Contract", badges: ["heading"], children: [
      { t: "Brief", path: "…/brief", note: "the instructions sent to the agent, editable outside a session; lineage and attachments", content: W.TASK_VIEWS.brief },
      { t: "Criteria", path: "…/criteria", note: "what the task must prove; a task with criteria is never closed by its agent", content: W.TASK_VIEWS.criteria },
    ] },
    { t: "Flow", badges: ["heading"], children: [
      { t: "Channel", path: "…/interview", badges: ["same screen"], note: "the interview thread, same component as /channels/$taskId", content: W.TASK_VIEWS.interview },
      { t: "Report", path: "…/report", note: "the agent's last message, read as a document", content: W.TASK_VIEWS.report },
      { t: "Trace", path: "…/timeline", note: "the raw stream of session events: tool calls, statuses, warnings", content: W.TASK_VIEWS.timeline },
      { t: "Notes", path: "…/notes", note: "the notes written by the agent, across all sessions", content: W.TASK_VIEWS.notes },
    ] },
    { t: "Delivery", badges: ["heading"], children: [
      { t: "Artifacts", path: "…/artifacts", note: "what the agent dropped, what the step expected; the operator's attachments apart", content: W.TASK_VIEWS.artifacts },
      { t: "PR", path: "…/pr", note: "the PR draft, then the diff under it", content: W.TASK_VIEWS.pr },
    ] },
  ],
};

const LIBRARY_RAIL = {
  t: "Library",
  path: "/p/$p/libraries/skills",
  note: "the rail row opens the first registry; a sub-rail of 5 rows replaces the project rail, back row “Project”; /capabilities/* redirects here",
  children: [
    { t: "Skills", path: "…/libraries/skills", note: "the “default for this project” box writes a default of the current project", content: [
      { s: "Project skills", items: ["Drop a skill folder or a SKILL.md on its own", "List: name, description; Read the skill shows the SKILL.md and its bundled files", "“default for this project” box per row", "Delete the skill (also removes the agents' grants)", "Pointer: granting per agent happens on the Agents page"] },
    ] },
    { t: "Rules", path: "…/libraries/rules", note: "permanent instructions injected into the system prompt", content: [
      { s: "Rules", items: ["Drop .md files (frontmatter: name, allAgents, summary, repos, paths)", "Weight of what the default rules inject into every session", "Suggestions extracted from inbox answers: Approve the rule, Reject (quota of 5)", "Write a rule: Title, The rule in full, Summary, file patterns, “Make this rule the default for this project”", "Active project rules: default, repos, locked, patterns, weight, See the rule content, Delete the rule"] },
    ] },
    { t: "Chains", path: "…/libraries/chains", note: "installed chains AND the agent holding each role; the old Settings › Chains redirects here", content: [
      { s: "Installed chains", items: ["Name, description, N steps; See the steps (step agent, gate)", "Under each chain: one picker per role → a project agent, catalog default, remove this mapping", "Promote to the library, Remove from the project"] },
      { s: "Chain library", items: ["Install in this project (also creates missing step agents)", "Remove from the library; chains that ship with Legion cannot be deleted"] },
    ] },
    { t: "MCP servers", path: "…/libraries/mcp", content: [
      { s: "Project MCP servers", items: ["List: name, transport, URL or command, extra proxy hosts", "“default for this project” box", "Add a server: Name, Transport http/sse/stdio, extra hosts, Command or URL + JSON headers; ${SECRET:NAME} resolved at launch", "Delete the server (also removes the agents' grants)", "Pointer: granted agent by agent on the Agents page"] },
    ] },
    { t: "Environments", path: "…/libraries/environments", note: "domain allowlists; removal was decided on 08/09 and is not done: the module, its routes and the agent field are still there", content: [
      { s: "Environments", items: ["List: name, N hosts or “open network (inherited)”, N agents attached", "Edit, Delete the environment (refused while an agent references it)", "Add an environment: Name, Allowed hosts", "Assignment to an agent is on its page, Network field"] },
    ] },
  ],
};

const SETTINGS_RAIL = {
  t: "Settings",
  path: "/p/$p/project/general",
  note: "the rail row opens General; a sub-rail of 8 rows replaces the project rail, back row “Project”; /project/contexte, /modeles, /chaines, /execution, /coffre redirect",
  children: [
    { t: "General", path: "…/project/general", note: "what the project is", content: [
      { s: "Project name", items: ["Name; Id computed from it, and whether it follows the rename", "Rename"] },
      { s: "Project color", items: ["12 hues + Automatic, saved at once; the color of the square in the rail"] },
      { s: "Output folder", items: ["fsRoot, read-only: it is chosen in the New project modal"] },
      { s: "Project context", items: ["Text injected into every session's system prompt, 8,000 characters", "Auto-enriched after each real task completes, editable"] },
    ] },
    { t: "Repos", path: "…/project/repos", note: "how the project touches git", content: [
      { s: "Project repos", items: ["Repositories read from the connected forges, Add; Declare a URL for the others", "Test command per repo, asked of the agent", "Forge per repo; Connect / Reconnect the webhook", "Delete the repo (also removes the agents' access)"] },
      { s: "Git identity of commits", items: ["Author name and email", "Verdict: attached to an account, attributed to nobody, cannot be verified; Use <suggested email>"] },
      { s: "SSH key", items: ["Private key path on the Docker host, never the key; a known_hosts next to it is mounted too"] },
    ] },
    { t: "Secrets", path: "…/project/secrets", note: "the keys this project carries", content: [
      { s: "Claude credentials", items: ["Project accounts in priority order, Move up / Move down one rank", "Quota state per account (active, waiting, exhausted until)", "Add the account, Remove; without one, the control plane's serves"] },
      { s: "Project secrets", items: ["List: variable name, label; encrypted, never read back", "Save the secret or replace it, Delete", "Provider tokens are better set from Integrations"] },
    ] },
    { t: "Integrations", path: "…/project/integrations", note: "since 15/09: OAuth connections owned by the project", content: [
      { s: "Connections", items: ["GitHub, GitLab, Linear: Connect <provider> (device code or redirect), or paste a token", "Connected · OAuth or token, access requested or observed", "Disconnect (does not revoke the token at the provider)"] },
    ] },
    { t: "Models", path: "…/project/models", content: [
      { s: "Project default model", items: ["The last fallback of the routing; cannot be empty"] },
      { s: "Complexity → model routing", items: ["simple, normal, complex: one picker each; empty = project default", "Order: task override → agent model → complexity → project default"] },
    ] },
    { t: "Sessions", path: "…/project/runtime", note: "what the project's sessions run in", content: [
      { s: "Session image", items: ["Image reference (empty: the control plane's)", "Dockerfile layer (FROM, RUN, ENV, USER)", "Per machine: missing or stale, Build here"] },
    ] },
    { t: "Crate", path: "…/project/crate", note: "export only; importing creates another project, from the New project modal", content: [
      { s: "Export the configuration", items: ["Parts to check: agents and their access, repositories, tool servers, rules, templates and chains, secrets", "Passphrase, Repeat the passphrase, File name, Export the crate (.aos)"] },
    ] },
    { t: "Danger", path: "…/project/danger", content: [
      { s: "Danger zone", items: ["Footprint of what goes: tasks, sessions, inbox questions, agents, goals, repos, rules, MCP servers, secrets, environments, templates", "Refused while a session runs", "Delete project <name>, with confirmation"] },
    ] },
  ],
};

const AGENT_PAGE = {
  t: "Agent",
  path: "/p/$p/agents/$agentId",
  note: "opened from a row of the registry; the role in the main column, engine and grants in the margin",
  content: [
    { s: "Header", items: ["Name, “no inbox” and “in session” chips", "Save, Promote to template, Close"] },
    { s: "Job description", items: ["The role as markdown, composed under “## Role”, 20,000 characters; locked during a session"] },
    { s: "Engine", items: ["Model (empty: project model)", "Repo access: no access, read, write (push)", "Machine: preferred runner, or no preference", "Inbox: inbox access", "Network: environment", "Browser: shared runner browser", "Effort and thinking: effort, thinking, budget"] },
    { s: "Grants", items: ["Repos checked (per access level)", "Secrets checked", "Rules checked (outside project defaults)", "MCP servers checked", "Tools: default set or a list, inbox tools locked, mcp__<server>", "Skills checked; project default skills read-only", "Mounted folders", "Default rules of this project, read-only", "Every empty state points to Project or Library"] },
  ],
};

const PROJECT_RAIL = [
  { t: "Work", badges: ["heading"], children: [
    { t: "Board", path: "/p/$p/board", note: "kanban with five columns: Later, Todo, Doing, Review, Done", content: W.BOARD },
    { t: "Channel", path: "/p/$p/channels", note: "the rail row says “Channel”, the page title says “Channels”; /channels/$taskId names the channel in the URL; /canaux redirects", content: W.CHANNELS },
    { t: "Inbox", path: "/p/$p/inbox", note: "the project's queue of decisions", content: W.PROJECT_INBOX, children: [
      { t: "Question", path: "/p/$p/inbox/$inboxId", note: "a round: the questionnaire, the draft, then the read-only view after the answer", content: W.INBOX_QUESTION },
    ] },
    { t: "Goals", path: "/p/$p/goals", note: "goal list and composer; a goal's page on /p/$p/goals/$goalId", content: W.GOALS },
    { t: "Scheduled", path: "/p/$p/scheduled", note: "scheduled tasks: list, detail, run history; /planifiees redirects", content: W.SCHEDULED },
  ] },
  { t: "Review", badges: ["heading"], children: [
    { t: "Pull requests", path: "/p/$p/reviews", note: "the rail row says “Pull requests”, the page title says “Reviews”", content: W.REVIEWS },
    { t: "Issues", path: "/p/$p/issues", note: "Linear issues, filterable, into a Legion task or goal", content: W.ISSUES },
  ] },
  { t: "Configure", badges: ["heading"], children: [
    { t: "Agents", path: "/p/$p/agents", note: "the project's agent registry and the installation's agent library", content: [
      { s: "Project agents", items: ["Filter agents by name or title", "One row per agent: name, title, grants summary (“1 repo (write) · 6 skills · 2 rules”), model, no inbox, in session", "Pointer: the registries (skills, rules, MCP) are managed in Library"] },
      { s: "Agent library", items: ["Add to project: instantiates a template with its private folder", "Delete the template; those that ship with Legion cannot be deleted"] },
    ], children: [AGENT_PAGE] },
    LIBRARY_RAIL,
    SETTINGS_RAIL,
  ] },
  TASK_RAIL,
];

const SYSTEM = {
  t: "System",
  path: "/system → /system/general",
  badges: ["redirects"],
  note: "gear at the foot of the icon rail; the system rail has four rows; /systeme/* redirects",
  children: [
    { t: "General", path: "/system/general", badges: ["installation"], note: "what is not a machine", content: [
      { s: "Version", items: ["Up to date, <tag> available, Ahead, Unknown; Update, Suspend the sessions and update, Check now"] },
      { s: "Identity", items: ["The control plane credential (server/.env): API key or Subscription (OAuth)"] },
      { s: "Daily standup", items: ["Send time or off, Send now, preview"] },
      { s: "Outbound webhooks", items: ["URL + events, add, delete; the kill switch is in the top bar"] },
      { s: "Phone notifications", items: ["Web Push: subscribe this device, list of subscribed devices, remove a device; needs HTTPS, and on iPhone the app added to the home screen"] },
      { s: "Inbound webhooks", items: ["Public URL (Tailscale Funnel) + instance secret; connecting happens repo by repo in Settings › Repos"] },
      { s: "Available models", items: ["Read-only catalog from the SDK: name, description, effort levels"] },
    ] },
    { t: "Runners", path: "/system/runners", badges: ["installation"], note: "/infra and /systeme/infra redirect here", content: [
      { s: "One card per machine", items: ["Name, Docker host, health, Disable / Re-enable / Delete", "Vitals: slots, sessions VM, the machine, VM disk; capacity verdict; zombie sessions, End now", "Settings: concurrent sessions, CPU and RAM per session", "Inventory: session image (missing, stale, Rebuild here), orphans to Clean up, containers, networks, volumes"] },
      { s: "Declare a machine", items: ["Name, Docker host (ssh://…), Callback address, Concurrent sessions, Declare"] },
    ] },
    { t: "Log", path: "/system/logs", badges: ["installation"], note: "the control plane log, read-only; /logs and /systeme/journal redirect here", content: W.LOG },
    { t: "Analytics", path: "/system/analytics", badges: ["installation"], note: "the page title says “Statistics”: cost, duration and failure rate by agent and model; /analytics and /systeme/statistiques redirect here", content: W.ANALYTICS },
  ],
};

export const TREE = [
  { t: "Icon rail", badges: ["menu"], note: "always on the left: the brand, one square per project, and at the foot the workstation settings", children: [
    { t: "Logo", path: "/", note: "goes to the last project opened; with no project, the home page “Nothing to run yet”", content: W.HOME },
    { t: "One square per project", path: "/p/$id/board", note: "badge with the number of decisions waiting; the second rail becomes the project rail, with Switch project at the top", children: PROJECT_RAIL },
    { t: "New project", badges: ["modal"], note: "Blank or Import a crate", content: W.NEW_PROJECT },
    { t: "The wiki", path: "/wiki", note: "the documentation, versioned with the code; a page and its backlinks on /wiki/$slug", content: W.WIKI },
    SYSTEM,
  ] },
  { t: "Top bar", badges: ["menu"], note: "names the screen, carries the machine state and the global gestures", children: [
    { t: "Page title", note: "the same table as the document title" },
    { t: "Machine status", note: "shown when there are projects", content: [
      { s: "Sessions", items: ["Count and tooltip: all sessions, all projects"] },
      ...W.WAITING_PANEL,
      { s: "Docker", items: ["Runner fleet popover → Open Runners (/system/runners)"] },
      { s: "Update under way", items: ["Conditional"] },
    ] },
    { t: "Version", path: "/system/general", note: "version chip, shown when a newer version is available" },
    { t: "Search", badges: ["⌘K"], note: "opens the command palette" },
    { t: "Concierge", path: "/concierge", note: "a panel for the quick question, and Open the page", children: [
      { t: "Situation report", path: "/concierge", note: "what needs a decision, in sentences; then the conversation", content: W.CONCIERGE },
      { t: "Conversations", path: "/concierge/conversations", note: "the list of conversations held; one is picked up on /concierge/conversations/$id" },
    ] },
    { t: "Theme", note: "device, light, dark" },
    { t: "Notifications", note: "global switch for outgoing notifications: push, webhooks, channels" },
  ] },
  { t: "Command palette", badges: ["menu"], note: "three actions, six destinations, the projects, the wiki pages, a lookup by id", content: [
    { s: "Actions", items: ["Create a task, Create a goal, New project"] },
    { s: "Go to", items: ["Home /", "Inbox (the current project's)", "System /system/general", "Runners /system/runners, Log /system/logs, Analytics /system/analytics"] },
    { s: "Projects", items: ["One shortcut per project → its board"] },
    { s: "Wiki", items: ["One entry per page"] },
    { s: "Id", items: ["Task → /tasks/$id, goal → /goals/$id, agent → /agents/$id (they redirect), project → board"] },
  ] },
  { t: "Outside the menus", badges: ["no entry"], note: "what the router serves without any menu leading to it", children: [
    { t: "Chain flow", path: "/p/$p/chains/$runId", badges: ["no entry"], note: "from the step chip of a card or the head of a task (See the chain flow); no second rail; /chains/$runId redirects", content: W.CHAIN_RUN },
    { t: "Global addresses", path: "/tasks/$id, /goals/$id, /agents/$id", badges: ["redirects"], note: "redirect to the address under the project" },
    { t: "Legacy addresses", path: "/infra, /logs, /analytics, /systeme/*, French project paths", badges: ["redirects"], note: "kept as direct redirects to the English addresses" },
  ] },
];

const BADGE_CLASS = {
  "redirects": "b-redir", "no entry": "b-orph", "same screen": "b-same",
  "installation": "b-glob", "not wired": "b-gone", "menu": "b-menu",
  "heading": "b-menu", "modal": "b-menu", "⌘K": "b-menu",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function renderNode(n, depth) {
  const open = depth <= 1 ? " open" : "";
  const badges = (n.badges ?? []).map((b) => `<span class="badge ${BADGE_CLASS[b] ?? ""}">${esc(b)}</span>`).join("");
  const path = n.path ? `<code class="path">${esc(n.path)}</code>` : "";
  const note = n.note ? `<span class="note">${esc(n.note)}</span>` : "";
  const content = n.content
    ? `<details class="content"><summary>Page content</summary>${n.content.map((c) => `<div class="sec"><div class="sec-t">${esc(c.s)}</div><ul>${c.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`).join("")}</details>`
    : "";
  const children = (n.children ?? []).map((c) => renderNode(c, depth + 1)).join("");
  return `<details class="n d${depth}"${open}><summary><span class="t">${esc(n.t)}</span>${path}${badges}${note}</summary><div class="body">${content}${children}</div></details>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Legion map</title>
<style>
:root{color-scheme:light dark;--bg:#f7f6f2;--fg:#1c1b19;--muted:#6b6963;--line:#dcd9d1;--card:#fff;--accent:#0f766e;
--redir:#b45309;--redir-bg:#fef3c7;--orph:#b91c1c;--orph-bg:#fee2e2;--dup:#7c3aed;--dup-bg:#ede9fe;--same:#0369a1;--same-bg:#e0f2fe;--glob:#475569;--glob-bg:#e2e8f0;--gone:#525252;--gone-bg:#e5e5e5;--menu:#0f766e;--menu-bg:#ccfbf1}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#a3a19a;--line:#33322f;--card:#1f1e1c;--accent:#5eead4;
--redir:#fcd34d;--redir-bg:#3b2a05;--orph:#fca5a5;--orph-bg:#3f1414;--dup:#c4b5fd;--dup-bg:#2a1f4d;--same:#7dd3fc;--same-bg:#0c2a3d;--glob:#cbd5e1;--glob-bg:#2b3442;--gone:#d4d4d4;--gone-bg:#333;--menu:#5eead4;--menu-bg:#123b36}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 24px;z-index:2}
h1{font-size:18px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 10px}
.tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
input[type=search]{flex:1;min-width:220px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);font:inherit}
button{padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);font:inherit;cursor:pointer}
button:hover{border-color:var(--accent)}
.legend{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;color:var(--muted)}
main{padding:16px 24px 48px;max-width:1200px}
details.n{border-left:1px solid var(--line);margin:4px 0 4px 0;padding-left:12px}
details.n.d0{border-left:none;padding-left:0;margin:18px 0}
details.n.d0>summary .t{font-size:16px}
summary{cursor:pointer;list-style:none;padding:4px 6px;border-radius:6px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸";color:var(--muted);width:12px;display:inline-block}
details[open]>summary::before{content:"▾"}
summary:hover{background:var(--card)}
.t{font-weight:700}
.path{color:var(--accent);font-size:12.5px}
.note{color:var(--muted);flex-basis:100%;padding-left:22px;font-family:ui-sans-serif,system-ui,sans-serif}
.badge{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid transparent}
.b-redir{color:var(--redir);background:var(--redir-bg)}.b-orph{color:var(--orph);background:var(--orph-bg)}.b-dup{color:var(--dup);background:var(--dup-bg)}
.b-same{color:var(--same);background:var(--same-bg)}.b-glob{color:var(--glob);background:var(--glob-bg)}.b-gone{color:var(--gone);background:var(--gone-bg);text-decoration:line-through}.b-menu{color:var(--menu);background:var(--menu-bg)}
.body{padding-left:8px}
details.content{margin:4px 0 8px 22px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px 10px}
details.content>summary{color:var(--accent);font-size:12.5px}
details.content>summary::before{content:"+"}details.content[open]>summary::before{content:"−"}
.sec{margin:6px 0 10px;font-family:ui-sans-serif,system-ui,sans-serif}
.sec-t{font-weight:600;margin-bottom:2px}
.sec ul{margin:0;padding-left:18px;color:var(--fg)}
.sec li{margin:1px 0}
[hidden]{display:none!important}
</style>
</head>
<body>
<header>
  <h1>Legion map: menus, pages, contents</h1>
  <p class="sub">What the application offers and where. Navigation read from the code on 16/09/2026; page contents from the 09/09 survey, with the screens' current labels. Click to unfold; “Page content” lists the sections and gestures of each screen.</p>
  <div class="tools">
    <input type="search" id="q" placeholder="Search a word: secret, webhook, model, gate…" autocomplete="off">
    <button id="all">Unfold all</button>
    <button id="none">Fold all</button>
    <button id="contents">Unfold contents</button>
  </div>
  <div class="legend">
    <span class="badge b-menu">menu</span><span class="badge b-redir">redirects</span><span class="badge b-orph">no entry</span><span class="badge b-same">same screen</span><span class="badge b-glob">installation</span>
  </div>
</header>
<main>
${TREE.map((n) => renderNode(n, 0)).join("\n")}
</main>
<script>
const q=document.getElementById("q");
const nodes=[...document.querySelectorAll("details.n")];
function filter(){
  const s=q.value.trim().toLowerCase();
  if(!s){nodes.forEach(d=>{d.hidden=false});return;}
  nodes.forEach(d=>{d.hidden=true});
  nodes.forEach(d=>{
    const own=d.querySelector(":scope > summary").textContent.toLowerCase()+" "+(d.querySelector(":scope > .body > details.content")?.textContent.toLowerCase()??"");
    if(own.includes(s)){let e=d;while(e){e.hidden=false;e.open=true;e=e.parentElement?.closest("details.n")??null;}}
  });
}
q.addEventListener("input",filter);
document.getElementById("all").onclick=()=>nodes.forEach(d=>d.open=true);
document.getElementById("none").onclick=()=>{nodes.forEach(d=>d.open=false);document.querySelectorAll("details.n.d0").forEach(d=>d.open=true);};
document.getElementById("contents").onclick=()=>{nodes.forEach(d=>d.open=true);document.querySelectorAll("details.content").forEach(d=>d.open=true);};
</script>
</body>
</html>
`;

// Writes the file only when this module is run directly; imported (for instance to build another
// page from TREE), it does not touch the disk.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(here, "carte-mentale.html"), html);
  console.log("wrote docs/diagrams/carte-mentale.html", html.length, "bytes");
}
