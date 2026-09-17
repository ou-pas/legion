// The current run, not the whole session.
//
// A session lives several RUNS: each pause destroys the container, each resume starts another, with
// the same `sessions` row and event trace. Two exit verdicts are read from that trace: "the last
// throttle says rejected" (quota-pause) and "an operator_pause event exists" (operator-pause). Read
// over the WHOLE session, they haunt: a quota rejection at 10:51 put every CLEAN exit of the
// following runs back to sleep as out of quota. Seen on 02/09 on Wv8klSI15U1B, 24 resumes in a loop,
// the agent concluding in 7 s and the manager putting it to sleep again. An exit verdict only counts
// if it comes from the run THAT JUST EXITED.
import { type StatusEvent, statusEventsOf } from "./run-scope-store.js";

/** 0 when there is none. */
export function latestRunningAt(events: readonly StatusEvent[]): number {
  let last = 0;
  for (const r of events) {
    // The payload is written by `publish`, always machine JSON: a substring test is enough and
    // avoids parsing the whole trace.
    if (!r.payload.includes('"status":"running"')) continue;
    const t = r.at.getTime();
    if (t > last) last = t;
  }
  return last;
}

/** The runtime cannot report anything before `running`, so every event of the current run comes
 *  after it. Returns 0 when the trace has no `running` yet; readers then fall back to the whole
 *  session, the previous behaviour. */
export function currentRunStartedAt(sessionId: string): number {
  return latestRunningAt(statusEventsOf(sessionId));
}
