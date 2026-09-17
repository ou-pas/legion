// sdk-events: what the SDK's message shapes mean.
//
// Split from `runReal`'s loop on 06/09. These functions were three branches of a five-level
// `else if`, and the depth was the real cost: the runner's only spot measured at six nesting levels
// was here, in the `user` branch, where a `break` had to choose between two loops.
//
// All three are pure: a message in, a list of facts out. No report sent, no counter advanced, nothing
// paused; the loop keeps every decision and just stops sorting SDK shapes at the same time.
//
// Only one other module knows message shapes, on purpose: turn-tracker knows what a turn end is (a
// `message.id`), this one knows what content is. On 03/09 turn-end recognition lived in the loop
// under a condition never true, and the guardrails depending on it were silently off together.
//
// The types here are ours, not the SDK's (batch 10, 10/09): these functions defensively read shapes
// the SDK type does not distinguish (a `tool_result` whose content is sometimes a bare string,
// sometimes typed blocks, and truncated messages a test builds with three fields). A full
// `SDKAssistantMessage` would make the module uncheckable outside a container. Field names stay the
// SDK's, to the letter.

/** A content block as this module sees it. Everything is optional because that is what these
 *  functions untangle: `type` says which of the following fields exist. */
type ContentBlock = {
  type?: string;
  /** `tool_use`: the tool name, its input, and the id that will pair its result. */
  name?: string;
  input?: unknown;
  id?: string;
  /** `text` */
  text?: string;
  /** `tool_result`: `content` is a string or a list of blocks, hence `unknown`. */
  content?: unknown;
  is_error?: boolean;
  tool_use_id?: string;
};

/** A stream assistant message, reduced to what is read. */
type StreamMessage = {
  parent_tool_use_id?: string | null;
  message?: { content?: ContentBlock[] };
};

/** A stream user message, the one carrying tool results. Its `content` can be a plain string, the
 *  SDK's form for an ordinary user turn, which the `Array.isArray` in `toolResults` has always
 *  excluded. */
type ResultMessage = { message?: { content?: ContentBlock[] | string } };

/** What is read from a `rate_limit_info`. Names are the SDK's (`SDKRateLimitInfo`); types are wider
 *  in one place: `resetsAt` is a `number` there, and this module only passes it through to the
 *  trace's JSON, where a test gives it as ISO. Narrowing would mean deciding what the trace carries,
 *  which this batch does not do. */
type RateLimitRead = {
  status?: string;
  utilization?: number;
  rateLimitType?: string;
  resetsAt?: string | number;
};

/** A tool call kept by the loop until its result. */
export type ToolCall = { id?: string; tool?: string; input: string; sub: boolean };

/** A fact extracted from an `assistant` message: what goes into the trace, and the call to pair. */
export type AssistantEvent = {
  type: string;
  payload: Record<string, unknown>;
  activity: string;
  call: ToolCall | null;
};

/** What an `assistant` message contains of interest, in the order it produced it.
 *
 *  `activity` is the sentence the inbox will show the human if the session must stop right after:
 *  without it, a budget question says a number was exceeded and nothing of what the session was
 *  doing.
 *
 *  Who speaks matters, and `parent_tool_use_id` says it: a message carrying one comes from a subagent
 *  started by the `Agent` tool, not the main thread. The SDK surfaces them in the same stream, exactly
 *  what the trace wants (the human sees what the fan-out does) and exactly what counting repetitions
 *  does not. Hence `sub` on the call; the rule using it is in stuck.
 */
export function assistantEvents(msg: StreamMessage): AssistantEvent[] {
  const out: AssistantEvent[] = [];
  // v65: who speaks also enters the trace, not only the stuck detector.
  //
  // `sub` already existed here but only served stuck: the stored payload carried nothing. A fan-out
  // of thirty-two subagents gave thirty-two lines indistinguishable from the main thread's, in the
  // same second, and AI-2200's trace is unreadable for it. `parent` carries the id of the `Agent`
  // call that started this one: the screen groups, and anything that wants to count a fan-out (a
  // guard, a rule, a query on `session_events`) reads the same field. No extra cache or table: the
  // event is the storage, already persisted.
  const parent = msg.parent_tool_use_id ?? null;
  const sub = Boolean(parent);
  for (const b of msg.message?.content ?? []) {
    if (b.type === "tool_use") {
      const input = JSON.stringify(b.input);
      out.push({
        type: "tool_start",
        // `id`: how `tool_end` finds its own call. Pairing by position worked while one thread
        // spoke; under a fan-out one subagent's start was closed by another's end.
        // 2,000 for display (08/09): at 300 the input of an `fs_write` or `Edit` was cut before the
        // content, so the trace said a tool was called without ever saying with what, the half that
        // is missing when rereading a session that went wrong.
        payload: {
          tool: b.name,
          input: input.slice(0, 2_000),
          id: b.id,
          ...(parent ? { parent } : {}),
        },
        activity: `tool ${b.name} (${input.slice(0, 200)})`,
        // Kept by the loop until the matching result: the call/result pair lets the stuck detector
        // say "the same call, made identically".
        //
        // This one stays at 300, not an oversight: it is a comparison key, not display. Lengthening
        // it would change the detector's sensitivity: two calls differing only beyond character 300
        // would stop being seen as identical.
        call: { id: b.id, tool: b.name, input: input.slice(0, 300), sub },
      });
    }
    // `b.text!`: a `text` block carries its text, the SDK's contract. The `!` keeps the old behaviour
    // to the letter: a `text` block without text threw, and still would.
    if (b.type === "text" && b.text!.trim()) {
      out.push({
        type: "text",
        // 20,000 since 08/09, after a measured loss. The cap was 2,000, chosen when an agent message
        // was a running commentary. It is also the last resort when tools die: session `-Nc3BM3P8S`,
        // a successful interview, then every `mcp__legion__*` failing; the agent spat its whole spec
        // into its final message, the only copy of two rounds of work, and the trace cut it
        // mid-sentence. A cap truncating the only copy of some work protects nothing.
        //
        // 20,000 characters, not infinity: this goes into the database, one row per text block, and
        // a chatty session makes dozens. An interview spec fits easily; a file dump does not, which
        // is the right split.
        payload: { text: b.text!.slice(0, 20_000), ...(parent ? { parent } : {}) },
        activity: `text: "${b.text!.trim().slice(0, 200)}"`,
        call: null,
      });
    }
  }
  return out;
}

