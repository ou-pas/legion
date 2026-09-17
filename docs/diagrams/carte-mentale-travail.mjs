// Content of the WORK pages (board, channels, inbox, goals, scheduled, pull requests, issues,
// task page, concierge, wiki, log, analytics, home, chain flow, waiting panel).
// Survey of 09/09/2026, translated on 16/09 with the labels the screens now show
// (web/src/*/text.ts). Imported by carte-mentale.mjs; same shape: { s: section, items: [] }.

export const BOARD = [
  { s: "Outage banner", items: ["“Docker is not responding” or “Session image missing”, with the fixing gesture and an Open Runners link"] },
  { s: "Project inbox strip", items: ["One card per open question: agent, task, round N, waiting for / asleep for / resumes at, title, answer preview, 2 / 6 gauge", "Answer, Resume, See the answers; a multiple-choice question is answered in place"] },
  { s: "Composer", items: ["“Describe a task, or a chain request…”, project picker", "Brief (text + attachments), Settings (agent or chain, complexity, priority, approval gate, read-only)", "Save for later, Discuss first, Run; proposal line (proposed / set by hand)"] },
  { s: "Five columns", items: ["Later, Todo, Doing, Review, Done: label, n / total count, share gauge; Done carries Archive all", "Drag and drop, keyboard handle; “Move refused” when the server refuses", "One empty state per column, with its reason"] },
  { s: "Task card", items: ["Approval gate, read-only, blocked and goal-step icons; title on two lines", "Chips: agent, queued, blocked by N, scheduled, step N → chain flow, waiting for “X”, session state", "Derived state: Not started, Running, Waiting for an answer, Waiting for approval, Completed, Failed, Conflicts with its column", "Footer: priority, complexity; on Done, Archive; the whole card opens the task"] },
];

export const CHANNELS = [
  { s: "Channel list (left pane)", items: ["Three counted sections: Waiting for you, Running, On hold; “N alike” for identical questions", "A row: state mark (question, gate, activity, pause), task name, question excerpt, waiting badge", "Footer: channels closed today, tasks in “Later”, link to the board"] },
  { s: "Conversation", items: ["Header: task, state, agent, model, branch, Open the task page", "Thread: brief · pinned, “session N” breaks and end cause, agent turns, folded work (“worked for 4 min”), replayed rounds, dated notices", "“The thread is cut” + Reconnect when the stream drops", "Current question at the top of the thread; Wrap up the interview on an interview task", "Decision band at the bottom: Approve, Run the task again, Move to done anyway, See the PR draft", "Composer: steering during the session, otherwise a message that restarts the agent"] },
  { s: "Task state (third pane)", items: ["State: status, agent, model, cost, rounds, branch", "Artifacts: dropped files, Diff and PR draft link", "Lineage: comes from, filed", "Grants: repos, network, secrets"] },
];

export const PROJECT_INBOX = [
  { s: "Waiting for a decision", items: ["One row per question: icon, title, task · agent, gauge or “3 choices” / “free text”, age, Answer / Resume"] },
  { s: "Will wake up on its own", items: ["Same rows, “waiting” tag, Wake up with an optional word"] },
  { s: "Answered recently", items: ["See the answers"] },
  { s: "Notifications", items: ["Standups as paragraphs, Mark as read"] },
];

export const INBOX_QUESTION = [
  { s: "Bar and header", items: ["Breadcrumb Inbox → task → Round N; Open the channel, Task page", "Task, agent, round, state (waiting for, answered by you, answered by the system, closed without an answer), draft saved"] },
  { s: "Question", items: ["Question body, folded block “What the agent read, and what this round decides”", "Rounds bar: Round 1 · 4 questions, Round 2 · open · 2/6"] },
  { s: "Questionnaire", items: ["Rail: one entry per question, chosen answer or “to decide”, gauge, Recap and send", "One question per screen, optional comment, Previous / Next", "Recap: editable lines, Comment for the agent, Send the N answers, missing answers named"] },
  { s: "After the answer", items: ["The same page, read-only: what the agent received, the recommendation you turned down, the child task filed"] },
];

