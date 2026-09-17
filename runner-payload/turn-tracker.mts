// What counts a turn. One place, because two guardrails depend on it: the work checkpoint and the
// turn budget (a token budget also did until 08/09). It is the only one of these modules that knows
// what an SDK message looks like.
//
// The incident (03/09): the guardrails had been silently inactive since they were written. Measured on
// real sessions that day: 105, 126, 82 and 75 turns reported by the SDK (`result.num_turns`), and
// zero `repo_checkpoint` events on any session. No `run_warning` either, so not a failing checkpoint
// but one never called. Same root for the budgets: the token total and `turnBudget.used` stayed at 0
// (no warning at 130, no pause at 175). The SDK's hard wall at 200 turns was again the only net,
// exactly what turn-budget was written to avoid. Cost that same day: a session killed by an OOM
// after 220 tool calls and 49 file writes, nothing pushed, 33 minutes of work lost.
//
// The cause: the runner tested `msg.message.stop_reason != null` to recognise a turn's end. The
// installed SDK (@anthropic-ai/claude-agent-sdk 0.3.234) says otherwise in `SDKAssistantMessage`:
//
//   "While a response streams the CLI emits one assistant message per completed content block,
//    so several consecutive assistant messages can share message.id and each carries just that
//    block in message.content; ON THOSE, message.stop_reason IS NULL and message.usage is not
//    final — the turn's stop reason and total usage arrive on the result message."
//
// The field did not move: its value is null on the stream path we use. A condition that is never
// true breaks nothing visible, it switches things off.
//
// What is counted instead: one turn = one `message.id`, the invariant the SDK guarantees in both
// known forms, depending on no optional value:
//
//   (a) streamed     — several consecutive assistant messages share a `message.id`, one block each,
//                      all with a null `stop_reason`. The turn ends when another id appears (or the
//                      `result` message arrives).
//   (b) consolidated — the same messages, but `stop_reason` and final usage already set on each piece
//                      (the form read in on-disk transcripts). Counting pieces would give three turns
//                      for one; the id groups them.
//
// Counting ids is right in both cases, where counting `stop_reason` was wrong in both (zero in the
// first, triple in the second).
//
// Two explicit exclusions: subagent messages (non-null `parent_tool_use_id`), which are not turns of
// the main loop `maxTurns` caps, and anything neither `assistant` nor `result`.
//
// This module also holds the checkpoint cadence because the defect fixed here was a counter duplicated
// implicitly. The runner counts nothing: it feeds this module and executes what it returns, so one
// guardrail can no longer go silent without the other.

import type { TurnBudgetEvent, TurnBudgetWatch } from "./turn-budget.mjs";

/** How many turns between checkpoints of the work. Often enough that a brutal death never costs more
 *  than a handful of turns, rarely enough that the cost (a few seconds of git) stays invisible. */
export const CHECKPOINT_EVERY_TURNS = 15;

/** And every how many minutes, whatever the turn count.
 *
 *  The question (03/09): a turn count is a poor proxy for secured work, since one turn can start a
 *  ten-minute command. The session lost that day ended on a `make ds-smoke`, a single very long turn.
 *  Should there be an elapsed-time checkpoint?
 *
 *  Yes, and it is here, but evaluated at the end of a turn like the other, never by a timer. A session
 *  that writes a lot then runs three ten-minute commands no longer spends half an hour with its work
 *  in one container waiting for turn 15. What it deliberately does not do is trigger a checkpoint
 *  during a turn.
 *
 *  A checkpoint is `git add -A && commit && push` in the working tree the agent is using. Fired by a
 *  timer it lands at an arbitrary moment: during a file write, a build writing into the tree, or the
 *  agent running git itself. The risk is not a failed checkpoint (it never throws, it warns) but a
 *  half-written tree pushed to the branch, and that branch is the deliverable. The gain would be
 *  thin: during a ten-minute command the agent writes nothing new, and what is at risk meanwhile is
 *  the previous turns' work, which the end-of-turn bound just secured. */
export const CHECKPOINT_EVERY_MS = 10 * 60_000;

/** A stream message reduced to what this module reads: type, turn id, usage and `stop_reason`. Not
 *  the SDK's type, on purpose: turn-end recognition must stay testable on hand-made pieces, which is
 *  exactly what the stream path produces (turn-tracker.test.ts). */
type TrackedMessage = {
  type?: unknown;
  parent_tool_use_id?: string | null;
  /** The body takes two forms in the stream, and `observe` receives every message: an object on
   *  model turns (hence the three fields read here, plus `content`, never read but named so a user
   *  message body stays acceptable) and a plain string on a permission refusal. */
  message?:
    | { id?: string | null; usage?: unknown; stop_reason?: unknown; content?: unknown }
    | string;
};

/** The checkpoint due on a turn: why it is due, and since when. */
export type DueCheckpoint = {
  reason: "turns" | "elapsed";
  turn: number;
  sinceTurns: number;
  sinceMs: number;
};

