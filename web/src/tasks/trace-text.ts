// A session trace as PLAIN TEXT, what goes to the clipboard. The pure twin of the JSX `summary()`:
// the only one whose vocabulary can be checked without mounting a component, and the one that lasts
// longest, since a trace pasted into a ticket gets reread six months later.
import { LOCALE } from "../ui/locale.js";
import { normalizeRateLimit } from "./rate-limit-event.js";

/** A session event as the page holds it: the runner type and its raw payload. Structural on purpose:
 *  `sessions/use-session-events.ts` produces a superset (`dbId`, `sessionId`) the trace needs none
 *  of. */
export type TimelineEvent = { type: string; data: Record<string, unknown> };

/** An event's time as shown at the start of its line. An event without `ts` yields an empty string
 *  rather than today's date: a blank beats a lie. */
export function fmtTime(ev: TimelineEvent): string {
  const ts = ev.data.ts;
  if (typeof ts !== "number") return "";
  return new Date(ts).toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Text version of an event. Same content as the trace row, without decorative glyphs: what is
 *  pasted elsewhere must read without the drawing around it. */
// One entry per runner event type, one line each: this is the trace vocabulary and it reads as a
// column. Splitting it by family would mean opening three files to check a word.
// oxlint-disable-next-line complexity -- lookup table: one event type per case
export function plain(ev: TimelineEvent): string {
  const d = ev.data;
  switch (ev.type) {
    case "status":
      return `session ${String(d.status)}${d.resumed ? " (resumed)" : ""}${d.runner ? ` · runner ${String(d.runner)}` : ""}${d.network ? ` · network ${String(d.network)}` : ""}${d.model ? ` · ${String(d.model)}` : ""}`;
    case "init":
      return `init · ${String(d.model ?? "")}${d.resumed ? " · resumed" : ""}${d.apiKeySource !== undefined ? ` · auth: ${d.apiKeySource === "none" ? "oauth (subscription)" : String(d.apiKeySource)}` : ""}`;
    // `parent` (08/09): the line comes from a SUBAGENT, not the main thread. Without it a fan-out of
    // thirty-two branches reads like an agent repeating itself.
    case "tool_start":
      return `${d.parent ? "[subagent] " : ""}${String(d.tool)} ${typeof d.input === "string" ? d.input : ""}`;
    // A failure carries ITS REASON since 08/09: a trace pasted into a ticket must say why a tool was
    // refused, not just that it was.
    case "tool_end":
      return `${d.ok === false ? "failed" : "done"}${d.durationMs ? ` · ${String(d.durationMs)}ms` : ""}${d.ok === false && d.error ? ` — ${String(d.error)}` : ""}${d.ok !== false && d.result ? ` · ${String(d.result)}` : ""}`;
    case "text":
      return `${d.parent ? "[subagent] " : ""}${String(d.text ?? "")}`;
    case "activity":
      return `note: ${String(d.note)}`;
    case "task_status":
      return `task moved to ${String(d.status)}${Array.isArray(d.missingArtifacts) && d.missingArtifacts.length ? ` (missing artifacts: ${(d.missingArtifacts as string[]).join(", ")})` : ""}${d.via === "webhook" ? ` · merged by webhook (${String(d.url)})` : ""}`;
    case "result":
      return `result: ${String(d.subtype)}${typeof d.costUsd === "number" ? ` · $${d.costUsd.toFixed(2)}` : ""}`;
    case "run_error":
      return `error: ${String(d.message)}`;
    case "run_warning":
      return `warning: ${String(d.message)}`;
    case "inbox_ask":
      return `question asked: ${String(d.body)}`;
    // v26: `answeredBy` tells an AUTOMATIC wake-up (wait_for_task) from a real human answer; writing
    // "human answer" on a system wake-up would be false (server/src/inbox/inbox.ts, `answerInbox`).
    case "inbox_answer":
      return d.answeredBy === "system"
        ? `automatic wake-up: ${String(d.answer)}`
        : `human answer: ${String(d.answer)}`;
    case "inbox_note":
      return `note: ${String(d.body)}`;
    case "steer":
      return `you said: ${String(d.text)}`;
    case "steer_delivered":
      return "message delivered to the agent";
    case "dependency_wait":
      return `waiting on ${String(d.taskName ?? d.waitForTaskId)}${d.note ? ` — ${String(d.note)}` : ""}`;
    case "dependency_resolved":
      return d.reason === "deleted"
        ? "wait lifted — the awaited task was deleted"
        : "wait lifted — the awaited task is done";
    case "fs_op":
      return `fs: ${String(d.op)} ${String(d.path)}`;
    case "fs_denied":
      return `fs refused: ${String(d.op)} ${String(d.path)} (${String(d.reason)})`;
    case "throttle": {
      if (d.kind !== "rate_limit") return String(d.kind);
      const q = normalizeRateLimit(d);
      const pct = q.pct !== null ? ` · ${q.pct}% used` : "";
      const reset = q.reset
        ? ` · reset ${q.reset.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}`
        : "";
      return `quota ${String(d.rateLimitType ?? "")} · ${String(d.status)}${pct}${reset}`;
    }
    case "repo_ready":
      return `repo ${String(d.repo ?? "")} ready (${String(d.dir ?? "")}) · branch ${String(d.branch)}`;
    case "repo_push":
      return (d.changes as number) > 0
        ? `push ${String(d.repo ?? "")} · ${String(d.changes)} file(s) · ${String(d.commit)}`
        : `push ${String(d.repo ?? "")} · nothing to push`;
    case "repo_push_failed":
      return `push FAILED ${String(d.repo ?? "")} (${String(d.branch)}) : ${String(d.error)}`;
    case "capabilities":
      return `capabilities: ${Array.isArray(d.skills) ? `skills ${(d.skills as string[]).join(", ")}` : ""}${Array.isArray(d.mcpServers) ? `MCP ${(d.mcpServers as string[]).join(", ")}` : ""}`;
    // Inertia pause (10/09): the session reached its turn budget WHILE MAKING PROGRESS and restarts
    // alone in a fresh container. No question asked, so the line must read as a production fact,
    // like a push, not as an incident.
    case "turn_relaunch":
      return `automatic restart no. ${String(d.resume)} at turn ${String(d.used)} — ${String(d.commits)} commit(s), ${String(d.writes)} write(s)${d.writable === false ? ", no writable repository" : ""}`;
    default:
      return JSON.stringify(d);
  }
}

/** EVERYTHING that goes to the clipboard: a header saying which session this is, then one line per
 *  event. Without the header a pasted trace is unreadable: no agent, no model, no idea whether it
 *  finished. */
export function traceText(ctx: {
  taskName: string;
  agentName?: string;
  sessionId?: string;
  model?: string;
  status?: string;
  events: TimelineEvent[];
}): string {
  const header = `# Trace Legion · ${ctx.taskName}\n# agent: ${ctx.agentName ?? "?"} · session: ${ctx.sessionId ?? "—"} · model: ${ctx.model ?? "?"} · status: ${ctx.status ?? "?"}\n`;
  const body = ctx.events.map((ev) => `${fmtTime(ev)} [${ev.type}] ${plain(ev)}`).join("\n");
  return `${header}\n${body}\n`;
}
