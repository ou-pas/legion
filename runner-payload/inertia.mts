// A session's inertia: what the turn cap should have measured from the start.
//
// turn-budget counts turns, and its pause (then at 175) fell on that count alone: a session was
// stopped for being long. The operator on 10/09, opening the interview that settled it: "a run going
// in circles and a run making progress are two different things". Batch 1 of the navigation rework
// stopped around 140 turns unfinished, not for the first time; more turns would not have produced a
// finished PR, only a bigger one.
//
// What is measured instead, with nothing new, since both signals are already read at turn end:
//
//   · a checkpoint that pushed. repos only commits and pushes if HEAD moved, and only then emits
//     `repo_checkpoint`, so a pushing checkpoint is work that exists outside the container;
//   · a successful tool write. stuck advances `stateVersion` on each successful write to reset its
//     repetition detection; this module reads the same counter.
//
// Either suffices, and that avoids the false positive: a read-only repository never checkpoints
// (repos, `access !== "write"`), so requiring a commit would pause an interview or audit session for
// working.
//
// The code measures, the agent is informed, the agent acts. The verifier is this module, on facts;
// never the agent's opinion of its own progress. An agent going in circles is precisely the one that
// believes it progresses, the false positive that cost the token guardrail (removed 08/09). The agent
// gets the measure and a question (prompt), keeps its three ways out (fix, ask, hand over), but its
// answer triggers nothing mechanically.
//
// The 30-turn threshold is an assumption, stated as such. No data says what the real gap between two
// advances of a healthy session is; `repo_checkpoint` events in the database will calibrate it.

/** How many turns producing nothing make inertia. A checkpoint falls every 15 turns (or 10 minutes):
 *  thirty turns is two whole missed cadences, enough that a long read, a long command or an analysis
 *  never count as running in place. */
export const INERTIA_STALE_TURNS = 30;

/** What the session is at a given turn: `inert` is the only deciding fact, the rest is the measure
 *  used by the inbox question, the text injected to the agent and the trace. */
export type InertiaVerdict = {
  turn: number;
  inert: boolean;
  idleTurns: number;
  sinceTurn: number;
  staleTurns: number;
  writable: boolean;
  commits: number;
  writes: number;
  lastCommitTurn: number | null;
};

/**
 * The inertia watcher, fed and queried at the end of every turn.
 *
 * @param {object} [opts]
 * @param {number} [opts.staleTurns] turns without output beyond which the session is inert
 * @param {boolean} [opts.writable] does the session have at least one writable repository? If not,
 *   it gets no inertia pause (decision D6, 10/09: "for read agents I don't think a safety net is
 *   useful"): thirty turns reading code is normal work, and counting it as inertia would recreate
 *   the false positive just removed. Such a session writes no repository, so cannot break anything;
 *   it still has the stuck detector and the quota, and keeps the relaunch: hitting the wall is still
 *   a death.
 */
export function createInertiaWatch({
  staleTurns = INERTIA_STALE_TURNS,
  writable = true,
}: { staleTurns?: number; writable?: boolean } = {}) {
  const stale =
    Number.isFinite(staleTurns) && staleTurns > 0 ? Math.floor(staleTurns) : INERTIA_STALE_TURNS;
  /** The last turn that produced something. Zero = nothing since the start, true on the first turn
   *  and until something comes out. */
  let lastProgressTurn = 0;
  let lastCommitTurn: number | null = null;
  let commits = 0;
  let writes = 0;
  /** stuck's `stateVersion` already seen: a monotonic count of successful writes whose progression
   *  is the signal. Kept here so the caller reports what it reads and this module decides what it
   *  means. */
  let seenWriteVersion = 0;

  return {
    get staleTurns() {
      return stale;
    },
    get writable() {
      return writable;
    },
    get commits() {
      return commits;
    },
    get writes() {
      return writes;
    },
    get lastProgressTurn() {
      return lastProgressTurn;
    },
    get lastCommitTurn() {
      return lastCommitTurn;
    },

    /** Call at the end of each turn with what it produced: `turn` just finished, `commits` what
     *  this turn's checkpoint pushed, `writeVersion` `stuck.stateVersion` as it is now. */
    record({
      turn,
      commits: pushed = 0,
      writeVersion = 0,
    }: {
      turn: number;
      commits?: number;
      writeVersion?: number;
    }) {
      if (pushed > 0) {
        commits += pushed;
        lastCommitTurn = turn;
        lastProgressTurn = turn;
      }
      if (writeVersion > seenWriteVersion) {
        writes += writeVersion - seenWriteVersion;
        seenWriteVersion = writeVersion;
        lastProgressTurn = turn;
      }
    },

    /** What the session is at the given turn. `inert` is the only deciding fact (inertia pause or
     *  relaunch); the rest is the measure put in the inbox question, the text injected to the agent
     *  and the trace event. A measure without its verdict would make each reader redo the
     *  computation, and get it wrong half the time. */
    verdict(turn: number): InertiaVerdict {
      const idle = turn - lastProgressTurn;
      return {
        turn,
        inert: writable && idle >= stale,
        idleTurns: idle,
        sinceTurn: lastProgressTurn,
        staleTurns: stale,
        writable,
        commits,
        writes,
        lastCommitTurn,
      };
    },
  };
}
