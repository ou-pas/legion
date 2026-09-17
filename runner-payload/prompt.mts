// prompt: everything the session tells the model, and nothing it does.
//
// Split from `runReal` on 06/09 without a comma changed. Pure texts: inputs, a string, no effect, so
// checkable by a test that calls them, where reading the runner's source was all we could do before.
//
// These are product texts, not plumbing. The turn budget announced upfront, the sentence saying an
// oversized scope is renegotiated rather than endured, the two file systems named one by one: each
// repairs a real session seen failing, and the comment above says which. Changing them changes what
// agents do.

import type { InertiaVerdict } from "./inertia.mjs";
import type { SessionSpec } from "./session-spec.mjs";
import type { TurnBudgetEvent } from "./turn-budget.mjs";

/** The part of the spec the prompt cites, nothing else. `browser` and `resume` are optional here
 *  although the server always sends them: this module only reads them for presence ("does it have
 *  the browser?", "is this a wake-up?"), so a spec without them is legitimate input, the one a test
 *  builds. */
type PromptSpec = Pick<
  SessionSpec,
  "taskName" | "taskDescription" | "repoBranch" | "agentName" | "rolePrompt" | "artifactsPath"
> &
  Partial<Pick<SessionSpec, "browser" | "resume">>;

/** What the prompt cites of a cloned repository. `access` is a string, not the grant union: this
 *  module displays it and decides nothing. */
export type PromptRepo = { name: string; dir: string; access: string; testCommand?: string | null };

/** The task prompt, the first turn. On a wake-up it is the human's answer and nothing else: the
 *  conversation context is already there, and system sections are rebuilt every time.
 *
 * `checkpointEveryTurns` is the cadence, cited to the agent: it makes the "do not push yourself"
 * instruction credible. `inertiaStaleTurns` says after how many turns producing nothing the session
 * is stopped (inertia), cited for the same reason: without the number, "if you are not moving" says
 * nothing checkable.
 */
