// A session trace laid out as <Timeline> rows, in the runner's own vocabulary. Split from
// `TaskPage.tsx`: the biggest block of the page, and it knows nothing about it. What it carries that
// can be CHECKED is structure (pairing a `tool_start` with its `tool_end`, the kind table, what
// folds), readable without rendering a single row.
import type { ReactNode } from "react";
import { CodeBlock } from "../ui/code.js";
import { Link } from "../ui/link.js";
import { LOCALE } from "../ui/locale.js";
import { Num } from "../ui/num.js";
import { Tag } from "../ui/chip.js";
import { Text } from "../ui/text.js";
import type { TimelineEmphasis, TimelineKind } from "../ui/timeline.js";
import { CostValue } from "../sessions/cost.js";
import { ToolCall } from "../sessions/tool-call.js";
import { RepoChip } from "../projects/repo-chip.js";
import { normalizeRateLimit } from "./rate-limit-event.js";
import { fmtTime, type TimelineEvent } from "./trace-text.js";

/** The 25 types emitted by the runner → the 20 <TimelineItem> knows. The 5 orphans borrow their
 *  closest parent's icon. */
const KIND: Record<string, TimelineKind> = {
  init: "init",
  status: "status",
  tool_start: "tool_start",
  tool_end: "tool_end",
  text: "text",
  result: "result",
  repo_ready: "repo_ready",
  repo_push: "repo_push",
  fs_op: "fs_op",
  fs_denied: "fs_denied",
  throttle: "throttle",
  task_status: "task_status",
  run_error: "run_error",
  inbox_ask: "inbox_ask",
  capabilities: "capabilities",
  activity: "text",
  run_warning: "status",
  inbox_answer: "inbox_ask",
  inbox_note: "inbox_ask",
  repo_push_failed: "repo_push",
  steer: "steer",
  steer_delivered: "steer_delivered",
  dependency_wait: "dependency_wait",
  dependency_resolved: "dependency_resolved",
  turn_relaunch: "turn_relaunch",
};

/** fs_denied and run_error mark themselves in the module; these do not. */
const EMPHASIS: Record<string, TimelineEmphasis> = { repo_push_failed: "error" };

/** A FAILED tool, which only the `tool_end` knows. The row said "done" in both cases, and the folded
 *  call kept no trace of it: a session could die on two refused `Bash` calls with no red row. */
const failed = (ev?: TimelineEvent): boolean => ev?.type === "tool_end" && ev.data.ok === false;

/** Events whose payload is a structure are worth folding; those carrying only a sentence (text,
 *  note, question) are already whole on their row. */
const FOLDABLE = new Set([
  "init",
  "status",
  "tool_start",
  "tool_end",
  "result",
  "repo_ready",
  "repo_push",
  "repo_push_failed",
  "fs_op",
  "fs_denied",
  "throttle",
  "task_status",
  "run_error",
  "capabilities",
  // Send and delivery carry the SAME `steerId`: unfolding pairs the two rows when several messages
  // follow each other, since delivery can land ten events later.
  "steer",
  "steer_delivered",
  // The row only shows the suggested sentence; `idleTurns`, `sinceTurn` and `lastCommitTurn` stay in
  // the fold for whoever wants the full measure.
  "turn_relaunch",
]);

/** An UNKNOWN type folds too (16/09). Its row can only show its name, since no `summary` case reads
 *  it, so its payload is all that is left to show, better under a fold than dumped on the row. */
const foldable = (type: string): boolean => FOLDABLE.has(type) || !(type in KIND);

export interface Rendered {
  key: string;
  time: string;
  dateTime?: string;
  kind: TimelineKind;
  emphasis?: TimelineEmphasis;
  summary: ReactNode;
  detail?: ReactNode;
}

/** A fan-out branch label: the `description` of the `Agent` call that started it.
 *
 *  The runner truncates a call's input to 300 characters, so `JSON.parse` would fail half the time.
 *  Read the FIELD, not the structure: a regex beats a parser when the data is no longer valid JSON. */
function branchLabel(parentCall?: TimelineEvent): string | undefined {
  const input = parentCall?.data.input;
  if (typeof input !== "string") return undefined;
  return /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(input)?.[1];
}

/** Calls joinable by id, starts and ends mixed. Events without `id` (traces before 08/09) are not in
 *  it: `endOf` catches them by position. */