/** A turn that just closed, and everything it triggers. */
export type EndedTurn = {
  used: number;
  usage: unknown;
  turn: TurnBudgetEvent | null;
  checkpoint: DueCheckpoint | null;
};

/** Assembles the guardrails behind one end-of-turn signal.
 *
 *  `turnBudget` is injected (the runner creates it: its thresholds come from the spec and enter the
 *  prompt). `now` is injectable for tests.
 *
 *  A second budget lived here, for tokens, removed on 08/09 with its `getProgressVersion` relay to
 *  `stuck.stateVersion`. What that relay served (resetting a counter when the session progresses)
 *  stays whole in stuck, for what it does best: recognising identical repetition. */
export function createTurnTracker({
  turnBudget,
  everyTurns = CHECKPOINT_EVERY_TURNS,
  everyMs = CHECKPOINT_EVERY_MS,
  now = Date.now,
}: {
  turnBudget?: TurnBudgetWatch;
  everyTurns?: number;
  everyMs?: number;
  now?: () => number;
} = {}) {
  let open = false; // is a turn in progress? (a missing id is still a turn, hence the boolean)
  let openId: string | null = null; // `message.id` of the turn in progress
  let openUsage: unknown = null; // last `usage` seen for this turn, the most complete of the pieces
  let closedId: string | null = null; // last id already counted: its late pieces do not count again
  let lastCheckpointTurn = 0;
  let lastCheckpointAt = now();

  /** The checkpoint due on this turn, or null. Marks it done in the same move: `checkpointRepos`
   *  never throws, so "due" and "done" do not separate, and two calls would be a chance to forget
   *  one. */
  function claimCheckpoint(used: number): DueCheckpoint | null {
    const sinceTurns = used - lastCheckpointTurn;
    const sinceMs = now() - lastCheckpointAt;
    const reason =
      everyTurns > 0 && sinceTurns >= everyTurns
        ? "turns"
        : everyMs > 0 && sinceMs >= everyMs
          ? "elapsed"
          : null;
    if (!reason) return null;
    lastCheckpointTurn = used;
    lastCheckpointAt = now();
    return { reason, turn: used, sinceTurns, sinceMs };
  }

  /** Closes the open turn and returns everything it triggers: the turn budget first, the checkpoint
   *  computed right after. The caller executes the checkpoint before deciding anything, so a brutal
   *  stop during an inbox question costs nothing. */
  function closeTurn() {
    if (!open) return null;
    const usage = openUsage;
    closedId = openId;
    open = false;
    openId = null;
    openUsage = null;
    const turn = turnBudget ? turnBudget.record() : null;
    const used = turnBudget ? turnBudget.used : 0;
    return { used, usage, turn, checkpoint: claimCheckpoint(used) };
  }

  return {
    /** For the trace and tests: the id of the turn in progress, null if none. */
    get openTurnId() {
      return openId;
    },

    /** Feeds one SDK message. Returns the turns that just ended: usually none, one at each turn end,
     *  and two in the only case where a message closes the previous turn (different id) and its own
     *  (`stop_reason` set). */
    observe(msg: TrackedMessage | null | undefined): EndedTurn[] {
      if (!msg) return [];

      if (msg.type === "result") {
        // `result` closes the current turn: it is a turn's last message, and on a single-prompt
        // session it closes the session's last turn, which would otherwise never be counted.
        const ended = closeTurn();
        return ended ? [ended] : [];
      }

      if (msg.type !== "assistant") return [];
      // A subagent (Task tool) produces its own assistant messages with their own ids. Counting them
      // would advance the main loop's budget at someone else's pace and close/reopen the main turn
      // on every round trip.
      if (msg.parent_tool_use_id != null) return [];

      // A model turn's body is an object. A string (permission refusal) is not, and the
      // `type !== "assistant"` above already excluded it; this test tells the compiler, nothing more.
      const body = typeof msg.message === "object" ? msg.message : null;
      const id = body?.id ?? null;
      // Late piece of a turn already counted (consolidated form: every block carries the same id and
      // `stop_reason`). It opens nothing and counts nothing.
      if (id !== null && id === closedId) return [];

      const ended: EndedTurn[] = [];
      if (open && id !== null && id !== openId) {
        // Another id starts: the previous turn is over. This detection replaces
        // `stop_reason != null`, and is the only one that works on the stream path.
        const e = closeTurn();
        if (e) ended.push(e);
      }
      if (!open) {
        open = true;
        openId = id;
        openUsage = null;
      }
      // Intermediate pieces' usage is provisional; the last one seen is the most complete.
      if (body?.usage) openUsage = body.usage;
      if (body?.stop_reason != null) {
        // Consolidated form, or a streamed turn's last piece: the end is explicit, take it. Waiting
        // for the next id would delay the guardrail by a whole turn.
        const e = closeTurn();
        if (e) ended.push(e);
      }
      return ended;
    },
  };
}
