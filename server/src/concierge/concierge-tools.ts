// What the concierge can fetch by itself (13/09). The compiled context (`concierge-context.ts`)
// is a summary, and a summary never holds the line one is looking for.
//
// Three tools, all read-only: they read what the screen already shows. Write tools need a
// confirmation in the thread, which does not exist yet.
//
// The descriptions are content, not documentation (same rule as `runner-payload/mcp-tools.mts`):
// the model reads them to decide what to call.
//
// The SDK and the queries are injected, so tests exercise the formatting, the only thing that can
// be wrong here.
import { z } from "zod";
import type {
  AnyZodRawShape,
  SdkMcpToolDefinition,
  tool as sdkTool,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  SessionEventRow,
  SessionRow,
  TaskSearch,
  TaskWithProject,
} from "./concierge-tools-store.js";

/** Full names as the SDK exposes them once the server is mounted as `legion`. `canUseTool`
 *  compares against this list and no other. */
export const CONCIERGE_TOOL_NAMES = [
  "mcp__legion__task_detail",
  "mcp__legion__task_timeline",
  "mcp__legion__search_tasks",
] as const;

/** Turn cap when tooled: one turn per tool call plus the answer. Eight leaves room for an
 *  investigation without letting a loop run until the timeout. */
export const CONCIERGE_TOOL_TURNS = 8;

/** Event types that say why rather than what: one more `tool_start` teaches nothing about a
 *  failure, a `run_error` is the whole answer. A default, not a limit: `all: true` returns
 *  everything up to the cap. */
const FAILURE_EVENT_TYPES = ["run_error", "run_warning", "result", "status", "task_status", "text"];

/** Per-event size before cutting. An assistant `text` or a `tool_end` is often several kilobytes,
 *  and twenty would fill the window; a failure fits in the first lines. */
const EVENT_PAYLOAD_MAX = 600;
const TIMELINE_EVENT_MAX = 40;
const SEARCH_LIMIT_MAX = 30;

export interface ConciergeToolsStore {
  taskWithProject: (taskId: string) => TaskWithProject | null;
  sessionsOfTask: (taskId: string) => { session: SessionRow; agentName: string }[];
  eventsOfSessions: (sessionIds: string[], types: string[], limit: number) => SessionEventRow[];
  searchTasks: (opts: TaskSearch) => TaskWithProject[];
}

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition["handler"]>>;

const iso = (d: Date | null): string => (d === null ? "—" : d.toISOString());

function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

/** Reads a tool input. The SDK already validated it against the zod schema; this narrows the type
 *  and turns `""` into `null`: the model often sends `""` for "no filter", which must not become
 *  `LIKE '%%'`. */
function readText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** The model can only lower the cap. */
function readCount(v: unknown, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) return max;
  return Math.min(Math.floor(v), max);
}

/** A payload is runner-written JSON, returned as-is and cut. Reinterpreting it would mean knowing
 *  the shape of twenty event types, and a runner-side change would make the concierge lie
 *  silently. */
function trimPayload(payload: string): string {
  const flat = payload.replace(/\s+/g, " ").trim();
  return flat.length > EVENT_PAYLOAD_MAX ? `${flat.slice(0, EVENT_PAYLOAD_MAX)}…` : flat;
}

export function formatTaskDetail(
  found: TaskWithProject,
  sessions: { session: SessionRow; agentName: string }[],
): string {
  const { task, projectName } = found;
  const head = [
    `task=${task.id} [${projectName}] ${task.name}`,
    `status: ${task.status}${task.settledOutcome ? ` (settled: ${task.settledOutcome})` : ""}`,
    `created ${iso(task.createdAt)}, updated ${iso(task.updatedAt)}`,
    task.description ? `brief: ${task.description}` : "brief: (empty)",
  ].join("\n");

  if (sessions.length === 0) return `${head}\n\nsessions: none`;

  const lines = sessions.map(({ session: s, agentName }) => {
    const cost = s.costUsd === null ? "unknown cost" : `$${s.costUsd.toFixed(2)}`;
    const reason = s.endReason ? ` — ${s.endReason}` : "";
    return `- session=${s.id} (${agentName}, ${s.model}) ${s.status}, ${cost}, started ${iso(s.startedAt)}, ended ${iso(s.endedAt)}${reason}`;
  });
  return `${head}\n\nsessions (${sessions.length}):\n${lines.join("\n")}`;
}

/** The query pulls newest first so the cap drops the oldest lines; the output reads oldest
 *  first. */
