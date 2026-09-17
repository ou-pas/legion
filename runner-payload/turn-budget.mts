// A session's turn budget, split from the runner to be testable, like stuck.
//
// The SDK's `options.maxTurns` is a wall: at the cap the session is cut dead with `error_max_turns`,
// and everything not yet pushed dies with the container. It happened on 25/08 on the Channels view,
// under the old cap of 200: 201 turns, $32.08, cut the second the agent was writing its final commit.
// A wall gives no warning, so the agent had started a ten-minute global check with three turns left.
//
// Unlike stuck (running in place), an exhausted turn budget is not an anomaly but a task bigger than
// one run. So we warn before, for the agent to choose, and pause only as a last resort.
//
// The choice is left to the agent (operator's rule, 25/08: "every agent must think like a senior
// dev, they cannot be treated as mere executors"): at the warning it looks at what remains and
// decides. Either it fits and it finishes, or it hands over: push, write what is done and what
// remains, and file a re-slicing task for the planning agent. A bad slicing can be fixed; a run cut
// in the middle cannot.
//
// The three thresholds doubled on 11/09 (130/175/200 → 300/375/400), only once inertia was queried as
// soon as it is true (`session-runner.mts`, at `idleTurns >= INERTIA_STALE_TURNS`, no longer at the
// pause turn). Before that, raising them would have let an inert session run to 375 unnoticed: the
// turn budget was the only trigger of the inertia question. Measured over 113 sessions with a
// `result`: ten went past 130 turns, four past 175, two hit the hard wall (`error_max_turns`, 201
// turns, $32.08 and $9.56), one of them waiting on a background job (`make gates`) through ten-minute
// `TaskOutput(block: true)` calls, each wait costing a turn.

/** The SDK's hard wall (`options.maxTurns`). Nothing here moves it: this module lives below it. */
export const SDK_TURN_CAP = 400;

/** Where the agent is warned. Early enough to finish or to hand over cleanly (push, write the
 *  artifact, file the re-slicing task); both cost a few turns, and a warning at 370 would leave
 *  room for neither. */
export const DEFAULT_TURN_WARN = 300;

/** Where the session is paused without asking. Deliberate margin before the wall: the pause itself
 *  costs turns (inbox question, pushing the work). A net at 400 would be a net after the fall. */
export const DEFAULT_TURN_PAUSE = 375;

/** The event `record()` returns: the warning, then the pause, once each. `null` otherwise. */
export type TurnBudgetEvent = {
  kind: "warn" | "pause";
  used: number;
  warnAt: number;
  pauseAt: number;
  cap: number;
  left: number;
};

/** The counter itself, as `turn-tracker.mts` receives it. */
export type TurnBudgetWatch = ReturnType<typeof createTurnBudgetWatch>;

/** Creates the counter. Thresholds are settable (session spec) but always brought back into a
 *  consistent order: an inconsistent setting must yield a degraded guardrail, never a missing one
 *  (the lesson of the `network-audit` that created the database it audited). */
export function createTurnBudgetWatch({
  warnAt = DEFAULT_TURN_WARN,
  pauseAt = DEFAULT_TURN_PAUSE,
  cap = SDK_TURN_CAP,
}: {
  warnAt?: number;
  pauseAt?: number;
  cap?: number;
} = {}) {
  const hardCap = Number.isFinite(cap) && cap > 1 ? Math.floor(cap) : SDK_TURN_CAP;
  // The pause must come before the wall, the warning before the pause. The caller is not trusted
  // on this: a `pauseAt` of 500 would make the module silent.
  const pause = Math.min(Math.max(Math.floor(pauseAt) || DEFAULT_TURN_PAUSE, 2), hardCap - 1);
  const warn = Math.min(Math.max(Math.floor(warnAt) || DEFAULT_TURN_WARN, 1), pause - 1);

  let used = 0;
  let warned = false;
  let paused = false;

  return {
    get used() {
      return used;
    },
    get warnAt() {
      return warn;
    },
    get pauseAt() {
      return pause;
    },
    get cap() {
      return hardCap;
    },
    /** Turns left before the pause: what the agent is shown, the only deadline it can still act on. */
    get left() {
      return Math.max(0, pause - used);
    },

    /** Call once per finished turn. What a finished turn is is not decided here: turn-tracker knows
     *  (one turn = one `message.id`) and calls this counter. The rule lived in the caller until
     *  03/09 as a `stop_reason != null` the stream path never produces: `used` stayed at 0 on
     *  126-turn sessions, so neither warning nor pause.
     *  Returns `null`, or an event once: `warn`, then later `pause`. */
    record(): TurnBudgetEvent | null {
      used += 1;
      if (!warned && used >= warn) {
        warned = true;
        // Real edge case: very close thresholds, or a `resume` past both. The warning comes first,
        // the agent must be told before being stopped, even on the same turn; the pause follows on
        // the next one.
        return {
          kind: "warn",
          used,
          warnAt: warn,
          pauseAt: pause,
          cap: hardCap,
          left: Math.max(0, pause - used),
        };
      }
      if (!paused && used >= pause) {
        paused = true;
        return { kind: "pause", used, warnAt: warn, pauseAt: pause, cap: hardCap, left: 0 };
      }
      return null;
    },
  };
}