export function buildTaskPrompt({
  spec,
  repos,
  turnBudget,
  checkpointEveryTurns,
  inertiaStaleTurns,
}: {
  spec: PromptSpec;
  repos: PromptRepo[];
  turnBudget: { pauseAt: number; cap: number };
  checkpointEveryTurns: number;
  /** Optional because a test drops it: the sentence then cites it without a number, as it already
   *  did. The runner always passes it. */
  inertiaStaleTurns?: number;
}) {
  return spec.resume
    ? spec.resume.prompt
    : `# Task: ${spec.taskName}\n\n${spec.taskDescription}\n\n` +
        (repos.length
          ? `Granted repositories (cloned, each on branch ${spec.repoBranch} — work there). Commit your ` +
            `OWN work AS YOU GO: one commit per coherent change, atomic, with a conventional subject ` +
            `that describes THAT COMMIT — not the task name. The commits-conventionnels rule above ` +
            `gives the form; this repo's own recent commit history (\`git log\`) gives the style. ` +
            `Do not push it yourself — pushing stays the server's job (a checkpoint every ` +
            `${checkpointEveryTurns} turns, and again at the end of the session), so nothing you commit ` +
            `is ever lost even though you never pushed it:\n` +
            // Absolute path (30/08). It was `./repos/<name>`, relative to a folder nothing named: fine
            // for `Bash`, which starts in the right place, not for `Read` or `Write`, which want
            // absolute paths. The agent completed it with the only other path it knew, its Legion
            // space. The system prompt's `## Workspace` section says the same and survives the
            // wake-up, where this sentence disappears.
            repos
              .map(
                (r) =>
                  `- ${r.dir} (${r.access})${r.testCommand ? ` — tests: \`${r.testCommand}\`` : ""}`,
              )
              .join("\n") +
            "\n" +
            (repos.some((r) => r.access === "write" && r.testCommand)
              ? `Before writing pr.md, RUN each modified repo's test command from inside that repo and ` +
                `include a short "## Tests" section in the pr.md body with the actual results (pass/fail + summary). ` +
                `If tests fail, fix the code first — never draft a PR over a red suite.\n` +
                // The cadence (10/09): the full suite run four times in seventeen minutes on session
                // `o5yN0TxYJOsY`, the longest 13 min 33.
                `Run that command ONCE, at the end. While you work, run only what covers what you ` +
                `just changed: the test file, the package.\n`
              : "")
          : `Persist deliverables with the legion fs_write tool in your granted folder — text or images. `) +
        `When the work is complete, call update_task (status "done", or "review" with a note).\n\n` +
        // The screenshot answer (slice "the brief carries attachments"). An instruction, not a
        // mechanism: nothing takes a screenshot automatically, on purpose, since only the agent knows
        // which screen state proves its work. Only shown to sessions with the shared browser: asking
        // without it would ask the impossible, which teaches a model that prompt instructions are
        // optional. It lives in the payload next to the paragraph on where to drop an artifact, so it
        // takes effect after `make image-session`, like everything in the session prompt.
        (spec.browser
          ? `## What changes on screen gets shown\n` +
            `You have the shared browser. When your work changes something VISIBLE — a screen, a ` +
            `component, a state that used to look wrong — take a screenshot of the AFTER and save ` +
            `it in your artifacts folder as a .png — fs_write with contentBase64 (the artifacts ` +
            `folder is not on your disk, the fs tools are the way in). One picture in the review ` +
            `is worth a paragraph ` +
            `describing it, and it is the only thing that proves the change to someone who will ` +
            `not run your branch. Name it for what it shows (board-empty-state.png), not for the ` +
            `tool that made it. Nothing takes it for you.\n\n`
          : "") +
        // The budget is stated upfront. An agent unaware of it cannot arbitrate its scope: on 25/08
        // the Channels session started a ten-minute global check three turns from the wall and died
        // on it. The number alone is not enough: we also say what we expect of an oversized scope,
        // because handing over is an engineer's judgement, not an admission of failure (project rule:
        // an agent is not a mere executor).
        `## Turn budget\n` +
        `This CONTAINER has about ${turnBudget.pauseAt} turns left (the SDK hard-stops at ` +
        `${turnBudget.cap}), and that is not a deadline on your task. At ${turnBudget.pauseAt}, ` +
        `Legion looks at what you PRODUCED — a pushed commit, a successful write. If you are ` +
        `moving, it pushes your work, throws this container away and starts you again in a fresh ` +
        `one, same task, same branch, same conversation, turn counter back to zero. Nobody clicks ` +
        `anything. If nothing came out of your last ${inertiaStaleTurns} turns, it stops and asks ` +
        `the operator instead. You will be told where you stand before either happens.\n` +
        `So do NOT rush to fit the count, and do NOT start a long verification you cannot finish ` +
        `just because the number looks close. The one thing worth arbitrating is the SCOPE: if the ` +
        `work left is still undiscovered — the task is not the one the brief describes, it keeps ` +
        `growing — a long run will not repair it. Stop, push, write in your artifact what is done ` +
        `and what remains, and call propose_task with agentName "plan" and blocking: true to hand ` +
        `the re-cut to a planning agent, pointing at this task and your branch. A bad split gets ` +
        `fixed; a run cut in half does not.`;
}