/** The text a tool result carries, truncated like a `tool_start`'s input.
 *
 *  2,000 since 08/09, for the reason above: only failures arrive here, and an error message cut at
 *  300 characters loses precisely the part saying what to fix.
 *
 *  The SDK writes a `tool_result`'s content two ways, a bare string or typed blocks, and both occur
 *  in production. Reading only one would silence half the failures, the very defect being fixed.
 *
 *  @param block a `tool_result` block
 *  @returns empty if the result carries no readable text
 */
function resultText(block: ContentBlock): string {
  const content = block.content;
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((b) => b?.type === "text" && typeof b.text === "string")
            .map((b) => b.text)
            .join("\n")
        : "";
  return raw.trim().slice(0, 2_000);
}

/** Beyond this a successful result is data and leaves the trace. Measured on the notice that
 *  motivated the field: 297 characters, output file path included. The margin is there so the notice
 *  does not silently vanish the day the harness lengthens its sentence. */
const NOTICE_MAX = 600;

/** Tool results carried by a `user` message. A `user` message without a content array carries none:
 *  it is an ordinary human turn, injected by steering.
 *
 *  `error` carries only failures, and it was missing (08/09). The trace kept only the boolean: a
 *  refused tool and a successful one gave the same "done" line, and the refusal's reason existed
 *  nowhere. Session `yDGjmOVom2_u`: two `Bash` failures in sixteen milliseconds, the agent giving up
 *  saying "Bash is being denied here", and nothing in the trace saying by what, so nothing to fix.
 *
 *  `result` is a success's notice, missing for the same reason (10/09). A successful result is of two
 *  kinds: data (a file read, test output) that has no place in the trace, and a short harness notice
 *  that is sometimes the whole story. Session `o5yN0TxYJOsY`: `pnpm -s test` started at 12:07:46,
 *  closed "done" at exactly 12:09:46, the tool's timeout. The suite had not finished, it had been
 *  moved to the background, and the notice saying so ("Command did not complete within its 120s
 *  timeout and was moved to the background (ID: …)") was dropped. The next twenty trace lines show
 *  the agent reading an `.output` file nothing explains.
 *
 *  Length separates the two, not a recognised sentence: a notice fits in a few lines, data does not.
 *  Recognising the harness's wording would work better and silently stop working the day it
 *  changes, exactly the failure just paid for.
 */
export function toolResults(msg: ResultMessage) {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b.type === "tool_result")
    .map((b) => {
      const ok = !b.is_error;
      const error = ok ? "" : resultText(b);
      const text = ok ? resultText(b) : "";
      const result = text.length <= NOTICE_MAX ? text : "";
      return {
        toolUseId: b.tool_use_id,
        ok,
        ...(error ? { error } : {}),
        ...(result ? { result } : {}),
      };
    });
}

/** The subscription quota state, and the one decision it carries.
 *
 *  `rejected` means the window is exhausted: every following turn will be refused identically.
 *  Without this reading the SDK restarts the conversation (`init`) and retries in a loop; seen on
 *  24/08 on the i18n session: twenty minutes going in circles, eleven `init`s, nine refusals, before
 *  the CLI gave up.
 */
export function rateLimitFields(msg: { rate_limit_info?: RateLimitRead }) {
  const i: RateLimitRead = msg.rate_limit_info ?? {};
  return {
    // All the subscription information: status, utilisation, window type, wake-up.
    payload: {
      kind: "rate_limit",
      status: i.status,
      utilization: i.utilization,
      rateLimitType: i.rateLimitType,
      resetsAt: i.resetsAt,
    },
    exhausted: i.status === "rejected",
    window: i.rateLimitType ?? "unknown window",
  };
}