export const GOALS = [
  { s: "List", items: ["Goal state filter Live / Done / All, New goal", "A row: name, DoD 3/7 · 12 iterations · $4.20 / $20.00, status, mock"] },
  { s: "Create a goal (modal)", items: ["Project, Goal name, Request in plain language, Budget $, Max duration h → Generate the DoD", "Criteria editor → Approve and run"] },
  { s: "Goal page", items: ["Title, status; Approve and run, Pause / Resume, Kill switch, Delete the goal (footprint named)", "Definition of Done: editable in draft, checklist and gauge after; Generate the DoD again", "Plan · N steps, with drift “beyond the plan”", "Goal tasks → each task; Orchestrator log", "Guardrails: budget, duration, iterations without progress, iterations; Edit the guardrails; the request, Edit the brief"] },
];

export const SCHEDULED = [
  { s: "List", items: ["A row: name, UTC cron, enabled / disabled, next, last; clicking selects"] },
  { s: "Detail", items: ["Cron, time zone, status, next and last run, target (agent, chain, prompt)", "Trigger history: created, disabled, missed, errors; one item per run → the task"] },
  { s: "What is missing", items: ["No create or edit form on this page"] },
];

export const REVIEWS = [
  { s: "One panel per PR", items: ["Title, comment count, repo#number (forge), branch, merge state", "One comment per row: body, author · path, link to the forge, Create a fix task"] },
  { s: "Fix task (modal)", items: ["Task prefilled “Fix repo#N”, agent, approval gate, Run now; the agent works on the PR branch"] },
  { s: "States", items: ["No GitHub token → Open Settings; error → Retry, Check the secret; No open legion/* PR"] },
];

export const ISSUES = [
  { s: "Filters", items: ["Assignee, Status, Team (values from the Linear workspace), Reset the filters", "Create a goal (N issues) once two are checked, Refresh"] },
  { s: "Register", items: ["A row: checkbox with the identifier, title, Linear project, state; Open in Linear, linked task or Create a task, expandable description"] },
  { s: "Create a task (modal)", items: ["Name “ABC-123 — title”, agent, approval gate checked, Run now; the issue moves to In Progress, the PR will say Closes ABC-123"] },
  { s: "States", items: ["Linear not connected → Open Integrations; error → Retry, Check the connection; no open issue; no issue matches the filters"] },
];

export const TASK_HEAD = [
  { s: "Title", items: ["Approval gate and read-only icons, name; under it the external reference, the container → Runners, the chain tag → See the chain flow"] },
  { s: "Action bar", items: ["Approve (in two steps if a prerequisite is not done), Create the PR, Discuss first, Run, Move the task to", "Resume in the terminal, Pause, Stop the session, Copy the trace, Delete, side panel, Close"] },
  { s: "Verdict", items: ["Live session: current tool, steering field “say something to it…”, since X", "Waiting: dependency (“resumes on its own”), out of quota (“the session sleeps until the reset”), turn budget spent", "Failure: Stopped before the end, Run the task again, Machine for this task, See the artifacts", "End: agent, model, cost, turns, duration, branch, PR mark, Open the draft"] },
  { s: "Under the verdict", items: ["The questions of this task (Answer), Wrap up the interview", "Blocked by N tasks, with their status", "Batch of slices in review: Approve the batch, refusal listing the faults"] },
];

export const TASK_PANEL = [
  { s: "Settings (before any session)", items: ["Title, agent, complexity, priority, forced model, approval gate, read-only; task id at the bottom"] },
  { s: "Runtime & context (once a session exists)", items: ["Runner & container (or “destroyed — the session is asleep, no cost”), agent", "Model & cost: model, session cost, task cost, turns, duration, end", "Git: branch, commit", "Settings (frozen), Dependencies; Open the trace, Stop the session, Session ID"] },
];