// Where things are (30/08). Measured on a real session: the agent burned four turns looking for its
// repositories. It tried `/agents/<its name>/repos/legion`, gluing its Legion file space path in
// front of its clone's.
//
// The confusion is legitimate, which is why it is repaired here rather than hoped away: a session
// sees two file systems that look nothing alike. The container's, real, where `Bash`, `Read` and
// `Write` operate; and `/agents/…`, served by Legion's MCP tool with its own server-side grants,
// which no shell command will ever reach. Nothing said so anywhere.
//
// Written here, not in a project's context: the path is a runtime fact, true for every session of
// every project, and a per-project copy would be forgotten by the next project created. Repositories
// are named one by one rather than as a pattern: the agent has nothing to guess, and the list is the
// one it really has.
function workspaceSection({
  spec,
  cwd,
  repos,
}: {
  spec: Pick<PromptSpec, "agentName" | "browser" | "artifactsPath">;
  cwd: string;
  repos: PromptRepo[];
}) {
  return [
    "## Workspace",
    "",
    `\`Bash\` starts in \`${cwd}\`. The repositories granted to you are cloned here:`,
    "",
    ...repos.map((r) => `- \`${r.name}\` → \`${r.dir}\``),
    "",
    // Here, not in the task brief: this section survives the wake-up, and the stray clone of 09/09
    // happened after a wake-up (task ZsbmD_N-zS, two commits lost).
    "These repositories, and NO other: never clone a repository missing from this list. A folder in",
    "`repos/` outside a grant is never pushed and is erased at the next wake-up. If you are missing one,",
    "ask for it with the `request_repo` tool: if the human grants it, it is cloned here on resume.",
    "",
    "TWO FILE SYSTEMS COEXIST, and only one of them belongs to this machine.",
    "",
    `On the machine: \`${cwd}\` and everything in it. \`Bash\`, \`Read\`, \`Write\` and \`Edit\``,
    "operate there. **What is written there outside a repository disappears at the end of the session**:",
    "only repositories are pushed.",
    "",
    // The path, not its description (16/09). "this task's artifacts folder" cannot be guessed: the
    // scope is an id, and an agent without it listed `/artifacts` to find it. That folder is granted
    // to nobody, so it was refused, read its grants in the error and moved on: a turn lost per
    // session, measured on twelve sessions and five agents. The `spec` already carries it.
    `In Legion: \`/agents/${spec.agentName}\` and \`${spec.artifactsPath}\`, the artifacts`,
    "folder of this task. These are",
    "NOT folders of the machine. An `ls`, a `cd`, a `Read` or a `Write` on them",
    "will fail, and so will putting them in front of a repository path. They are reached ONLY through",
    "Legion's file tools (`fs_write`, `fs_read`), and that is what makes them outlive the",
    "session — an artifact written with `Write` to an artifacts path is lost.",
  ].join("\n");
}

// No emoji in the report (30/08). The agent's last message is rendered as is in the task page's
// Report tab, and models spontaneously put ✅ at the head of sections. Rule 7 of `docs/DESIGN.md`
// forbids emoji in the interface, and a model sentence displayed in the interface is interface.
//
// The same clause already existed in both concierge prompts, added after a real answer titled its
// sections with pictograms. The fix stopped at the concierge although the defect is the model's, not
// that domain's: sessions kept producing it.
export const STYLE_SECTION = [
  "## Output style",
  "",
  "Never write emoji or pictograms, neither in your text nor in your section headings:",
  "your report is displayed in an interface whose design contract forbids them, and",
  "which only uses drawn icons.",
].join("\n");

// Waiting for a background task (10/09). Measured on a real session: three turns burned, and the
// pattern recurs. The agent starts a subagent, wants to know how it is doing, and writes
// `sleep 90 && tail -120 …/tasks/<id>.output`. The harness refuses a foreground `sleep`; the refusal
// explains what to do, but after the turn is spent. The agent then loads `Monitor` through a
// ToolSearch (second turn), then gives up and uses `TaskOutput` (third).
//
// The missing fact is not "which tool" but "do not wait": a background task reports its end by
// itself. Polling is the defect to remove, not the tool to fix.
export const WAITING_SECTION = [
  "## Waiting for a background task",
  "",
  "A task started in the background NOTIFIES you when it ends. Do not wait for its result:",
  "move on to something else, the notification will wake you up on it.",
  "",
  "NEVER poll its progress — no foreground `sleep`, no loop that rereads its",
  "`.output` file. The harness refuses `sleep`, and the refusal costs you the turn. If you really",
  "must block until the end, it is `TaskOutput` with `block: true`, in a single call.",
].join("\n");