function callsById(events: TimelineEvent[]): Map<string, TimelineEvent> {
  const byId = new Map<string, TimelineEvent>();
  for (const ev of events) {
    if ((ev.type === "tool_end" || ev.type === "tool_start") && typeof ev.data.id === "string") {
      byId.set(`${ev.type}:${ev.data.id}`, ev);
    }
  }
  return byId;
}

/** The end closing this call, by id when both sides carry one. The immediate neighbour remains the
 *  fallback for traces predating ids, and only if it has none either: otherwise nothing proves that
 *  end is this call's. */
function endOf(
  start: TimelineEvent,
  next: TimelineEvent | undefined,
  byId: Map<string, TimelineEvent>,
): TimelineEvent | undefined {
  if (start.type !== "tool_start") return undefined;
  if (typeof start.data.id === "string") return byId.get(`tool_end:${start.data.id}`);
  return next?.type === "tool_end" && typeof next.data.id !== "string" ? next : undefined;
}

/** A subagent's branch, read on the call that started it. Nothing for the main thread; the word
 *  "subagent" when the parent call is missing or undescribed. */
function branchOf(ev: TimelineEvent, byId: Map<string, TimelineEvent>): string | undefined {
  if (ev.data.parent === undefined) return undefined;
  return branchLabel(byId.get(`tool_start:${String(ev.data.parent)}`)) ?? "sous-agent";
}

/** A tool call is ONE row: the tool_end of THIS call is absorbed (its duration goes into the summary,
 *  its payload into the fold).
 *
 *  Pairing is BY ID since 08/09, not by position. The immediate neighbour worked while a single
 *  thread spoke; under a fan-out of subagents in the same stream, a call's start got closed by
 *  ANOTHER call's end: wrong duration and, once failures were rendered, a red row on the wrong call.
 *  Position remains the fallback for older traces without ids. */
export function rows(events: TimelineEvent[]): Rendered[] {
  const byId = callsById(events);
  const absorbed = new Set<TimelineEvent>();
  const out: Rendered[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]!;
    if (absorbed.has(ev)) continue;
    const paired = endOf(ev, events[i + 1], byId);
    if (paired) absorbed.add(paired);
    const ts = typeof ev.data.ts === "number" ? ev.data.ts : undefined;
    const branch = branchOf(ev, byId);
    out.push({
      key: `${i}-${ev.type}`,
      time: fmtTime(ev),
      dateTime: ts === undefined ? undefined : new Date(ts).toISOString(),
      kind: KIND[ev.type] ?? "status",
      emphasis: EMPHASIS[ev.type] ?? (failed(ev) || failed(paired) ? "error" : undefined),
      // The branch label BEFORE the summary: thirty-two "Read rules.md" rows in the same second are
      // only told apart by it.
      summary: branch ? (
        <>
          <Tag title={branch} side="right">
            {branch}
          </Tag>{" "}
          {summary(ev, paired)}
        </>
      ) : (
        summary(ev, paired)
      ),
      detail: foldable(ev.type) ? (
        <CodeBlock label={`payload ${ev.type}`}>
          {JSON.stringify(ev.data)}
          {paired ? `\n${JSON.stringify(paired.data)}` : ""}
        </CodeBlock>
      ) : undefined,
    });
  }
  return out;
}

function ms(value: unknown): ReactNode {
  return typeof value === "number" ? <Num value={value} suffix="ms" tone="muted" /> : null;
}

/** A failure's REASON as the runner captured it (`tool_end.error`). Nothing when the tool succeeded:
 *  success text is not in the trace, and a bare "failed" is still true. */
function reason(d: Record<string, unknown>): ReactNode {
  return d.ok === false && typeof d.error === "string" && d.error ? <> — {d.error}</> : null;
}

/** A success NOTICE (`tool_end.result`, 10/09): what the harness answered when the answer was short.
 *  "done" alone lied for two minutes on session `o5yN0TxYJOsY`: the command had moved to the
 *  background, and the row read the same as a passing test suite. Older traces lack the field. */
function notice(d: Record<string, unknown>): ReactNode {
  return d.ok !== false && typeof d.result === "string" && d.result ? (
    <>
      {" "}
      · <Text tone="muted">{d.result}</Text>
    </>
  ) : null;
}

/** The outcome of a call folded into its `tool_start` row: silent when all went well AND the harness
 *  said nothing. */
function outcome(d: Record<string, unknown>): ReactNode {
  return d.ok === false ? <> · failed{reason(d)}</> : notice(d);
}

/** An event's rendering: the JSX twin of `plain()`, one case per type. It reads as a column, and
 *  splitting it by family would mean searching three files for the word a single row shows. */
