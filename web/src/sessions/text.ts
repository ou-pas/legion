// The text CATALOG of the sessions domain — every string the screen shows about a session lives
// here, and nowhere else: the state vocabulary, the queue row, the Analytics table, the field
// that talks to the agent. `session-status.ts` keeps what is not text: the DRAWING state of a
// chip and the list of live statuses.
import { defineText } from "../i18n/catalog.js";
import { type Session } from "../api/sessions.js";
import { SESSION_STATUS } from "../api/sessions.js";
import { plural } from "../ui/plural.js";

export const SESSION_TEXT = defineText({
  // "destroyed" is the NORMAL end of an ephemeral session (container cleaned up) — we show it as
  // a completion, not as a problem.
  // "waiting for your answer" and "waiting for your decision": two labels, because they are two
  // gestures. Answering a question can be delegated; granting an approval cannot — that is the
  // very meaning of `blocked` (nav/11 slice).
  status: {
    starting: "starting",
    running: "running",
    [SESSION_STATUS.waiting]: "waiting for your answer",
    blocked: "waiting for your decision",
    committing: "committing",
    destroyed: "ended",
    failed: "failed",
  } satisfies Record<Session["status"], string>,

  /** A session in the dashboard queue: the task as the title, who carries it and since when on
   *  the sub-line. The agent name and the age are composed HERE, not at the call site. */
  row: {
    unknownTask: "Unknown task",
    unknownAgent: "unknown agent",
    startedAgo: (age: string) => `started ${age} ago`,
    endedIn: (age: string) => `ended in ${age}`,
    sub: (agentName: string, when: string) => `${agentName} · ${when}`,
  },

  /** Analytics — cost / duration / failure rate per agent × model pair. The table headings
   *  repeat words from the total tiles ("Sessions", "Failures"): they are two distinct labels, a
   *  column heading can be shortened without touching the tile. */
  analytics: {
    title: "Statistics",
    totals: "Total across measured sessions",
    runs: "Sessions",
    failed: "Failures",
    cost: "Total cost",
    pairs: (count: number) => `${count} ${plural(count, "agent × model pair")}`,
    failedShare: (percent: number) => `${percent}% of sessions`,
    noSession: "no session",
    loading: "Loading measurements by agent and model…",
    tableLabel: "Cost, duration and failure rate by agent and model",
    columns: {
      agent: "Agent",
      model: "Model",
      runs: "Sessions",
      failed: "Failures",
      failRate: "Failure rate",
      duration: "Avg. duration",
      cost: "Cost",
    },
    empty: "No session measured yet — run a task, costs and durations will appear here.",
    reading:
      "An agent with a 0% failure rate on a big model is a candidate for a smaller one; a high failure rate on a small model, for a bigger one.",
  },

  /** The field that talks to an agent WHILE it works. */
  steer: {
    toAgent: (agentName: string) => `to ${agentName}`,
    anyAgent: "to the agent",
    label: (who: string) => `Say something ${who} while it works`,
    placeholder: "say something to it…",
    send: "Send",
    sent: (who: string, message: string) => `sent ${who} — "${message}"`,
    /** Rendered INSTEAD of the tool call when there is none, so that the line always exists
     *  while the session runs — see TaskPage: without it, the steering field moves up and down
     *  by 17px each time a tool starts and ends. */
    thinking: "it is thinking — no tool running",
  },

  /** A tool call summed up on one line. The rest (tool names, payload keys) is technical and
   *  stays in `tool-call.tsx`: only this connective text is copy. */
  toolCall: {
    patternIn: (pattern: string, where: string) => `${pattern} · in ${where}`,
  },
});
