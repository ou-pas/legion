// The agent's WORK, folded. 333 events cannot become 333 messages (operator decision, 25/08): between
// two turns, what the agent DID is counted, not read. The band carries numbers (duration, tools,
// reads, writes) and a sample of lines to check. The full count stays in the task page trace.
import type { SessionEvent } from "../sessions/use-session-events.js";

/** A sample line: the gesture, then on what. Never raw JSON. */
export interface WorkLine {
  verb: string;
  target: string;
}

export interface WorkBand {
  durationMs: number;
  tools: number;
  reads: number;
  writes: number;
  lines: WorkLine[];
  /** What the sample does not show. A silent truncation would read as a total. */
  more: number;
}

/** Enough lines to recognise what happened, not enough to become a trace again. */
const SAMPLE = 6;

const READERS = /^(read|grep|glob|notebookread|ls|webfetch|websearch)$/i;
const WRITERS = /^(write|edit|multiedit|notebookedit)$/i;

/** A work event's gesture. Types carrying nothing readable (tool_end) get no line: they count, they
 *  do not narrate. */
// oxlint-disable-next-line complexity -- lookup table: one event type per case, each returning its verb and target
function line(ev: SessionEvent): WorkLine | null {
  const d = ev.data;
  switch (ev.type) {
    case "tool_start":
      return {
        verb: String(d.tool ?? "tool"),
        target: typeof d.input === "string" ? d.input : "",
      };
    case "fs_op":
      return { verb: String(d.op ?? "fs"), target: String(d.path ?? "") };
    case "repo_ready":
      return { verb: "repo", target: String(d.repo ?? "") };
    case "repo_push":
      return { verb: "push", target: String(d.repo ?? "") };
    case "init":
      return { verb: "init", target: String(d.model ?? "") };
    case "status":
      return { verb: "session", target: String(d.status ?? "") };
    case "activity":
      return { verb: "note", target: String(d.note ?? "") };
    case "steer_delivered":
      return { verb: "delivered", target: String(d.steerId ?? "") };
    case "capabilities": {
      const skills = Array.isArray(d.skills) ? (d.skills as string[]) : [];
      const mcp = Array.isArray(d.mcpServers) ? (d.mcpServers as string[]) : [];
      return { verb: "capabilities", target: [...skills, ...mcp].join(", ") };
    }
    default:
      return null;
  }
}

const at = (ev: SessionEvent): number | undefined =>
  typeof ev.data.ts === "number" ? ev.data.ts : undefined;

/** Folds a run of work events into a band. `transcript.ts` already segmented it: this only counts and
 *  samples. */
export function workBand(events: SessionEvent[]): WorkBand {
  const stamps = events.map(at).filter((t): t is number => t !== undefined);
  const lines: WorkLine[] = [];
  let tools = 0,
    reads = 0,
    writes = 0;
  for (const ev of events) {
    if (ev.type === "tool_start") {
      tools += 1;
      const tool = String(ev.data.tool ?? "");
      if (READERS.test(tool)) reads += 1;
      else if (WRITERS.test(tool)) writes += 1;
    }
    const l = line(ev);
    if (l) lines.push(l);
  }
  const first = stamps[0],
    last = stamps[stamps.length - 1];
  return {
    durationMs: first !== undefined && last !== undefined ? last - first : 0,
    tools,
    reads,
    writes,
    lines: lines.slice(0, SAMPLE),
    more: Math.max(0, lines.length - SAMPLE),
  };
}
