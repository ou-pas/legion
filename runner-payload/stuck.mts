// Detection of running in place, split from the runner to be testable.
//
// Duration is not the signal: an hour-long session that progresses is normal. Identical repetition
// with nothing changed between attempts is. "Nothing changed" is what avoids false positives: an
// agent that runs `pnpm test`, edits, and reruns is working; one that reruns verbatim without
// touching anything is stuck.
//
// Every successful write advances the state and resets the counters: the same call after a change
// is a check, not a loop.

/** Tools that change the world. A repeated `Read` learns nothing new; a successful `Write` does. The
 *  list is deliberately short: missing a state change (one question too many) beats inventing one
 *  (nothing detected any more). */
export const WRITER_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "mcp__legion__fs_write",
  "mcp__legion__fs_mkdir",
  "mcp__legion__fs_delete",
  "mcp__legion__update_task",
]);

/** 4 identical failures without changing anything: nobody is learning. */
export const STUCK_FAILS = 4;
/** 10 identical calls without changing anything, even successful: a loop. */
export const STUCK_TOTAL = 10;

/** What `record` returns when the session runs in circles: the repeated call, its counters, and the
 *  reason a human will read in the inbox question. `null` otherwise. */
export type StuckHit = {
  tool: string;
  input: string;
  fails: number;
  total: number;
  reason: string;
};

/** A tool call as this guardrail counts it: the tool name, its already serialised input (the string
 *  is the repetition key), and its two counters. */
type Repeat = { tool: string; input: string; fails: number; total: number };

export function createStuckWatch({
  fails = STUCK_FAILS,
  total = STUCK_TOTAL,
  writers = WRITER_TOOLS,
}: {
  fails?: number;
  total?: number;
  writers?: Set<string>;
} = {}) {
  let stateVersion = 0;
  /** key `${tool}:${input}@${state version}` → counters */
  const repeats = new Map<string, Repeat>();

  return {
    /** For tests and the trace: how many times the state advanced. */
    get stateVersion() {
      return stateVersion;
    },

    /** Records a tool result. Returns `null` if all is well, otherwise the reason and what to tell
     *  the human. Called once per `tool_result`.
     *
     *  `sub` = the call comes from a subagent (non-null `parent_tool_use_id`, see sdk-events). Its
     *  writes count, they change the world like any other, but its repetitions are not ours: N
     *  subagents fanned out on the same prompt all open with the same call, which is what a fan-out
     *  is. Seen on 08/09 on AI-2200: 13 `Agent` calls with "Read /tmp/translate-rules.md first", the
     *  first ten reads reached STUCK_TOTAL and killed the session seven seconds in. A really stuck
     *  subagent burns its own turn budget and blocks nobody; this guardrail is not the one to catch
     *  it. */
    record({
      tool,
      input,
      ok,
      sub = false,
    }: {
      tool: string;
      input: string;
      ok: boolean;
      sub?: boolean;
    }): StuckHit | null {
      // A successful write means the state moved: every counter is stale.
      if (ok && writers.has(tool)) {
        stateVersion += 1;
        repeats.clear();
        return null;
      }
      if (sub) return null;
      const key = `${tool}:${input}@${stateVersion}`;
      const e = repeats.get(key) ?? { tool, input, fails: 0, total: 0 };
      e.total += 1;
      if (!ok) e.fails += 1;
      repeats.set(key, e);

      if (e.fails < fails && e.total < total) return null;
      // Forget the key, or every following call would ask the same question again in a burst.
      repeats.delete(key);
      return {
        tool: e.tool,
        input: e.input,
        fails: e.fails,
        total: e.total,
        reason:
          e.fails >= fails
            ? `${e.fails} identical failures without changing anything`
            : `${e.total} identical calls without changing anything`,
      };
    },
  };
}