// oxlint-disable-next-line complexity -- lookup table: one event type per case
export function summary(ev: TimelineEvent, paired?: TimelineEvent): ReactNode {
  const d = ev.data;
  switch (ev.type) {
    case "status":
      return (
        <>
          session {String(d.status)}
          {d.resumed ? " (resumed)" : ""}
          {d.runner ? (
            <>
              {" "}
              · runner <Tag>{String(d.runner)}</Tag>
            </>
          ) : null}
          {d.network ? ` · network ${String(d.network)}` : ""}
          {d.model ? (
            <>
              {" "}
              · <Tag>{String(d.model)}</Tag>
            </>
          ) : null}
        </>
      );
    case "init":
      return (
        <>
          init
          {d.model ? (
            <>
              {" "}
              · <Tag>{String(d.model)}</Tag>
            </>
          ) : null}
          {d.resumed ? " · resumed" : ""}
          {d.apiKeySource !== undefined
            ? ` · auth: ${d.apiKeySource === "none" ? "oauth (subscription)" : String(d.apiKeySource)}`
            : ""}
        </>
      );
    // `ToolCall` extracts the meaningful argument (the command, the file) instead of dumping raw
    // JSON, truncates with a real ellipsis, and only opens a tooltip if truncation happened. The full
    // payload stays in the row's fold.
    case "tool_start":
      return (
        <>
          <ToolCall
            tool={String(d.tool)}
            input={typeof d.input === "string" ? d.input : undefined}
          />
          {paired ? (
            <>
              {" "}
              · {ms(paired.data.durationMs)}
              {outcome(paired.data)}
            </>
          ) : null}
        </>
      );
    case "tool_end":
      return (
        <>
          {d.ok === false ? "failed" : "done"}
          {d.durationMs ? <> · {ms(d.durationMs)}</> : null}
          {reason(d)}
        </>
      );
    case "text":
      return String(d.text ?? "");
    case "activity":
      return `note: ${String(d.note)}`;
    case "task_status":
      return (
        <>
          task moved to {String(d.status)}
          {Array.isArray(d.missingArtifacts) && d.missingArtifacts.length ? (
            <> (missing artifacts: {(d.missingArtifacts as string[]).join(", ")})</>
          ) : null}
          {d.via === "webhook" ? (
            <>
              {" "}
              · merged by{" "}
              <Link variant="plain" href={String(d.url)} target="_blank" rel="noreferrer">
                webhook
              </Link>
            </>
          ) : null}
        </>
      );
    case "result":
      return (
        <>
          result: {String(d.subtype)}
          {typeof d.costUsd === "number" ? (
            <>
              {" "}
              · <CostValue usd={d.costUsd} />
            </>
          ) : null}
        </>
      );
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
    // The text FIRST: it is what gets reread months later to understand why the session changed
    // course. Delivery has no content, only evidential value.
    case "steer":
      return `you said: ${String(d.text)}`;
    case "steer_delivered":
      return "message delivered to the agent";
    // wait_for_task (v26): the session sleeps on another task, then wakes up on its own.
    case "dependency_wait":
      return (
        <>
          waiting on <Tag>{String(d.taskName ?? d.waitForTaskId)}</Tag>
          {d.note ? <> — {String(d.note)}</> : null}
        </>
      );
    case "dependency_resolved":
      return d.reason === "deleted"
        ? "wait lifted — the awaited task was deleted"
        : "wait lifted — the awaited task is done";
    // Inertia pause (10/09): the session was progressing and restarts on its own, no question asked,
    // so no alert tone. The fold carries the full measure (`idleTurns`, `sinceTurn`…).
    case "turn_relaunch":
      return (
        <>
          automatic restart no. <Num value={d.resume as number} tone="muted" /> at turn{" "}
          <Num value={d.used as number} tone="muted" /> —{" "}
          <Num value={d.commits as number} suffix="commit(s)" tone="muted" />,{" "}
          <Num value={d.writes as number} suffix="write(s)" tone="muted" />
          {d.writable === false && ", no writable repository"}
        </>
      );
    // side="right": the timeline is a DENSE list (~30px rows, sometimes hundreds), and a top/bottom
    // bubble would cover the next row (observed bug, not a hypothesis).
    case "fs_op":
      return (
        <>
          {String(d.op)}{" "}
          <Tag title={String(d.path)} side="right">
            {String(d.path)}
          </Tag>
        </>
      );
    case "fs_denied":
      return (
        <>
          {String(d.op)} refused on{" "}
          <Tag title={String(d.path)} side="right">
            {String(d.path)}
          </Tag>{" "}
          — {String(d.reason)}
        </>
      );
    case "throttle": {
      if (d.kind !== "rate_limit") return String(d.kind);
      const q = normalizeRateLimit(d);
      const reset = q.reset
        ? ` · reset ${q.reset.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}`
        : "";
      return (
        <>
          quota {String(d.rateLimitType ?? "")} · {String(d.status)}
          {q.pct !== null ? (
            <>
              {" "}
              · <Num value={q.pct} suffix="%" tone="wait" /> used
            </>
          ) : null}
          {reset}
        </>
      );
    }
    case "repo_ready":
      return (
        <>
          <RepoChip
            repo={String(d.repo ?? "")}
            dir={d.dir ? String(d.dir) : undefined}
            branch={d.branch ? String(d.branch) : undefined}
          />{" "}
          ready
        </>
      );
    case "repo_push":
      return (d.changes as number) > 0 ? (
        <>
          <RepoChip repo={String(d.repo ?? "")} /> ·{" "}
          <Num value={d.changes as number} suffix="file(s)" tone="muted" /> ·{" "}
          <Tag>{String(d.commit)}</Tag>
        </>
      ) : (
        <>
          <RepoChip repo={String(d.repo ?? "")} /> · nothing to push
        </>
      );
    case "repo_push_failed":
      return (
        <>
          <RepoChip repo={String(d.repo ?? "")} branch={d.branch ? String(d.branch) : undefined} />{" "}
          — push refused: {String(d.error)}
        </>
      );
    case "capabilities":
      return <Capabilities d={d} />;
    // A type without a case SAYS ITS NAME, it does not dump its bytes (16/09). This fallback used to
    // render raw JSON on the row, `{"inboxId":"zxcb_IF2-B","answered":2,...}`, ten times in a row
    // instead of a sentence. The type name is usable (search it in the code), the bytes are not. The
    // full payload stays one click away in the fold.
    default:
      return <Tag>{ev.type}</Tag>;
  }
}

