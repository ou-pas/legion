// The text of a task PAGE: what it says when the task no longer exists, its header, its action
// bar, its views and the content of each one (report, brief, PR, artifacts). What the SESSION
// tells — the verdict and the trace — lives next door, in `text/task-run.ts`.
import { defineText } from "../../i18n/catalog.js";
import { type Task } from "../../api/tasks.js";
import { plural } from "../../ui/plural.js";

export const TASK_PAGE_TEXT = defineText({
  notFound: {
    title: "Task not found",
    back: "Back to the dashboard",
    why: "It may have been archived, or the id in the URL no longer exists.",
  },

  header: {
    gate: "Approval gate",
    /** v53 — says what the grant does, not just the name of the setting: this marker is the only
     *  visible trace of "nothing will be pushed" on the page. */
    readOnly: "Read-only — nothing is pushed, no PR",
  },

  actions: {
    label: "Task actions",
    resume: "Resume in the terminal",
    stop: "Stop the session",
    pause: "Pause — the agent finishes its turn, pushes, and waits",
    copyTrace: "Copy the trace",
    /** The trigger of the collapsed menu, under 640px — same icons as the bar, nothing wider to
     *  open: the way out of the task stays the "Project" rank of the rail. */
    more: "More actions",
    delete: "Delete",
    /** The armed label COUNTS the sessions: they are the ones carrying the trace and the cost —
     *  "delete a task" and "delete 4 sessions" are not decided the same way. */
    confirmDelete: (sessions: number) =>
      `Delete the task and ${sessions} ${plural(sessions, "session")}?`,
    confirmDeleteAlone: "Delete the task?",
    announceDelete: (name: string) => `Deleting "${name}": confirm or cancel.`,
    approve: "Approve",
    /** Approval in TWO steps when the task declares an unmet prerequisite. The armed label NAMES
     *  the missing task: "approve anyway" would teach nothing to someone who has forgotten
     *  which one. */
    approveBlocked: (name: string) => `"${name}" is not done — approve?`,
    approveBlockedAnnounce: (name: string) =>
      `This task declares an unmet prerequisite: "${name}". Confirm or cancel.`,
    createPr: "Create the PR",
    run: "Run",
  },

  /** Moving the task by hand. The labels are those of the board columns: the select names the
   *  DESTINATION, not the value of the enum ("todo", "review"). */
  move: {
    targets: {
      later: "Later",
      todo: "Todo",
      review: "Review",
      done: "Done",
    } satisfies Partial<Record<Task["status"], string>>,
    field: "Move the task to",
    placeholder: "move",
    confirm: (target: string) => `Move to ${target}`,
    saving: "Moving",
    refused: "Move refused",
  },

  /** THE VIEWS, as the rail names them (nav/17 slice). They used to be tabs; they are now ten
   *  grouped ranks, and the same word has to name the rank, the view heading and the document
   *  title — hence a single catalog. */
  views: {
    /** The three families the code comments stated without being able to show them: a horizontal
     *  bar cannot name a group, the rail does it already. */
    groups: { flow: "Flow", contract: "Contract", delivery: "Delivery" },
    report: "Report",
    /** "Trace", no longer "Timeline": now that the report is read separately, this view holds
     *  ONLY the raw stream — the name says what you will find there. */
    timeline: "Trace",
    brief: "Brief",
    /** The rank says "Criteria" where the panel says "What this task must prove": a navigation
     *  column does not carry a sentence. */
    criteria: "Criteria",
    artifacts: "Artifacts",
    /** Carries the diff too since 05/09: the rank says "PR", the view shows the draft and then
     *  what it publishes. */
    pr: "PR",
    /** Distinct from "Trace" and the name has to say so: the trace is a log of events, a note is
     *  a sentence the agent wrote. */
    notes: "Notes",
  },

  /** THE RIGHT PANEL (04/09): settings until the task is started, runtime after that. The word
   *  "Settings" stays the one from the project rail; "Runtime & context" names what the session
   *  knows about itself, not what we infer from it. */
  inspector: {
    settingsTitle: "Settings",
    settingsSub: "The task has not started: its settings can be changed here.",
    runtimeTitle: "Runtime & context",
    runtimeSub: "What the session knows about itself.",
    /** The same button opens and collapses; the label says which of the two (operator feedback,
     *  05/09: "no button to get the inspector back" — there was one, it did not say so). */
    open: "Open the panel — settings before the run, runtime after",
    close: "Collapse the panel",
    taskId: "Task",
    sessionId: "Session ID",
    none: "—",
    yes: "yes",
    no: "no",
    containerGone: "destroyed — the session has ended",
    containerAsleep: "destroyed — the session is asleep, no cost",
    /** Settings read back after the run: frozen, but readable — we want to be able to review
     *  them. */
    settingsFrozen:
      "Frozen: the session left with them. They can be changed while nothing has run.",
    groups: {
      machine: "Runner & container",
      model: "Model & cost",
      git: "Git",
      settings: "Settings",
      deps: "Dependencies",
    },
    actions: { timeline: "Open the trace", stop: "Stop the session" },
    keys: {
      runner: "Runner",
      container: "Container",
      agent: "Agent",
      model: "Model",
      cost: "Session cost",
      /** Prefix of a run rank: "Run 1", "Run 2". One run = one `query()` of the SDK, so the
       *  start and then each resume — and each is billed separately. */
      run: "Run",
      turnsShort: "turns",
      taskCost: "Task cost",
      taskWork: "Task work",
      sessionsShort: "sessions",
      turns: "Turns",
      /** The WALL: from start to end, waits included. */
      duration: "Duration",
      /** The WORK: the sum of the runs. The gap with the duration is the waiting. */
      work: "of which work",
      workApi: "of which model",
      end: "End",
      branch: "Branch",
      commit: "Commit",
      complexity: "Complexity",
      priority: "Priority",
      /** v2c (nav) — distinct from `keys.model` (the model the session ACTUALLY ran, "Model &
       *  cost" block): this is the override set in the settings, which can be empty even when a
       *  session has run. */
      modelOverride: "Forced model",
      gate: "Approval gate",
      readOnly: "Read-only",
    },
  },

  /** WHAT A VIEW SAYS WHEN IT HAS NOTHING TO SHOW. That is the price of the rail's static ranks,
   *  and it is MORE READABLE than a rank that evaporates: the view explains, a missing rank
   *  explains nothing — and a menu whose entries stay put beats a menu that moves. */
  empty: {
    reportTitle: "No report yet",
    reportWhy:
      "The last text of a running session is a progress note, not a summary. It appears here when the session ends.",
    interviewTitle: "This task is not an interview",
    interviewWhy:
      'The thread only exists on a task carried by the interviewer. What happened here is read in "Trace".',
    prTitle: "No PR in sight",
    prWhy:
      "Nothing has been pushed to a branch yet, and no draft has been dropped. The diff and the draft will be read here.",
    criteriaTitle: "No criteria written",
    criteriaWhy:
      "This task has no validation contract: that is the case for most tasks posted by hand, and its agent can mark it done itself.",
  },

  /** The notes of the task (`GET /api/tasks/:id/activity`), across all sessions. */
  notes: {
    label: "Task notes",
    hint: "What the agents wrote when changing the status, across all sessions.",
    emptyTitle: "No note",
    from: { agent: "The agent", human: "You", system: "Legion" },
    justNow: "just now",
    minutesAgo: (n: number) => `${n} min ago`,
    hoursAgo: (n: number) => `${n} h ago`,
  },

  report: {
    /** Says where the REST went. The report is the last message, not the log, and the tab next
     *  door no longer recalls it since the rail replaced the bar. */
    hint: 'the agent\'s last message — the full stream stays in "Trace"',
  },

  brief: {
    label: "brief",
    fieldLabel: "Brief",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    write: "Write the brief",
    locked: "sent to the running session — no longer editable",
    notSaved: "Brief not saved",
    /** The empty state says what the agent WOULD get, not that a field is empty. */
    empty:
      "No brief. The agent would only get the task title — write down what it has to know before running it.",
  },

  pr: {
    emptyTitle: "No PR draft",
    emptyBefore:
      "The PR opens on its own as soon as a session has pushed code: its title and its body then come from the task and the repositories pushed. A ",
    emptyAfter: " dropped by the agent would show here, and would win over that fallback.",
    noTitle: "(no title)",
    bodyLabel: "PR draft body",
    noBody: "(no body)",
    recreate: "Recreate / find the PR",
    create: "Confirm and create the PR",
    branchBefore: "Branch ",
    branchAfter: " into the default branch of each repo pushed.",
    /** No branch yet: the sentence promises no opening, it says WHEN the name is fixed. */
    noBranch: "No branch yet: it is named at the first run, and never moves after that.",
    /** v29: "the forge", not "GitHub" — a GitLab project was reading a message that blamed the
     *  wrong service. The per-repo detail arrives in the body of the error, prefixed with the
     *  repo name, and it names its own forge. */
    failed: "The forge refused the creation",
    retry: "Retry",
    intactBefore: "Nothing more was pushed: branch ",
    intactAfter: " is intact.",
  },

  /** The attachments of the brief: operator INPUT. The vocabulary keeps them apart from
   *  artifacts everywhere the two meet — "attached", never "dropped". */
  attachments: {
    label: "Attachments",
    dropLabel: "Attach a file to the brief",
    dropHint:
      "Screenshot, export, mockup — 8 MB per file at most. The agent reads them before starting.",
    remove: (name: string) => `Remove ${name}`,
    /** The refusal NAMES the file and its size: "file too large" helps nobody pick which one to
     *  shrink when five were dropped at once. */
    tooLarge: (names: string) => `Refused: ${names} — 8 MB at most, or empty file.`,
    failed: "Attachment not saved",
    /** A failed upload NAMES its file: when the answer to a question does not go through because
     *  of a screenshot, knowing which one is the only useful piece of information. */
    uploadFailed: (name: string, why: string) => `${name} could not be attached: ${why}`,
    /** Since 07/09, a live session only freezes REMOVAL: it holds the path of the files it
     *  received. Attaching stays possible, and the file is signalled to it. */
    locked:
      "A session is running: what it received can no longer be removed. A file attached now is passed on to it.",
    /** What becomes of the file after a drop DURING a session, per the server's answer. */
    steered: "Passed to the running agent: it will read it on its next turn.",
    queued:
      "Attached. The running session is not listening, the agent will see it in the next session.",
    /** On the Artifacts view, where the two families sit side by side. */
    fromOperator: "Attached by the operator",
    fromAgent: "Dropped by the agent",
  },

  artifacts: {
    expected: "Expected for this step",
    emptyTitle: "No artifact dropped",
    /** Who wrote nothing: the agent the task names, or nobody — the empty state does not read
     *  the same depending on whether a task has someone carrying it. */
    emptyBefore: (hasAgent: boolean) =>
      `${hasAgent ? "The agent has not" : "No agent has"} written anything yet in `,
    emptyAfter: " — artifacts appear here from the first file on.",
  },

  toast: {
    traceCopied: "Trace copied",
    traceCopiedBody: (events: number) => `${events} ${plural(events, "event")} in the clipboard.`,
    copyRefused: "Copy refused",
    copyRefusedWhy: "The browser refused access to the clipboard.",
    deleted: (name: string) => `"${name}" deleted`,
    deletedBody: (sessions: number, events: number, questions: number) =>
      `${sessions} ${plural(sessions, "session")}, ${events} ${plural(events, "event")}, ${questions} ${plural(questions, "question")}.`,
    deleteRefused: "Delete refused",
    resumeCopied: "Resume command copied",
    resumeRefused: "Cannot resume",
    stopRefused: "Stop refused",
    pauseRefused: "Pause refused",
    pauseAsked: "Pause requested",
    pauseAskedBody:
      "The agent will stop at the end of its turn, after pushing its work. An inbox entry will let you start it again.",
    approveRefused: "Approval refused",
    runRefused: "Run refused",
    relaunchRefused: "Rerun refused",
    /** The server answers `queued: true` (202) when capacity is full — same gesture as "Run",
     *  already told by the composer (`use-task-submit.ts`) but never here. */
    runQueued: "Queued",
    runQueuedBody:
      "Capacity is full: the task will start as soon as a machine frees up, with no further gesture.",
  },
});