/** The system prompt: the role the server wrote, then what only the container knows (where
 *  repositories are, not writing emoji, and the merged rules). These exist only after the clone,
 *  hence assembled here and not on the server.
 *
 * @param {object} deps
 * @param {object} deps.spec
 * @param {string} deps.cwd
 * @param {object[]} deps.repos
 * @param {string} deps.rulesSection rendered by `capabilities.mts`, empty when there is no rule
 * @returns {string}
 */
export function buildSystemPrompt({
  spec,
  cwd,
  repos,
  rulesSection,
}: {
  spec: PromptSpec;
  cwd: string;
  repos: PromptRepo[];
  rulesSection: string;
}) {
  return [
    spec.rolePrompt,
    workspaceSection({ spec, cwd, repos }),
    STYLE_SECTION,
    WAITING_SECTION,
    rulesSection,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What the two texts below read from an inertia measure, nothing more. `verdict()` returns a
 *  superset (current turn and stale threshold too, which none of these sentences names). Writing the
 *  subset lets the default below exist without inventing a turn or threshold that would mean nothing
 *  when the measure is missing. */
type InertiaMeasure = Omit<InertiaVerdict, "turn" | "staleTurns">;

/** The measure in one sentence: what the code saw come out of the session, shared by both texts
 *  below. Commits and writes read differently when no repository is writable (no inertia possible,
 *  decision D6) than when the session has been pushing for an hour. */
function measureLine(v: InertiaMeasure): string {
  if (v.inert)
    return v.sinceTurn > 0
      ? `no commit pushed and no successful write since turn ${v.sinceTurn}`
      : `no commit pushed and no successful write since the start of this session`;
  const commits = v.writable
    ? `${v.commits} commit(s) pushed${v.lastCommitTurn ? ` (last at turn ${v.lastCommitTurn})` : ""}, `
    : `no repository with write access in this session, `;
  return `${commits}${v.writes} successful write(s)`;
}

/** What the agent is told as it approaches: two texts since 10/09.
 *
 *  The old single text is what stopped batch 1 of the navigation rework around 140 turns: it asked
 *  to choose between finishing and handing over without ever telling the agent what the session had
 *  produced. The pause question itself was never asked; the session had stopped thirty-five turns
 *  before.
 *
 *  Both texts now carry the measure (what the code saw) and the matching question. The operator's
 *  explicit request: "the agent should get an instruction like: no commit and no write since turn 98,
 *  are you moving? are you stuck? is this normal? are the tools broken?". Its answer triggers nothing
 *  mechanically: it already has its three ways out, and the inertia pause stays the net. Project
 *  rule (operator, 25/08): an agent is not a mere executor.
 *
 *  @param {object} hit the turn budget event (`used`, `left`, `pauseAt`, `cap`)
 *  @param {object} verdict the inertia measure (`inertia.mts`, `verdict()`) */
export function turnWarningText(hit: TurnBudgetEvent, verdict?: InertiaMeasure | null): string {
  const v = verdict ?? {
    inert: false,
    writable: true,
    commits: 0,
    writes: 0,
    sinceTurn: 0,
    idleTurns: 0,
    lastCommitTurn: null,
  };
  if (v.inert)
    return (
      `[Legion] Nothing came out of your last ${v.idleTurns} turns: ${measureLine(v)} ` +
      `(you are at turn ${hit.used} of ${hit.pauseAt}).\n\n` +
      `Before carrying on, say it in one line: are you moving — a long read, a long command, ` +
      `an analysis, that is normal — or is something broken: a tool that fails, a command that ` +
      `does not return, a missing access, an instruction you cannot manage to apply?\n\n` +
      `If it is broken, do not work around it silently: fix it, or ask the operator ` +
      `(inbox_ask), or hand over (propose_task, agentName "plan", blocking: true) pointing at ` +
      `this task and your branch. If nothing has come out by turn ${hit.pauseAt} either, ` +
      `Legion will stop and ask the operator.`
    );
  return (
    `[Legion] Turn ${hit.used} of ${hit.pauseAt}: ${measureLine(v)}.\n\n` +
    `If the remaining work is ALREADY known, carry on: Legion will start you again in a fresh ` +
    `session at ${hit.pauseAt} without interrupting you, same task, same branch, same conversation. ` +
    `Do not rush anything to fit the count.\n\n` +
    `If you are still discovering that the task is not the one in the brief, stop and ` +
    `hand over — a long run does not repair a wrong split. Write in your artifact what is ` +
    `done and what remains, then propose the re-cut task (propose_task, agentName ` +
    `"plan", blocking: true) pointing at this task and your branch.`
  );
}

/** What the next session reads on each automatic relaunch. Same measure, same question, written for
 *  a newborn container that does not know it replaced another.
 *
 *  Composed here, in the container holding the measure, and carried to the control plane, which
 *  stores it in the pause's inbox entry (`sessions/turn-relaunch.ts`) and hands it to the woken
 *  session. One place writes what the agent is told about turns; the server does not rebuild a
 *  sentence from numbers it recounted. */
export function relaunchNoticeText(hit: TurnBudgetEvent, verdict?: InertiaMeasure | null): string {
  const v = verdict ?? {
    inert: false,
    writable: true,
    commits: 0,
    writes: 0,
    sinceTurn: 0,
    idleTurns: 0,
    lastCommitTurn: null,
  };
  return (
    `[Legion] Your previous session reached ${hit.used} turns and was moving: ` +
    `${measureLine(v)}. The container was destroyed, your work pushed to the branch, and you ` +
    `are starting again in a fresh container — same task, same branch, same conversation, turn ` +
    `budget back to zero. Nobody interrupted you and nothing about your task changed.\n\n` +
    `Resume exactly where you stopped. If the remaining work is ALREADY known, carry on: ` +
    `Legion will start you again as many times as needed. If you are discovering that the ` +
    `task is not the one in the brief, stop and hand over (propose_task, agentName ` +
    `"plan", blocking: true) — a long run does not repair a wrong split.`
  );
}

/** The net warns before taking (10/09, operator's request).
 *
 *  `checkpointRepos` ran `git add -A && git commit` every fifteen turns without asking. Two damages
 *  measured the same day on task `ks1wcjyVMZ`: the agent ran its own `git commit` in the same second
 *  as the turn-105 checkpoint and got "nothing to commit, working tree clean", the net having taken
 *  its work; and those fifteen files reached GitHub under the generic trailing subject, although the
 *  agent had written the right subject in its report.
 *
 *  A net should catch what falls, not pick what is held. The checkpoint warns first (the agent has
 *  fifteen turns to name its work) and only commits if the tree is still dirty at the next
 *  checkpoint. Nothing is lost: what is already committed keeps being pushed at every checkpoint.
 *
 *  @param {string} repoName the repository concerned
 *  @param {string[]} files paths seen dirty (`git status --porcelain`) */
export function uncommittedNoticeText(repoName: string, files: string[]): string {
  const shown = files.slice(0, 8);
  return (
    `[Legion] ${files.length} uncommitted file(s) in ${repoName}: ` +
    `${shown.join(", ")}${files.length > shown.length ? ", …" : ""}.\n\n` +
    `Commit them yourself NOW, with a conventional subject that describes THIS change — ` +
    `that commit is the one a human will review in the PR. You do not have to push: Legion ` +
    `takes care of it.\n\n` +
    `If the tree is still dirty at the next checkpoint, Legion will commit in your place under a ` +
    `generic name, and that name cannot be changed afterwards.`
  );
}
