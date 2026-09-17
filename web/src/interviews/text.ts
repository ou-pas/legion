// The TEXT catalog of discussion mode. Nothing that comes from the agent is here: the rounds,
// their questions and the spec are DATA — we render them, we do not write them.
import { defineText } from "../i18n/catalog.js";
import { plural } from "../ui/plural.js";

export const INTERVIEW_TEXT = defineText({
  /** The gesture, at both starting points (D2): the composer, and a task already filed. */
  start: {
    label: "Discuss first",
    why: "Put the brief to the test before the work goes out: the interviewer questions you round by round, then files a task whose brief is the spec.",
    /** The interview task carries the title of what is being discussed, prefixed: on the board,
     *  two rows with the same name (the interview and the build) would not be told apart. */
    taskName: (subject: string) => `Interview · ${subject}`,
    /** From an existing task: it is THAT task that becomes the interview, its agent changes. */
    takeOver: "Discuss first",
    takeOverConfirm: "Confirm: the task goes to the interviewer",
    takeOverAnnounce: (name: string) =>
      `“${name}” is handed to the interviewer: it will question you, then file the spec as a child task.`,
    started: "Interview started",
    startedBody: "The first round will arrive in the inbox. Answer it here or in Channels.",
    refused: "Interview not started",
    /** The agent is not installed: say so, and offer the gesture — never a dead button. */
    missing: "No “interviewer” agent on this project.",
    install: "Install the interviewer",
    installed: "Interviewer installed",
    installedBody: "It is ready: run “Discuss first” again.",
    installRefused: "Interviewer not installed",
  },

  tab: {
    // "Channel", no longer "Interview" (nav slice, batch G, 12/09): this tab renders the SAME
    // component, on the SAME segments, as `/p/$projectId/channels/$taskId` — two words for one
    // thread. The 09/09 audit settled it: the same name on both sides.
    label: "Channel",
    /** The counter, with no ceiling (D12). */
    rounds: (n: number) => `${n} ${plural(n, "round")} held`,
    noRound: "No round asked yet",
    threadLabel: "Interview thread",
    empty: "The interview has not started yet.",
  },

  /** D10 — leaving before the agent offers to. A button that is there, never a greyed one. */
  exit: {
    label: "Wrap up the interview",
    /** The answer sent to the open round: this is how an interview ends — the same door as any
     *  other inbox answer, not a session stop. */
    answer:
      "Stop the interview here: do not ask another round. Write spec.md in the artifacts with what " +
      "is already settled, name explicitly what is still open rather than settling it on your own, " +
      "then file the build task whose brief IS that spec.",
    sent: "Wrap-up requested",
    sentBody: "The agent takes over to file the spec and the task.",
  },

  /** Q-E of the spec: tab AND channel is a COMPARISON, not a permanent state. */
  compare: {
    link: "open the channel",
  },
});
