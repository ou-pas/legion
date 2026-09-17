// What a restarted session is told: the four wake-ups, nothing else.
//
// Moved out of `resumeSession` on 10/09 without changing a comma of the three existing texts. They
// lived as a nested ternary in a hundred-line function, and the fourth wake-up (turn budget
// relaunch) would have made it unreadable.
//
// Not plumbing detail. A resume prompt tells the agent what just happened to it, and it has no other
// way to know: its conversation resumes mid-sentence, in a container it has never seen. The wrong
// text sends it looking for an explanation of a difference that does not exist. It happened twice:
// promising a re-clone the wake-up no longer did, and "you were waiting for another task" served to
// a session suspended by an update.
//
// Pure: inputs, a string, no effect, so a test can CALL it.

/** WHY the machine wakes it. Absent = a human answered an inbox question, the original case.
 *  `dependency` is not named: it is the causeless "system" wake-up, the first one, and the default
 *  of every caller that says nothing. */
export type ResumeCause = "dependency" | "update" | "relaunch";

/** The workspace SURVIVES the pause, and the prompt must say so: this sentence promised a re-clone
 *  until D13, and a prompt describing a disk the agent does not have is worse than a silent one.
 *  Measured 26/08: `git fetch` in 0.9 s at wake-up, versus 18.2 s and 640 MB avoided. */
const WORKSPACE_NOTE =
  `Your workspace survived the pause: the repositories are still on disk (with node_modules ` +
  `and any untracked files), and their branches were fetched and fast-forwarded just now, so ` +
  `any merged work is already there. `;

const CONTINUE_EXACTLY = `Continue exactly where you left off and finish (update the task through the Legion tools).`;
const CONTINUE_ACCORDINGLY = `Continue the task accordingly and finish (update the task through the Legion tools).`;

/**
 * @param answer what the answer carried: the human's text, the automatic wake-up's, or the
 *   measurement composed by the container that just died (turn budget relaunch).
 */
export function resumePrompt(opts: {
  answeredBy?: "human" | "system";
  cause?: ResumeCause;
  answer: string;
  /** What the brief carries, said again at wake-up (16/09). The full brief is not resent on resume
   *  (`prompt.mts` serves the answer and nothing else), so its attachments section disappears. A
   *  file attached during the pause reached nobody: the live notice is refused (the container is
   *  destroyed), and the wake-up did not mention it. Only a server `log.warn` remained.
   *
   *  Repeated IN FULL, not only the new ones: we do not know what the agent had read before its
   *  pause, and a full list is a repetition where a partial one is a lie by omission. */
  attachments?: string | null;
}): string {
  const { answer } = opts;
  // A whole paragraph, separated from its surroundings: glued to the neighbouring text it would
  // read as its continuation.
  const joint = opts.attachments ? `${opts.attachments}\n\n` : "";
  if (opts.answeredBy !== "system")
    return (
      `The human answered your inbox question with: "${answer}".\n\n` + joint + CONTINUE_ACCORDINGLY
    );
  // The turn budget is not an interruption (10/09): the previous session hit its ceiling WHILE
  // PROGRESSING, so nobody stopped it, it was moved. The text carrying the measurement was composed
  // by the container that saw it and travels in `answer`; it is not rewritten here with recounted
  // numbers.
  if (opts.cause === "relaunch")
    return (
      `Legion relaunched you: your previous container hit its turn budget while making ` +
      `progress, so it pushed your work, threw the container away and started you again here. ` +
      `Nobody interrupted you, nothing about your task changed, and your turn counter is back ` +
      `to zero.\n\n${answer}\n\n` +
      joint +
      WORKSPACE_NOTE +
      CONTINUE_EXACTLY
    );
  if (opts.cause === "update")
    return (
      `Legion suspended you to update its control plane, and woke you up now that it is done. ` +
      `Nobody asked you to stop and nothing about your task changed. If a tool call failed ` +
      `right before the pause, that was the control plane restarting — retry it. ` +
      joint +
      WORKSPACE_NOTE +
      CONTINUE_EXACTLY
    );
  return (
    `You paused waiting for another Legion task. Legion woke you up automatically — no human ` +
    `answered. Here is what you were waiting for:\n\n${answer}\n\n` +
    joint +
    WORKSPACE_NOTE +
    CONTINUE_ACCORDINGLY
  );
}
