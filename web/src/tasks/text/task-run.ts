// What the SESSION tells on a task page: the VERDICT (what happened, what is left to decide) and
// the FRAME of the trace (its empty state, its cut, its accessible name). What the page says
// about itself — header, actions, views — lives next door (`text/task-page.ts`).
//
// What the trace says EVENT BY EVENT is not here and does not belong here: `summary()` and
// `plain()` render the runner's own vocabulary (`session running`, `fs refused`, `push`, the
// clipboard template) — a log format, not screen copy. Same call as `SESSION_TEXT.toolCall`:
// only the connective text comes out, the log stays where it is written.
import { defineText } from "../../i18n/catalog.js";

export const TASK_RUN_TEXT = defineText({
  /** The SSE stream, distinct from the session: a trace that stops moving because the stream
   *  dropped looks exactly like a session doing nothing. That silence is what we name here. */
  stream: {
    interrupted: "Stream interrupted",
    interruptedRetry: "Stream interrupted — reconnecting",
    reconnect: "Reconnect",
    retryWhy:
      "The session keeps running on the server; the trace will resume where it stopped, with no gap.",
    closedWhy:
      "The browser gave up reconnecting. The session is still running — nothing is lost, the trace will resume at the next event.",
  },

  /** Two very different empty states: the stream is open but silent, or no session ever ran. The
   *  second says what to do, the first says what to expect. */
  trace: {
    empty: "Waiting for events",
    emptyWhy: "The runner opened the stream: the first line appears as soon as the agent speaks.",
    neverRun: "No session for this task",
    neverRunWhy: "Run the task so an agent picks it up — its trace is written here live.",
    scrollLabel: "Session trace",
    liveNoun: "event",
    label: (taskName: string) => `Session trace for "${taskName}"`,
  },

  verdict: {
    since: "since",
    /** How many times the session picked itself back up. Silent at zero: a session that never
     *  resumed has nothing to say here. */
    resumes: "resume(s)",

    /** `wait_for_task`: the session sleeps on a dependency and will wake up BY ITSELF — saying
     *  "waiting for you" as for a real question would be a lie. */
    waitDependency: "The session is asleep waiting on a dependency",
    /** The sentence is cut around the link to the awaited task: it names it, it does not glue a
     *  title into a string. */
    waitsFor: "it is waiting for",
    waitsForWhy:
      "it resumes ON ITS OWN as soon as that task reaches done; container destroyed, nothing costs while it waits",
    /** Out of quota (v28): the wake-up is scheduled, nobody has anything to do. */
    outOfQuota: "Out of quota — the session sleeps until the reset",
    outOfQuotaWhy:
      "the subscription window is exhausted — work pushed, conversation kept, container destroyed: nothing costs while it waits, and it wakes up at the reset",
    wakesAlone: "resumes on its own",
    /** The inertia pause (10/09) reads like the quota pause, and its cause is not the same: the
     *  session ran out of TURNS, and the subscription window has nothing to do with it. */
    turnBudget: "Turn budget spent — it resumes on its own",
    turnBudgetWhy:
      "it went to the end of its turn budget; container destroyed, it resumes on its own at the next tick — same task, same branch, same conversation",
    waitingAnswer: "The agent is waiting for your answer",

    /** What the session is doing RIGHT NOW: the word before the tool call, and the tool name
     *  when the event carries none. */
    doing: "running",
    someTool: "tool",
    /** The steering field does not exist in these two states, and the reason is written out —
     *  a disabled control with a native `title` says nothing in Chrome or Safari. */
    startingWhy: "you can talk to it once it is running — its runtime is not listening yet",
    committingWhy: "it is pushing its work to the branch: it no longer listens",

    /** The joint between the repo chip and the file count: it carries its own spaces, it is a
     *  piece of a line, not a sentence of its own. */
    pushed: " pushed · ",
    draftWaiting: "a PR draft is waiting for your decision",
    openDraft: "Open the draft",
    closed: (reason: string) => `session closed: ${reason}`,

    failed: "Stopped before the end",
    errorNoMessage: "error with no message",
    relaunch: "Run the task again",

    /** v66 — PICK THE MACHINE, next to "Run the task again": the gesture is where the operator
     *  is when they need it — they have just watched the session fall over. "Any free machine"
     *  is not an empty value, it is the behavior it has always had, and it is spelled out. */
    runner: {
      label: "Machine for this task",
      any: "any free machine",
      /** A runner removed from the fleet leaves an id pointing at nothing: the select then has
       *  no option to tick, and THIS text is shown in its place. */
      gone: "machine deleted — pick another one",
      asleep: "not responding",
      off: "disabled",
      warn: (name: string) =>
        `"${name}" is not responding: the task will be refused while the machine sleeps. Wake it up, or pick another one.`,
      warnOff: (name: string) => `"${name}" is disabled: enable it again, or pick another one.`,
      refused: "Machine not changed",
    },
    seeArtifacts: "See the artifacts",
    stillIn: (status: string) =>
      `the task stays in "${status}" — whatever was dropped in the artifacts is kept`,

    succeeded: "Finished successfully",
    ended: "Session ended",
  },
});
