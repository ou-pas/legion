// The text of the GOALS domain — the list, the two-step composer, a goal's page, its Definition
// of Done and its guardrails. What stays inside the components (`GOAL_CHIP`, `TASK_CHIP`, the
// most telling field of a log event) is not copy: it is state, routing or formatting.
import { defineText } from "../i18n/catalog.js";
import { plural } from "../ui/plural.js";

export const GOAL_TEXT = defineText({
  /** The mark of a demo goal — the same word in the list and on the page. */
  mock: "mock",

  /** The LIST of a project's goals. */
  list: {
    title: "Goals",
    sub: "The orchestrator chains sessions until the Definition of Done — or until a guardrail.",
    create: "New goal",
    label: "Project goals",
    empty: "No goal on this project",
    // An empty state says WHAT TO DO: the quoted example separates a goal from a task list better
    // than a definition would.
    emptyWhy:
      "A goal describes a result to reach (“no more phantom orders”), not a list of tasks: the orchestrator derives a Definition of Done from it for you to approve, then chains sessions until it is met.",

    /** A row's subtitle frames <Num> elements: it is said in PIECES, otherwise the mono measures
     *  (DoD, iterations, spend) would turn back into flat text. */
    dod: "DoD",
    /** A FUNCTION and not a bare word: the count is a <Num> chip next to it, so the word
     *  agreed with nothing and "1 iterations" was on screen. */
    iterations: (n: number) => plural(n, "iteration"),

    /** The state FILTER. The list mixed all nine statuses in insertion order: a `failed` goal from
     *  last week read like a goal in flight. The default shows what is at stake; the finished ones
     *  stay one click away, never archived (decision D1). */
    filterLabel: "Goal state",
    filterLive: "Live",
    filterDone: "Done",
    filterAll: "All",
    /** The current filter renders nothing, but the project has goals: say so, and say where the
     *  others are — an empty state that looks like "no goal" would suggest a loss. */
    emptyLive: "No live goal",
    emptyLiveWhy:
      "Everything ever run on this project is finished. “All” shows them, newest first.",
    emptyDone: "No finished goal",
    emptyDoneWhy:
      "No goal on this project has gone the distance yet, nor been stopped by a guardrail.",
    showAll: "See all goals",
  },

  /** The COMPOSER: describe the request, then reread the generated DoD before running. */
  composer: {
    title: "Create a goal",
    project: "Project",
    name: "Goal name",
    namePlaceholder: "e.g. Rework the export system",
    request: "Request",
    requestHint:
      "In plain language — the orchestrator derives a Definition of Done from it for you to approve.",
    requestPlaceholder: "Describe the result to reach…",
    budget: "Budget $",
    budgetHint: "Empty = no spending cap.",
    maxHours: "Max duration h",
    maxHoursHint: "Empty = no time limit.",
    generate: "Generate the DoD",
    generating: "Generating the DoD…",
    /** A disabled button with no reason is a dead end: the reason is in the tooltip. */
    readOnly: "The Demo (mock) project is read-only: the orchestrator starts no session there.",
    back: "Back",
    approve: "Approve and run",
    approving: "Starting…",
    dodIntro: "Definition of Done — to approve before anything runs (editable):",
    criterion: (index: number) => `Criterion ${index}`,
    addCriterion: "Add a criterion",
    /** Both of the form's refusals name the problem; the server's message follows. */
    missingFields: "Missing fields",
    noDod: "No DoD",
    /** `POST /api/goals` returns 201 + `warning` when generation fails: the goal EXISTS, with an
     *  empty DoD. Without this banner, the screen showed an empty DoD form for no reason — and it
     *  read as an interface bug rather than a model outage. */
    dodFailed: "DoD not generated",
    generateFailed: (message: string) => `Cannot generate: ${message}`,
    approveFailed: (message: string) => `Cannot approve: ${message}`,
  },

  /** A goal's PAGE: its actions, its plan, its tasks, its log. */
  page: {
    loading: "Loading the goal…",

    // A swallowed pause/resume/KILL failure (`catch(() => {})`) was the worst possible silence:
    // you thought the goal was killed while it was still running (toast audit 24/08). The refusal
    // is readable.
    actionRefused: {
      pause: "Pause refused",
      resume: "Resume refused",
      kill: "Goal stop refused",
      approve: "Approval refused",
    } satisfies Record<"pause" | "resume" | "kill" | "approve", string>,

    pause: "Pause",
    resume: "Resume",
    kill: "Kill switch",
    killConfirm: "Confirm the stop?",
    killAnnounce: (name: string) => `Stopping the goal “${name}”: confirm or cancel.`,

    /** Deletion (D8-D12): a ConfirmAction next to the kill switch, never a modal. */
    delete: "Delete the goal",
    deleteRefused: "Deletion refused",
    /** The dominant case (D12): a `draft` goal that was never approved has nothing to announce. */
    deleteEmpty: "This goal has run nothing: there is only its declaration to delete.",
    deleteSummary: (parts: string[]) => `Deleting this goal will also destroy ${parts.join(", ")}.`,
    deleteConfirm: (parts: string[]) =>
      parts.length > 0 ? `Confirm — ${parts.join(", ")}` : "Confirm — this is permanent",
    deleteAnnounce: (name: string, parts: string[]) =>
      `Permanently delete the goal “${name}”${parts.length > 0 ? ` and ${parts.join(", ")}` : ""}: confirm or cancel.`,
    /** D5: the ONLY exception to D4, a session still pushing its branch. Never a disabled button
     *  plus a `title` (it does not show on a `disabled` element) — the button is absent and the
     *  reason is read next to it, in visible text. */
    deleteBlocked: (live: { taskName: string; status: string }[]) =>
      `Not possible right now: ${live.map((s) => `${s.taskName} — ${s.status}`).join(" · ")}. ` +
      "It is pushing its branch: wait for the commit to finish, or its work is lost.",
    /** D10: what the deletion frees up ELSEWHERE, announced before the click — not suffered
     *  after. */
    unblocksNote: (tasks: { name: string }[]) =>
      `Will unblock ${tasks.length} ${plural(tasks.length, "task")} outside this goal ` +
      `(${plural(tasks.length, "it was", "they were")} waiting on one of its tasks): ` +
      `${tasks.map((t) => t.name).join(", ")}.`,
    deleted: (name: string) => `“${name}” deleted`,
    deletedBody: (parts: string[]) =>
      parts.length > 0 ? `Deleted: ${parts.join(", ")}.` : "There was only its declaration.",

    railsLabel: "Goal guardrails",
    dodTitle: "Definition of Done",
    /** The gauge's name is also its displayed label: the goal is already in the page title, no
     *  need to repeat it under the card's. */
    dodGauge: "Criteria met",

    plan: (steps: number) => `Plan · ${steps} ${plural(steps, "step")}`,
    planLabel: "Planned steps",
    drift: (iterations: number) =>
      `${iterations} ${plural(iterations, "iteration")} — beyond the plan`,
    planNote:
      "Approved together with the DoD — the orchestrator may deviate (it says why in its log).",

    tasks: (count: number) => `Goal tasks · ${count}`,
    tasksLabel: "Tasks created by the orchestrator",
    noTask: "No task run yet",
    noTaskWhy:
      "The orchestrator creates one task per plan step, as it goes: the first will appear here once it has started.",

    log: "Orchestrator log",
    logEmpty: "Log empty",
    logEmptyWhy:
      "The orchestrator records every decision here (agent chosen, criterion met, stop).",
    logLabel: "Orchestrator decisions",

    guardrails: "Guardrails",
    request: "Request",

    /** A `draft` said NOWHERE that it was waiting for an approval: the page showed a DoD, a plan,
     *  rails, and nothing was running. The operator concluded it was broken (03/09). The `gate`
     *  tone is the "this is waiting on a human decision" tone, everywhere in the app. */
    draftPending: "This goal is waiting for your approval",
    draftPendingWhy:
      "Nothing is running: the orchestrator only starts after “Approve and run”. Reread the Definition of Done below, fix it if needed, then approve.",

    /** An empty DoD on a `draft` means generation failed (the server returns 201 + `warning`,
     *  which was displayed nowhere). The way out is named on the spot. */
    dodEmpty: "DoD empty — generation did not go through",
    dodEmptyWhy:
      "The model returned no criteria. Run generation again, or write them by hand: an empty DoD will be refused at approval.",
    regenerate: "Generate the DoD again",
    regenerated: "DoD and plan regenerated",
    regenerateRefused: "Cannot generate",
  },

  /** EDITING a goal — two families of fields, two status rules (server/src/goals/goal-edit.ts).
   *  The brief can only be changed in `draft`; the rails as long as the goal is not finished. The
   *  screen shows only the gestures the server would accept: a button that leads to a 409 is a
   *  trap, not information. */
  edit: {
    brief: "Edit the brief",
    briefTitle: "Edit the goal brief",
    briefWhy:
      "Editable as long as the goal is in “draft”. Changing the request regenerates the Definition of Done and the plan: the current criteria will be replaced.",
    rails: "Edit the guardrails",
    railsTitle: "Edit the goal guardrails",
    railsWhy:
      "Budget, duration and no-progress threshold can move as long as the goal is not finished — the loop rereads them every turn, without rewriting anything past.",
    /** Not "Iterations without progress": that is the name of the GAUGE, which shows the running
     *  count. The field sets the threshold — two identical headings for two different things on
     *  the same page is one more ambiguity, not consistency. */
    noProgress: "No-progress threshold",
    noProgressHint:
      "How many iterations without progress before an automatic stop. A whole number, at least 1.",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    /** The server's refusal is relayed AS IS: it names the status and the frozen field, which no
     *  paraphrase on screen could do as precisely. */
    refused: "Edit refused",
    /** The input is not a number. Said BEFORE sending: `Number("12a")` is NaN, which JSON renders
     *  as `null` — that is, "no cap any more", the opposite of what was being typed. */
    badNumber:
      "Budget and max duration: a number, or empty for “no cap”. No-progress threshold: a whole number of at least 1.",
    saved: (fields: string[]) => `Goal edited — ${fields.join(", ")}`,
    /** The API field → its name in the screen's language: the server returns `changed:
     *  ["maxNoProgress"]`, the operator reads "the no-progress threshold". */
    fieldNames: {
      name: "the name",
      request: "the request",
      allowedAgentIds: "the agent pool",
      budgetUsd: "the budget",
      maxHours: "the max duration",
      maxNoProgress: "the no-progress threshold",
    },
    unchanged: "Nothing to save",
    /** The PATCH was written, but regenerating the DoD failed: the edit holds, the DoD is empty.
     *  A `wait` tone, not `bad` — nothing is lost, there is one gesture left to make. */
    dodWarning: "Request saved, DoD to redo",
  },

  /** The DEFINITION OF DONE: the progress, then each criterion. */
  dod: {
    defaultName: "Definition of Done",
    progress: (done: number, total: number) => `${done} of ${total} criteria met`,
    complete: "DoD met",
    /** The state is carried by an icon: without this double, it does not exist to the ear. The
     *  trailing space glues the state to the criterion read right after — it is part of the
     *  sentence. */
    itemDone: "Met: ",
    itemTodo: "To do: ",
  },

  /** The GUARDRAILS: what will stop the goal if the loop goes off the rails. Every bounded rail
   *  says out loud what the bar shows — a bar cannot be heard. */
  rails: {
    budget: "Budget",
    noBudget: "no cap",
    budgetSpoken: (spent: string, max: string) => `${spent} dollars spent out of ${max}`,
    duration: "Duration",
    noLimit: "no limit",
    durationSpoken: (elapsed: number, max: number) => `${elapsed} minutes elapsed out of ${max}`,
    noProgress: "Iterations without progress",
    noProgressSpoken: (streak: number, max: number) =>
      `${streak} ${plural(streak, "iteration")} without progress out of ${max} before stopping`,
    unbounded: "Guardrails with no cap",
    iterations: "Iterations",
    drift: "beyond the plan",
    plannedSteps: (steps: number) => `${steps} ${plural(steps, "step")} planned`,
  },
});

/** The NAME of the pieces that go with a deleted goal (D9) — never a mute total: "23 tasks" and
 *  "23 sessions" are not decided the same way, and the artifacts folder is the only irrecoverable
 *  item on the list (no backup of `legion.db` restores it), so it is named apart rather than
 *  folded into a count.
 *
 *  Outside `GOAL_TEXT`: `defineText` only takes entries that render a SENTENCE — this one renders
 *  an array, which `GOAL_TEXT.page.delete*` then assembles into a sentence. */
export function goalFootprintParts(f: {
  tasks: number;
  sessions: number;
  goalEvents: number;
  artifactsDir: boolean;
}): string[] {
  const bits: string[] = [];
  if (f.tasks > 0) bits.push(`${f.tasks} ${plural(f.tasks, "task")}`);
  if (f.sessions > 0) bits.push(`${f.sessions} ${plural(f.sessions, "session")}`);
  if (f.goalEvents > 0) bits.push("the log");
  if (f.artifactsDir) bits.push("the artifacts folder");
  return bits;
}