/** What the session received: skills, MCP servers, rules, loaded instructions.
 *
 *  Pulled out of the `switch` (v61) because the case has four forms and the original row rendered
 *  two: the rules merge event (v42) already sent `rules` and `rulesBlocked`, and the timeline showed
 *  "capabilities:" followed by nothing. An event published but not shown is a trace that does not
 *  exist. */
function Capabilities({ d }: { d: Record<string, unknown> }) {
  const skills = Array.isArray(d.skills) ? (d.skills as string[]) : [];
  const mcp = Array.isArray(d.mcpServers) ? (d.mcpServers as string[]) : [];
  const loaded = Array.isArray(d.instructions) ? (d.instructions as string[]) : [];
  const blocked = Array.isArray(d.rulesBlocked) ? (d.rulesBlocked as string[]) : [];
  const overridden = Array.isArray(d.rulesOverridden) ? (d.rulesOverridden as string[]) : [];
  return (
    <>
      capabilities:
      {skills.length > 0 && (
        <>
          {" "}
          skills{" "}
          {skills.map((s) => (
            <Tag key={s}>{s}</Tag>
          ))}
        </>
      )}
      {mcp.length > 0 && (
        <>
          {" "}
          MCP{" "}
          {mcp.map((s) => (
            <Tag key={s}>{s}</Tag>
          ))}
        </>
      )}
      {typeof d.rules === "number" && (
        <>
          {" "}
          <Num value={d.rules} suffix="rule(s)" tone="muted" />
        </>
      )}
      {/* An override and a lock refusal are the two facts an operator must be able to find: one says
          a repository file won, the other that it was refused. */}
      {overridden.length > 0 && <> · replaced by a repository: {overridden.join(" · ")}</>}
      {blocked.length > 0 && <> · refused by a lock: {blocked.join(" · ")}</>}
      {/* v61: the instructions ACTUALLY LOADED by the SDK. A count and the reason on the row, paths in
          the title: at start there are thirty, and thirty bullets would make the timeline unreadable
          for the least surprising of the three. */}
      {loaded.length > 0 && (
        <span title={loaded.join("\n")}>
          {" "}
          instructions loaded <Num value={loaded.length} tone="muted" />
          {typeof d.instructionsReason === "string" && <> ({String(d.instructionsReason)})</>}
          {typeof d.instructionsTrigger === "string" && (
            <> — triggered by {String(d.instructionsTrigger)}</>
          )}
        </span>
      )}
    </>
  );
}
