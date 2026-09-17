// A session stream read as a CONVERSATION. The task page renders the same events as a trace, one line
// each; here they become turns. Three rules (decisions of 25/08):
//  · the agent's SPEECH (and yours) is a message;
//  · its WORK is a one-line expandable band, never 333 messages;
//  · a question is a ROUND; once answered it collapses.
// The rest (a push, an incident, a session end) is a notice: a dated fact that is nobody's speech.
//
// This module produces NO sentence: a notice carries a CODE, worded by the domain catalog (text.ts).
import type { SessionEvent } from "../sessions/use-session-events.js";
import { workBand, type WorkBand } from "./work-band.js";

export type NoticeTone = "neutral" | "wait" | "bad" | "ok";
export type NoticeCode =
  | "run_error"
  | "run_warning"
  | "repo_push_failed"
  | "fs_denied"
  | "throttle"
  | "result_ok"
  | "result_end"
  | "task_status"
  | "repo_push"
  | "dependency_wait"
  | "dependency_resolved";

export type Segment =
  | { kind: "say"; key: string; at?: number; who: "agent" | "human"; text: string }
  | { kind: "work"; key: string; at?: number; band: WorkBand }
  | {
      kind: "round";
      key: string;
      at?: number;
      inboxId: string;
      question: string;
      answer: string | null;
      answeredAt?: number;
    }
  | { kind: "notice"; key: string; at?: number; tone: NoticeTone; code: NoticeCode; detail: string }
  /** The break between two sessions (26/08). The thread spans the whole task: unmarked, a resume after
   *  failure would look like the same conversation. Only id and rank; the caption (agent, model, end
   *  cause) belongs to the screen, which has the sessions. */
  | { kind: "session"; key: string; at?: number; sessionId: string; index: number };

/** What is counted rather than read. Everything else is a turn or a fact. */
const WORK = new Set([
  "init",
  "status",
  "tool_start",
  "tool_end",
  "fs_op",
  "activity",
  "repo_ready",
  "capabilities",
  "steer_delivered",
]);

const at = (ev: SessionEvent): number | undefined =>
  typeof ev.data.ts === "number" ? ev.data.ts : undefined;

/** The fact an event carries, if any. `null` = not a notice. */
// oxlint-disable-next-line complexity -- lookup table: one event type per case, each line giving tone, code and detail
function notice(ev: SessionEvent): { tone: NoticeTone; code: NoticeCode; detail: string } | null {
  const d = ev.data;
  switch (ev.type) {
    case "run_error":
      return { tone: "bad", code: "run_error", detail: String(d.message ?? "") };
    case "run_warning":
      return { tone: "wait", code: "run_warning", detail: String(d.message ?? "") };
    case "repo_push_failed":
      return { tone: "bad", code: "repo_push_failed", detail: String(d.error ?? "") };
    case "fs_denied":
      return {
        tone: "bad",
        code: "fs_denied",
        detail: `${String(d.op ?? "")} ${String(d.path ?? "")}`,
      };
    case "throttle":
      return d.kind === "rate_limit" && d.status !== "allowed"
        ? { tone: "wait", code: "throttle", detail: String(d.status ?? "") }
        : null;
    case "task_status":
      return { tone: "neutral", code: "task_status", detail: String(d.status ?? "") };
    case "dependency_wait":
      return {
        tone: "wait",
        code: "dependency_wait",
        detail: String(d.taskName ?? d.waitForTaskId ?? ""),
      };
    case "dependency_resolved":
      return { tone: "neutral", code: "dependency_resolved", detail: String(d.reason ?? "") };
    case "repo_push":
      return (d.changes as number) > 0
        ? {
            tone: "neutral",
            code: "repo_push",
            detail: `${String(d.repo ?? "")} · ${String(d.changes)} · ${String(d.commit ?? "")}`,
          }
        : null;
    case "result":
      return d.subtype === "success"
        ? { tone: "ok", code: "result_ok", detail: "" }
        : { tone: "neutral", code: "result_end", detail: String(d.subtype ?? "") };
    default:
      return null;
  }
}

/** The whole stream as turns, time order preserved. */
export function transcript(events: SessionEvent[]): Segment[] {
  const out: Segment[] = [];
  const rounds = new Map<string, number>(); // inboxId → round segment index
  let work: SessionEvent[] = [];
  // The session being read. `undefined` until an event carries one: a single-session stream then
  // produces NO break.
  let session: string | undefined;
  let sessionCount = 0;
  const flush = (i: number) => {
    if (work.length === 0) return;
    const band = workBand(work);
    // Filter out empty bands: keep only if there are actual tools/reads/writes,
    // or if there are meaningful lines (not just init/status lines).
    const hasMeaningfulContent = band.tools > 0 || band.reads > 0 || band.writes > 0;
    const hasMeaningfulLines = band.lines.some(
      (line) => line.verb !== "init" && line.verb !== "session",
    );
    if (hasMeaningfulContent || hasMeaningfulLines) {
      out.push({ kind: "work", key: `w${i}`, at: at(work[0]!), band });
    }
    work = [];
  };

  // oxlint-disable-next-line complexity -- one pass over the stream, one case per event type, and their ORDER is the contract: session break first, work grouping next, notice as fallback
  events.forEach((ev, i) => {
    // The break BEFORE everything, including work grouping: a band spanning two sessions would count
    // tools that did not run together.
    if (ev.sessionId && ev.sessionId !== session) {
      flush(i);
      const first = session === undefined;
      session = ev.sessionId;
      sessionCount += 1;
      // No mark before the FIRST: nothing to cut before starting.
      if (!first)
        out.push({
          kind: "session",
          key: `x${i}`,
          at: at(ev),
          sessionId: ev.sessionId,
          index: sessionCount,
        });
    }
    const d = ev.data;
    if (WORK.has(ev.type) || (ev.type === "repo_push" && !((d.changes as number) > 0))) {
      work.push(ev);
      return;
    }
    flush(i);
    if (ev.type === "text" || ev.type === "inbox_note") {
      const text = String((ev.type === "text" ? d.text : d.body) ?? "").trim();
      if (text) out.push({ kind: "say", key: `s${i}`, at: at(ev), who: "agent", text });
      return;
    }
    if (ev.type === "steer") {
      out.push({ kind: "say", key: `s${i}`, at: at(ev), who: "human", text: String(d.text ?? "") });
      return;
    }
    if (ev.type === "inbox_ask") {
      // A dependency wait uses the same event as a question, but nobody has to answer: it wakes by
      // itself. Showing it as a round would lie.
      if (d.waitForTaskId) {
        out.push({
          kind: "notice",
          key: `n${i}`,
          at: at(ev),
          tone: "wait",
          code: "dependency_wait",
          detail: "",
        });
        return;
      }
      const inboxId = String(d.inboxId ?? `q${i}`);
      rounds.set(inboxId, out.length);
      out.push({
        kind: "round",
        key: `r${i}`,
        at: at(ev),
        inboxId,
        question: String(d.body ?? ""),
        answer: null,
      });
      return;
    }
    if (ev.type === "inbox_answer") {
      const idx = rounds.get(String(d.inboxId ?? ""));
      const seg = idx === undefined ? undefined : out[idx];
      if (seg?.kind === "round") {
        seg.answer = String(d.answer ?? "");
        seg.answeredAt = at(ev);
      }
      return;
    }
    const n = notice(ev);
    if (n) out.push({ kind: "notice", key: `n${i}`, at: at(ev), ...n });
  });
  flush(events.length);
  return out;
}