export function formatTimeline(events: SessionEventRow[], all: boolean): string {
  if (events.length === 0) {
    return all
      ? "no event for this task."
      : "no notable event (error, result, status change, what the agent said) for this task. Call the tool again with all=true for the whole trace.";
  }
  const lines = [...events]
    .reverse()
    .map((e) => `${iso(e.createdAt)} [${e.type}] ${trimPayload(e.payload)}`);
  return lines.join("\n");
}

export function formatSearchResults(found: TaskWithProject[]): string {
  if (found.length === 0) return "no task matches.";
  return found
    .map(
      ({ task: t, projectName }) =>
        `- task=${t.id} [${projectName}] ${t.name} — ${t.status}, updated ${iso(t.updatedAt)}`,
    )
    .join("\n");
}

/** The schema is left open (`AnyZodRawShape`) and inputs are read by hand. Each `tool()` returns a
 *  type carrying its own schema, which a list cannot hold: the SDK uses `any` on `tools`, which
 *  `typescript/no-explicit-any` forbids here, and narrowing afterwards would need an
 *  `as unknown as`, the unchecked promise the architecture ratchet counts. Fixing the type
 *  parameter gives the three tools one type.
 *
 *  The handler then receives an arbitrary object; the SDK already validated it, and the handlers
 *  re-read what they use. */
export function buildConciergeTools(
  bindings: { tool: typeof sdkTool },
  store: ConciergeToolsStore,
): SdkMcpToolDefinition[] {
  const { tool } = bindings;
  return [
    tool<AnyZodRawShape>(
      "task_detail",
      "Read one Legion task in full: status, brief, and every session it has run with cost and end reason. Use it whenever the operator names or links a task — the compiled context above only carries a summary.",
      {
        taskId: z
          .string()
          .describe(
            "The task id, e.g. 'AWCsGxmP7i'. It appears as task=<id> in the context above, and in task URLs after /tasks/ (or /taches/ in an older link).",
          ),
      },
      async (args): Promise<ToolResult> => {
        const taskId = readText(args.taskId);
        if (taskId === null) return text("missing taskId.");
        const found = store.taskWithProject(taskId);
        if (!found) return text(`no task ${taskId}.`);
        return text(formatTaskDetail(found, store.sessionsOfTask(taskId)));
      },
    ),
    tool<AnyZodRawShape>(
      "task_timeline",
      "Read the execution trace of a task's sessions — this is what answers 'why did it fail'. By default only the events that explain an outcome (errors, warnings, results, status changes, what the agent said); pass all=true for every event.",
      {
        taskId: z.string().describe("The task id."),
        all: z
          .boolean()
          .optional()
          .describe("true = every event type, including tool calls. Default false."),
        limit: z
          .number()
          .optional()
          .describe(
            `How many events at most, newest kept. Default and maximum ${TIMELINE_EVENT_MAX}.`,
          ),
      },
      async (args): Promise<ToolResult> => {
        const taskId = readText(args.taskId);
        if (taskId === null) return text("missing taskId.");
        const found = store.taskWithProject(taskId);
        if (!found) return text(`no task ${taskId}.`);
        const sessionIds = store.sessionsOfTask(taskId).map((s) => s.session.id);
        if (sessionIds.length === 0) return text(`task ${taskId} has never run.`);
        const all = args.all === true;
        const cap = readCount(args.limit, TIMELINE_EVENT_MAX);
        return text(
          formatTimeline(
            store.eventsOfSessions(sessionIds, all ? [] : FAILURE_EVENT_TYPES, cap),
            all,
          ),
        );
      },
    ),
    tool<AnyZodRawShape>(
      "search_tasks",
      "Find tasks across every project by words in their name or brief, by status, or by project. Use it when the operator describes a task instead of naming it.",
      {
        text: z.string().optional().describe("Words to look for in the task name or brief."),
        status: z.enum(["later", "todo", "doing", "review", "done"]).optional(),
        projectId: z.string().optional().describe("Restrict to one project."),
        limit: z
          .number()
          .optional()
          .describe(`How many at most. Default and maximum ${SEARCH_LIMIT_MAX}.`),
      },
      async (args): Promise<ToolResult> => {
        const found = store.searchTasks({
          text: readText(args.text),
          status: readText(args.status),
          projectId: readText(args.projectId),
          limit: readCount(args.limit, SEARCH_LIMIT_MAX),
        });
        return text(formatSearchResults(found));
      },
    ),
  ];
}