export const TASK_VIEWS = {
  brief: [{ s: "Brief", items: ["The text as paragraphs, Edit / Write the brief, locked while a session runs", "Attachments: drop (8 MB max), Remove, “Passed to the running agent”", "Lineage: Proposed during, Proposed (with suggested agent), prerequisite, Hand to <agent>"] }],
  criteria: [{ s: "What this task must prove", items: ["Ordered list: criterion, mode, edge case, Validation command"] }],
  interview: [{ s: "Channel", items: ["The same thread as the channel: pinned brief, segments; open the channel", "“This task is not an interview” otherwise"] }],
  report: [{ s: "Report", items: ["The agent's last message as markdown; the full stream stays in Trace"] }],
  timeline: [{ s: "Trace", items: ["Full-height timeline, follows the bottom, “N events”, Reconnect if the stream drops"] }],
  notes: [{ s: "Notes", items: ["What the agents wrote when changing the status, across all sessions"] }],
  artifacts: [{ s: "Artifacts", items: ["Expected for this step (present / absent)", "Attached by the operator (read-only)", "Dropped by the agent: clickable chips, file preview"] }],
  pr: [{ s: "PR", items: ["Repairs: Resolve the conflicts, Fix the CI", "pr.md draft as markdown; Confirm and create the PR, Recreate / find the PR", "Pre-review of the diff, commented line by line: file tree, comment on a line or a range, Send to the agent (N)"] }],
};

export const CONCIERGE = [
  { s: "Situation report", items: ["Age (“6 min ago, across 3 projects”), refresh it (the only gesture that spends)", "Prose, then the sorted list: now, soon, for info, Open → the task"] },
  { s: "Conversation", items: ["You / Concierge turns, field “what ran overnight?”, Ask; read-only · no write tool; Start over"] },
  { s: "Conversations", items: ["Title, “4 turns · 2 h ago” → the conversation, picked up where it left off"] },
];

export const WIKI = [
  { s: "Page", items: ["“On this page” column: one anchor per section", "The page as markdown, internal links (a dead link says “this page does not exist yet”), “page truncated on screen” when needed", "Pages that point here: the backlinks"] },
  { s: "Rail", items: ["Wiki contents, grouped by folder; “General” for the root"] },
];

export const LOG = [
  { s: "Filters", items: ["Level (info, warning, error), Limit (50 to 1000), Filter by source or message"] },
  { s: "Table", items: ["Level, Source, Message, Detail (JSON payload), Timestamp; “limit reached”"] },
];

export const ANALYTICS = [
  { s: "Total across measured sessions", items: ["Sessions (N agent × model pairs), Failures (%), Total cost"] },
  { s: "Table", items: ["Agent, Model, Sessions, Failures, Failure rate, Avg. duration, Cost; refreshed every 15 s, no filter", "Note: a 0% failure rate on a big model makes it a candidate for a smaller one"] },
];

export const HOME = [
  { s: "The ground (preflight)", items: ["Score “2 of 3”: A Claude credential, Docker answers, the session image; fixing command and observed value for each"] },
  { s: "Create", items: ["One field: the repository the agents will work on; derived line (project, forge, one senior-dev agent); Create → the board", "Open the demo, independent of the preflight"] },
];

export const NEW_PROJECT = [
  { s: "Modal", items: ["Blank or Import a crate", "Blank: Name, Output folder, Repo URL; a “default” agent and an “open” environment are created with the project; Create → the board", "Import a crate: .aos file + passphrase → Decrypt and preview → Create the project"] },
];

export const CHAIN_RUN = [
  { s: "Chain flow", items: ["Chain name, project, N steps, N gates; Original request", "Flow rail: each step with gate, status, agent, cost, expected artifacts; the blocking gate is hatched; each node → the task"] },
];

export const WAITING_PANEL = [
  { s: "What is stopped", items: ["Count across all projects; counts per project, the three oldest, See all", "A row: question or gate, text, “AI-2200 · 2 / 6 · 1 h 52”, Answer / Resume / Approve", "A round → the question; anything else → the task; notices are in the Log"] },
];
