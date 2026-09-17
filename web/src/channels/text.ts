// The TEXT catalog of the channels domain — the "a task read as a conversation" view.
//
// Nothing that comes from an agent is here: the brief, the agent's words, a question's body and a
// form's labels are DATA. We render them, we do not write them.
import { defineText } from "../i18n/catalog.js";
import type { ChannelState } from "./channel.js";
import type { NoticeCode } from "./transcript.js";
import { plural } from "../ui/plural.js";

export const CHANNELS_TEXT = defineText({
  // "Channel", no longer "Channels" (nav slice, batch G, 12/09): the task rail called the same
  // thread "Interview" (`interviews/text.ts`) — two words for one thread. The 09/09 audit settled
  // it: the same name on both sides. `page.title` stays "Channels": that one names the LIST.
  nav: "Channel",
  page: {
    title: "Channels",
    /** Spoken out loud in the submenu: a SECOND reading, not a replacement. */
    sub: "The project's live conversations — the board stays the view of state",
  },

  list: {
    label: "Live channels",
    sections: {
      waiting: "Waiting for you",
      running: "Running",
      idle: "On hold",
    } satisfies Record<ChannelState, string>,
    /** The mark of a channel that is waiting: a question to answer, or an approval to give. */
    gate: "gate",
    /** The subheading of a group of channels asking the SAME question (04/09) — "4 alike" above
     *  the four rows, in the "Waiting for you" section. */
    group: (n: number) => `${n} alike`,
    empty: {
      title: "No live channel",
      body: "A channel is born when a task starts working. Run a task from the board: its conversation will appear here.",
    },
    /** THE RIGHT PANE WITH NO CHANNEL (15/09). It repeated the list's empty state word for word,
     *  a foot away from it, then left a thousand pixels of nothing below. It now shows the SHAPE
     *  of a channel, and this sentence says that it is a drawing — without it, mute hollows would
     *  look like a load that never arrives. */
    preview: {
      caption:
        "This is the shape of a channel: what the agent says, what you answer, and its state.",
    },
    closed: (n: number) => `${n} ${plural(n, "channel")} closed today.`,
    closedWhy:
      "A finished task is no longer a conversation: it becomes a card again. The thread stays readable from its page.",
    closedLink: "see on the board",
    later: (n: number) => `${n} ${plural(n, "task")} in “Later”`,
    laterWhy: " — on the board, not here: nothing is talking there yet.",
  },

  head: {
    /** The channel's state, at the top of the conversation. */
    state: {
      waiting: "waiting for you",
      running: "running",
      idle: "on hold",
    } satisfies Record<ChannelState, string>,
    openTask: "Open the task page",
  },

  /** THE BREAK BETWEEN TWO SESSIONS. The thread has spanned the whole task since 26/08: a retry
   *  after a failure lands in the middle of the conversation, and without a mark it would read as
   *  the continuation of the same one. */
  sessionMark: {
    nth: (n: number) => `session ${n}`,
    /** The end cause as the server wrote it — never rephrased here. */
    endReason: (reason: string) => reason,
  },

  /** THE ACTION BAND: what is waiting for a decision, pinned above the thread and unmoving. Its
   *  label is a page landmark's (`aria-label`) — it is not written on screen, the band's contents
   *  introduce themselves. */
  action: {
    label: "Waiting for your decision",
  },

  /** THE COMPOSER, once it is no longer talking to a live session (03/09). Both texts state the
   *  EFFECT, because it is not the same one: steering slips a word to a runtime that is running,
   *  a message restarts the task so it gets read. Not saying so would suggest you are whispering
   *  to a sleeping agent, when in fact you are reopening its work. */
  composer: {
    messagePlaceholder: "A message to this task — it will restart the agent",
    /** WHEN A QUESTION IS OPEN (04/09), the composer stops being the main gesture: it looked like
     *  the answer field without being one. The placeholder has carried the negation on its own
     *  since 15/09 (D3) — the hint that repeated it was cut off at 375px, and truncating it would
     *  have reopened the confusion the 04/09 batch had closed. */
    asidePlaceholder: "A message on the side, not the answer",
  },

  stream: {
    label: "Channel conversation",
    /** What the "there is something new below" pill counts once you have scrolled back up. */
    noun: "message",
    /** The brief: the channel's first message, pinned. */
    brief: "brief · pinned",
    briefEmpty: "No brief — the agent received only the task title.",
    briefMore: (n: number) => `unfold the brief's ${n} lines`,
    empty: {
      title: "Nothing is waiting for you in this channel",
    },
    /** The SSE stream dropped while the session is still working. */
    interrupted: "The thread is cut",
    interruptedWhy:
      "The browser is no longer receiving anything from this session. Whatever happened during the break will be replayed on reconnect.",
    reconnect: "Reconnect",
  },

  /** THE DECISION, in the thread (26/08). Two moments, two texts: the gate announced while the
   *  work is going on, and the wait itself once the work has been filed. */
  decision: {
    later: "Approval gate",
    laterWhy:
      "Once the work is filed, it will wait here for you to approve it. Nothing moves to done without you.",
    now: "This work is waiting for your approval",
    nowWhy:
      "The session filed its work and stopped there. Nothing moves to done without you: approve here, or open the task page to read the diff first.",
    approve: "Approve",
    /** The OTHER way to land in review: the session died. The work was not filed, it was cut
     *  short — and the task is parked there for want of a better place. */
    failed: "The session failed",
    failedWhy: (reason: string) =>
      (reason ? `${reason}. ` : "") +
      "The task is in review because a dead session parks there, not because any work was filed. " +
      "Whatever was pushed to the branch before the stop, if anything, is still there.",
    retry: "Run the task again",
    /** Closing it despite the failure stays possible — the operator decides — but it does not
     *  present itself as approving delivered work. */
    approveAnyway: "Move to done anyway",
    retryRefused: "Run again refused",
    /** Opening a PR publishes work: the link leads to the draft, it does not publish it. */
    prDraft: "See the PR draft",
    refused: "Approval refused",
  },

  work: {
    /** "worked for 4 min — 61 tools, 18 reads, 2 writes". */
    worked: (duration: string) => `worked for ${duration}`,
    counts: (tools: number, reads: number, writes: number) =>
      `${tools} ${plural(tools, "tool")}, ${reads} ${plural(reads, "read")}, ${writes} ${plural(writes, "write")}`,
    more: (n: number) => `… ${n} more`,
    label: "Breakdown of the agent's work",
  },

  round: {
    pending: "waiting for your answer",
    /** The open question has been lifted into the band: the thread keeps only its trace, in its
     *  chronological place, and says where it went. */
    promoted: "asked a question — see the band above",
    answered: (n: number, time: string) => `${n} ${plural(n, "answer")} — answered at ${time}`,
    /** A free-text answer has no fields: we show the sentence as it is. */
    freeAnswer: "free answer",
    title: "Round",
    /** A ticked box is an answer: it reads back as a word, not as `true`. */
    yes: "yes",
    no: "no",
    note: "comment",

    /** WHAT WAS AROUND the question, reread after the fact. A decision reads back through what it
     *  ruled out: the choices not taken stay on display. */
    archive: {
      choices: "what was offered",
      receipt: "decision receipt",
      evidence: "what the agent had read",
      impact: "what it affected",
      /** A post-failure diagnostic question is not an ordinary call: answering it ran the task
       *  again. Saying so keeps it from being reread as a plain question. */
      diagnostic: "diagnostic question — answering it ran the task again",
    },
  },

  /** A dated fact that is nobody's words. The table is exhaustive by construction: a new code
   *  cannot arrive without its wording (`satisfies`). */
  notice: {
    run_error: (detail: string) => `Session interrupted — ${detail}`,
    run_warning: (detail: string) => `Warning — ${detail}`,
    repo_push_failed: (detail: string) => `Push refused — ${detail}`,
    fs_denied: (detail: string) => `Write refused — ${detail}`,
    throttle: (detail: string) => `Quota — ${detail}`,
    result_ok: () => "Session finished successfully",
    result_end: (detail: string) => `Session finished — ${detail}`,
    task_status: (detail: string) => `Task moved to ${detail}`,
    repo_push: (detail: string) => `Pushed — ${detail}`,
    dependency_wait: (detail: string) =>
      detail ? `Waiting for “${detail}”` : "Waiting for another task",
    dependency_resolved: (detail: string) =>
      detail === "deleted"
        ? "Wait lifted — the awaited task was deleted"
        : "Wait lifted — the awaited task is done",
  } satisfies Record<NoticeCode, (detail: string) => string>,

  state: {
    label: "Task state",
    cards: { state: "State", deliverables: "Artifacts", lineage: "Lineage", rights: "Grants" },
    keys: {
      status: "status",
      agent: "agent",
      model: "model",
      cost: "cost",
      rounds: "rounds",
      branch: "branch",
      repos: "repos",
      network: "network",
      secrets: "secrets",
    },
    noAgent: "none",
    noModel: "none",
    noCost: "not measured yet",
    noBranch: "named on the first run",
    repoAccess: { none: "none", read: "read", write: "write" } satisfies Record<
      "none" | "read" | "write",
      string
    >,
    networkOpen: "open",
    networkLimited: (n: number) => `limited · ${n} ${plural(n, "host")}`,
    networkNone: "no environment",
    noSecrets: "none",
    /** Left half dropped (D5, 15/09): it restated the column title "Artifacts". What is left says
     *  WHEN the contents will appear — a fact that title does not carry. */
    noArtifacts: "Artifacts will appear here from the first file on.",
    diff: "Diff and PR draft",
    diffWhy: "on the task page",
    /** Same partial cut as `noArtifacts`: "No lineage" restated the column title "Lineage". The
     *  cause stays, no neighbour carries it. */
    noLineage: "This task has no parent and has filed no task.",
    /** Both verbs have been SUBHEADINGS since 13/09: they head their group instead of opening
     *  every row, where they repeated once per repository. */
    parent: "comes from",
    child: "filed",
    lineageMore: (n: number) => `${n} more`,
  },
});
