// mcp-tools: what the session can call, and nothing else.
//
// Split from `runReal` on 06/09 without a behaviour change: 245 declarative lines (zod schemas and
// descriptions written for a model) stuck between repository cloning and the message loop. Nothing
// there depends on the runner's execution order, which made it the widest and safest cut.
//
// The descriptions are content, not documentation: the model reads them to decide what to call and
// with what. They travelled unchanged, including the paragraphs on why one form beats four questions.
//
// This module fetches nothing: the spec, both control plane channels, the pause, and even `tool` and
// `z` are passed in. `@anthropic-ai/claude-agent-sdk` and `zod` do not resolve from `runner-payload/`,
// which has no `node_modules` in the image (`NODE_PATH` points elsewhere); importing them would make
// the module unimportable from a server test, so uncheckable outside a container.
//
// The pause is a callback, not an `AbortController`: three tools want "return the result, then
// stop", and the runner says what that means for it.
import type { SdkMcpToolDefinition, tool as sdkTool } from "@anthropic-ai/claude-agent-sdk";
import fsSync from "node:fs";
import type { z as zod } from "zod";
import { resolveWritePayload } from "./fs-write-payload.mjs";
import type { CallInternal, UpdateTask } from "./runner-io.mjs";
import type { SessionSpec } from "./session-spec.mjs";

/** The SDK and zod as types only, which preserves the property above: an `import type` is erased at
 *  compile time, so the produced `.mjs` still loads neither package. They keep arriving as
 *  parameters. */
type SdkBindings = { tool: typeof sdkTool; z: typeof zod };

/** Return the tool's result, then pause the session. */
type Pause = () => void;

/** What a tool returns to the model. The SDK does not re-export it by name (`CallToolResult`, from
 *  the MCP package): it is derived from the signature the SDK declares, rather than depending on a
 *  package this folder does not install. */
type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition["handler"]>>;

/** The file operation shared by the five fs tools, as `makeFsTool` returns it. */
type FsTool = ReturnType<typeof makeFsTool>;

/** The tools every session carries: the task status, and the five file operations on the Legion
 *  space. They depend on no grant: without them a session has no way to hand in its work. */
function coreTools({
  tool,
  z,
  updateTask,
  fsTool,
}: SdkBindings & { updateTask: UpdateTask; fsTool: FsTool }) {
  return [
    tool(
      "update_task",
      "Update the Legion task status and/or append an activity note.",
      { status: z.enum(["doing", "review", "done"]).optional(), note: z.string().optional() },
      async (input) => {
        const res = await updateTask(input);
        return {
          content: [
            {
              type: "text",
              text: res.ok ? "ok" : `refused (${res.status}): ${JSON.stringify(res.body)}`,
            },
          ],
          isError: !res.ok && res.status !== 403,
        };
      },
    ),
    tool(
      "fs_list",
      "List a directory in the Legion persistent filesystem.",
      { path: z.string() },
      (i) => fsTool("list", i),
    ),
    tool(
      "fs_read",
      "Read a file from the Legion persistent filesystem. Text comes back as text; an image " +
        "(PNG/JPEG/GIF/WEBP) comes back as the picture itself, so use it on the brief's " +
        "attachments and on any screenshot — there is nothing else to call.",
      { path: z.string() },
      (i) => fsTool("read", i),
    ),
    tool(
      "fs_write",
      "Write a file to the Legion persistent filesystem (only inside your granted folders). " +
        "Text: pass `content`. Binary — including images (PNG/JPEG/GIF/WEBP) — pass `contentBase64` " +
        "(base64-encoded bytes) instead; decoded size is capped around 8 MB (screenshots are 200 KB-2 MB, " +
        "well under that). If the file already sits on disk in this container (e.g. a screenshot you " +
        "just resized with Bash), pass `localPath` instead of retyping it as base64 yourself — the runner " +
        "reads and encodes those bytes in code, so nothing has to be copied through your own output. " +
        "Provide exactly one of the three.",
      {
        path: z.string(),
        content: z.string().optional(),
        contentBase64: z.string().optional(),
        localPath: z.string().optional(),
      },
      (i) => fsTool("write", i),
    ),
    tool(
      "fs_mkdir",
      "Create a directory in the Legion persistent filesystem.",
      { path: z.string() },
      (i) => fsTool("mkdir", i),
    ),
    tool("fs_delete", "Delete a file (requires the delete grant).", { path: z.string() }, (i) =>
      fsTool("delete", i),
    ),
  ];
}

/** The blocking question. The session stops and resumes with the human's answer, so each call costs a
 *  full pause/resume cycle, which the description explains to the model, pushing it toward one form
 *  rather than four questions. */
function inboxAskTool({
  tool,
  z,
  callInternal,
  pause,
}: SdkBindings & { callInternal: CallInternal; pause: Pause }) {
  return tool(
    "inbox_ask",
    // `evidence` and `impact` are not decoration: without them the human must open the session to
    // understand the question, so the queue cannot be handled on the go (let alone from a phone). The
    // description is written so the model really fills them: what to put, and what not to.
    "Ask the human operator a blocking question. The session pauses and resumes with their answer. " +
      "Prefer 2-4 concrete choices. ALWAYS provide `evidence` and `impact`: the operator must be able " +
      "to decide from the question alone, without opening the session. " +
      "EACH CALL COSTS A FULL PAUSE/RESUME CYCLE: if you have several questions, ask them ALL AT ONCE " +
      "with `form` — markdown context, optional SVG diagrams, and typed fields. The answer comes back " +
      "as JSON keyed by your field ids.",
    {
      question: z.string(),
      choices: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
      form: z
        .object({
          blocks: z.array(
            z.union([
              z.object({ kind: z.literal("markdown"), text: z.string() }),
              z.object({ kind: z.literal("svg"), svg: z.string(), caption: z.string().optional() }),
              z.object({
                kind: z.literal("field"),
                field: z.object({
                  id: z
                    .string()
                    .describe("Stable key — the answer JSON uses it. [a-zA-Z0-9_-] only."),
                  label: z.string(),
                  type: z.enum(["text", "textarea", "number", "select", "radio", "checkbox"]),
                  required: z.boolean().optional(),
                  options: z
                    .array(z.object({ id: z.string(), label: z.string() }))
                    .optional()
                    .describe("Required for select/radio (2-12 options)."),
                  min: z.number().optional(),
                  max: z.number().optional(),
                  placeholder: z.string().optional(),
                  hint: z
                    .string()
                    .optional()
                    .describe(
                      "One line under the field: WHY you would lean that way. On a choice question this is " +
                        "your recommendation and its reason — never leave it empty, a question without a " +
                        "recommendation makes the human do your reasoning.",
                    ),
                  default: z
                    .union([z.string(), z.number(), z.boolean()])
                    .optional()
                    .describe(
                      "Pre-fills the control with YOUR recommended answer: the option id for radio/select, " +
                        "a boolean for checkbox. The human overrides it freely — it turns N cold decisions " +
                        "into one review. A default that matches no option is refused.",
                    ),
                }),
              }),
            ]),
          ),
        })
        .optional()
        .describe(
          "A rich multi-question form shown in the operator's inbox: interleave markdown blocks, SVG " +
            "diagrams and typed fields (1-12 fields). SVG RULES — always set a viewBox; draw with " +
            "currentColor (it inherits the app theme, dark mode included), never hard-coded colors; " +
            "no <script>, no <foreignObject>, no external href (the diagram is sanitized at render). " +
            "Use a form INSTEAD of several inbox_ask calls: one pause instead of N. " +
            "Do NOT add a 'why?' text field after a choice question: the UI already offers a comment " +
            "box under every choice, and you get it back as `<fieldId>__note` when the human wrote one.",
        ),
      evidence: z
        .string()
        .optional()
        .describe(
          "What you actually READ that led here: file paths with line numbers, the exact snippet, " +
            "the command output. Quote, do not summarise. Never invent a reference you did not open.",
        ),
      impact: z
        .string()
        .optional()
        .describe(
          "What the answer will touch: which files, which repos, whether it is reversible, " +
            "and what breaks if the operator picks wrong. One or two sentences.",
        ),
      approval: z
        .boolean()
        .optional()
        .describe(
          "TRUE only when you are asking for PERMISSION to act — the right to run a destructive " +
            "command, to touch something outside your scope, to spend beyond a budget. The session " +
            "then stops as BLOCKED and only the human can release it: no automation may answer in " +
            "their place. A request for information, an opinion or a choice between options is NOT " +
            "an approval — leave this out.",
        ),
    },
    async ({ question, choices, form, evidence, impact, approval }) => {
      const res = await callInternal("/inbox", {
        kind: form ? "form" : choices?.length ? "choice" : "text",
        body: question,
        choices,
        form,
        evidence,
        impact,
        approval,
      });
      if (res.ok) {
        pause();
        return {
          content: [
            {
              type: "text",
              text: "Question sent. The session will now pause until the human answers.",
            },
          ],
        };
      }
      // A form refusal (400) is named by the server: relay it as is, so the model fixes its spec
      // instead of blindly retrying the same one.
      const reason = res.body?.error ? ` — ${res.body.error}` : "";
      return {
        content: [{ type: "text", text: `inbox unavailable (${res.status})${reason}` }],
        isError: true,
      };
    },
  );
}

/** The message that does not block. */
function inboxSendTool({ tool, z, callInternal }: SdkBindings & { callInternal: CallInternal }) {
  return tool(
    "inbox_send",
    "Send a non-blocking information message to the human operator.",
    { message: z.string() },
    async ({ message }) => {
      const res = await callInternal("/inbox", {
        kind: "text",
        body: message,
        informational: true,
      });
      return { content: [{ type: "text", text: res.ok ? "sent" : "failed" }] };
    },
  );
}

/** The boundary relay (23/08): file for the human the work found outside one's scope, instead of
 *  leaving a contract asleep in an artifacts folder. The proposed task is always created in "later"
 *  (never started, never assigned); `agentName` is only a suggestion the human reads. */
function proposeTaskTool({ tool, z, callInternal }: SdkBindings & { callInternal: CallInternal }) {
  return tool(
    "propose_task",
    "Propose a new task for the human to review — for work discovered outside your scope " +
      "(e.g. a boundary contract you just wrote to your artifacts). Creates the task in the " +
      "'later' column, never assigned, never queued, never started automatically: a human " +
      "decides to keep, refine, or delete it. Capped per session — do not use this for status " +
      "updates, use inbox_send for those. If the work you are depositing must land BEFORE " +
      "what you are doing can actually work, set blocking: true.",
    {
      name: z
        .string()
        .describe("Short, explicit title — e.g. 'Web relay: model probe (contract)'."),
      brief: z
        .string()
        .describe(
          "What the human/next agent needs. If this relays a boundary contract, POINT to it: " +
            "artifact path + originating task, and summarise what is expected.",
        ),
      complexity: z.enum(["low", "med", "high"]).optional(),
      agentName: z
        .string()
        .optional()
        .describe(
          "Suggested agent for this task — a suggestion only, the human makes the final call. " +
            "It MUST be one of the agents that actually exist in this project: do not invent a " +
            "name. If you are not sure of the exact names, omit this field — an unknown name is " +
            "dropped by the server and helps nobody.",
        ),
      // "this must land before" (25/08), the case the tool could not express. Without it an agent
      // discovering a prerequisite could only say "there is more work", and its own work went to
      // review as if usable.
      blocking: z
        .boolean()
        .optional()
        .describe(
          "Set true when the task you are depositing is a PREREQUISITE: what you are currently " +
            "building cannot actually work until it lands (e.g. you just wrote a UI against " +
            "server routes that do not exist). Your current task is then marked blocked by the " +
            "new one, so the board stops presenting your work as finished. It still does not " +
            "start anything: the new task stays in 'later', unassigned. Use wait_for_task if " +
            "you want to sleep until it is done instead of finishing what you can.",
        ),
      // Ordering between deposits (08/09): `blocking` says "before my task", `blockerIds` says "before
      // this deposit". An agent depositing several tasks at once had no way to write their order.
      blockerIds: z
        .array(z.string())
        .optional()
        .describe(
          "Task ids that must land BEFORE the one you are depositing now. Only ids of tasks YOU " +
            "deposited earlier in this session are accepted (this tool returns each id when it " +
            "creates the task): deposit the prerequisites first, keep their ids, then list them " +
            "here. Use this when one deposit is worthless until another lands — e.g. proof-reading " +
            "translations that do not exist yet. To make your CURRENT task wait instead, use " +
            "blocking. Rejected if a listed task is already done, or if the link would form a cycle.",
        ),
      // The remainder of a partial slice (spec "decoupe", behaviour 10). The server has accepted this
      // field since slice 04 and validates it like a slice, but the tool did not offer it, so an agent
      // could not deposit a remainder carrying its contract. A task deposited with criteria becomes a
      // gated step.
      criteria: z
        .object({
          validatedBy: z
            .string()
            .describe("The exact command someone else runs to see what you saw."),
          items: z
            .array(
              z.object({
                text: z.string().describe("A behaviour someone could watch happen."),
                mode: z.enum(["test", "property", "check", "human", "waived"]),
                edge: z
                  .string()
                  .optional()
                  .describe("For mode 'property' only: the edge it covers, e.g. B4/empty."),
              }),
            )
            .describe("One to three criteria. Four is refused."),
        })
        .optional()
        .describe(
          "Only when you are depositing the REMAINDER of a slice you could not finish: the " +
            "criteria you did not meet, with their modes, and the slice's validation command. " +
            "The deposited task then carries that contract and is terminated by the operator, " +
            "not by its agent. Leave it out for ordinary out-of-scope work.",
        ),
    },
    async ({ name, brief, complexity, agentName, blocking, blockerIds, criteria }) => {
      const res = await callInternal("/propose-task", {
        name,
        brief,
        complexity,
        agentName,
        blocking,
        blockerIds,
        criteria,
      });
      // The warning (unknown agent name, suggestion dropped) goes back to the model: the task is
      // created, but it must know its suggestion served nothing.
      if (res.ok)
        return {
          content: [
            {
              type: "text",
              text:
                `Task proposed (later, unassigned): ${res.body?.taskId ?? ""}` +
                (blockerIds?.length
                  ? ` — it waits for ${blockerIds.length} earlier deposit(s)`
                  : "") +
                (res.body?.blocked ? " — your current task is now marked BLOCKED by it" : "") +
                (res.body?.warning ? ` — WARNING: ${res.body.warning}` : ""),
            },
          ],
        };
      return {
        content: [
          { type: "text", text: `propose_task refused (${res.status}): ${res.body?.error ?? ""}` },
        ],
        isError: true,
      };
    },
  );
}

/** The counterpart of the previous one (v26): deposit a task and sleep until it is done. */
function waitForTaskTool({
  tool,
  z,
  callInternal,
  pause,
}: SdkBindings & { callInternal: CallInternal; pause: Pause }) {
  return tool(
    "wait_for_task",
    // Without this tool an agent blocked by a dependency had two ways out: finish half-done, or
    // bother the human to call it back later. The pause is the inbox's, already proven: container
    // destroyed (zero cost while waiting), conversation context kept, workspace kept (D13) and
    // branches refetched on wake-up, so the awaited merge is there, and node_modules too.
    "Go to sleep until another Legion task is done, then resume automatically with its result. " +
      "Use this when you are BLOCKED by work outside your scope (typically a task you just " +
      "created with propose_task): instead of finishing half-done, pause here and continue " +
      "later with your context intact. The container is destroyed while you sleep (zero cost) " +
      "but your workspace survives it: your repositories (and node_modules) are still on disk " +
      "when you wake up, with their branches fetched and fast-forwarded, so merged work is there. " +
      "Refused if it would create a dependency cycle. If the task is already done you get its " +
      "result immediately without pausing. One active wait per session. A human can always wake " +
      "you earlier, or tell you to give up.",
    {
      taskId: z
        .string()
        .describe("The Legion task id to wait for — e.g. the id returned by propose_task."),
      note: z
        .string()
        .optional()
        .describe(
          "Why you are waiting, in one sentence — shown to the human in the Inbox. " +
            "State what you need FROM that task (e.g. 'I need the POST /api/x route').",
        ),
    },
    async ({ taskId, note }) => {
      const res = await callInternal("/wait-for-task", { taskId, note });
      if (!res.ok)
        return {
          content: [
            {
              type: "text",
              text: `wait_for_task refused (${res.status}): ${res.body?.error ?? ""}`,
            },
          ],
          isError: true,
        };
      // Already done: no pause, the result arrives at once as an ordinary conversation turn.
      if (res.body?.waiting === false)
        return {
          content: [{ type: "text", text: String(res.body?.result ?? "Task already done.") }],
        };
      pause();
      return {
        content: [
          {
            type: "text",
            text:
              `Waiting for task ${taskId}. This session pauses now and will resume ` +
              `automatically when that task is done (or if a human wakes you earlier).`,
          },
        ],
      };
    },
  );
}

/** The missing repository (09/09). An agent discovering its work lives in a project repository it
 *  was not granted had two moves: clone it itself (a clone never pushed, erased at the next wake-up:
 *  task ZsbmD_N-zS, two commits lost), or ask a question whose "yes" granted nothing. Here the
 *  request is a grant: if the human grants it, the repository is set on the agent before the resume,
 *  and the wake-up clones it next to the others. */
function requestRepoTool({
  tool,
  z,
  callInternal,
  pause,
}: SdkBindings & { callInternal: CallInternal; pause: Pause }) {
  return tool(
    "request_repo",
    "Ask the operator to GRANT you another repository of this project, when the work you were given " +
      "actually lives there. NEVER `git clone` a repository yourself: a clone you make is never pushed " +
      "and is erased at the next wake-up. The session pauses (blocked, only a human can answer); if " +
      "granted, the repository is cloned into /workspace/repos/<name> on the task branch when you " +
      "resume, and you commit there like in any granted repository. If refused, do without it or " +
      "stop and say so in your report.",
    {
      repo: z
        .string()
        .describe(
          "The repository NAME as the project declares it (e.g. 'acme-argo-apps'), not a URL.",
        ),
      why: z
        .string()
        .describe(
          "What you found that lives there: file paths, the spec section, the command output. " +
            "The operator decides from this alone.",
        ),
    },
    async ({ repo, why }) => {
      const res = await callInternal("/request-repo", { repo, why });
      if (!res.ok)
        return {
          content: [
            {
              type: "text",
              text: `request_repo refused (${res.status}): ${res.body?.error ?? ""}`,
            },
          ],
          isError: true,
        };
      pause();
      return {
        content: [
          {
            type: "text",
            text: `Grant requested for "${repo}". The session pauses until the operator decides.`,
          },
        ],
      };
    },
  );
}

/** The file operations, as the control plane names them on `/fs`. */
type FsOp = "list" | "read" | "write" | "mkdir" | "delete";

/** What a file tool carries. Only a write has content, and `resolveWritePayload` decides which of
 *  the three fields counts. */
type FsInput = { path: string; content?: string; contentBase64?: string; localPath?: string };

/** What the control plane returns on `/fs`: a string for text or a listing, an encoded object when the
 *  server recognised an image. The server decides, by extension. */
type FsResult = string | { contentBase64?: string; mimeType?: string } | null;

/** The step shared by the file tools: payload decision for a write, the `/internal` call, and
 *  returning an image as an image block rather than spat-out base64. */
function makeFsTool(callInternal: CallInternal) {
  async function fsTool(op: FsOp, input: FsInput): Promise<ToolResult> {
    // `sent`, not `input`: what a write sends is no longer the model's call but what
    // `resolveWritePayload` made of it. Reassigning the parameter hid that.
    let sent: Record<string, unknown> = input;
    if (op === "write") {
      // See fs-write-payload's header: `localPath` lets this process read and encode bytes already
      // on the container's disk instead of the model retyping base64 (three truncated files out of
      // three at 3.5 kB on 04/09).
      const resolved = resolveWritePayload(input, (p) => fsSync.readFileSync(p));
      if (!resolved.ok)
        return { content: [{ type: "text", text: resolved.reason }], isError: true };
      sent = resolved.payload;
    }
    const res = await callInternal("/fs", { op, ...sent });
    if (!res.ok)
      return {
        content: [{ type: "text", text: `denied (${res.status}): ${res.body?.error ?? ""}` }],
        isError: op !== "delete" && res.status !== 403,
      };
    const result = res.body?.result as FsResult;
    // Reading an image returns the image (slice "the brief carries attachments"). The server decides
    // by extension and returns encoded bytes rather than a "utf8" string that would be garbage. They
    // go back to the model as an image block: base64 spat out as text would fill the context window
    // without showing anything. That makes a screenshot attached to the brief really viewable, with
    // the same `fs_read` as a `.md`.
    if (
      result &&
      typeof result === "object" &&
      typeof result.contentBase64 === "string" &&
      typeof result.mimeType === "string" &&
      result.mimeType.startsWith("image/")
    )
      return {
        content: [{ type: "image", data: result.contentBase64, mimeType: result.mimeType }],
      };
    return {
      content: [
        { type: "text", text: typeof result === "string" ? result : JSON.stringify(result ?? {}) },
      ],
    };
  }
  return fsTool;
}

/** This session's tools, ready for `createSdkMcpServer`. `spec.inboxEnabled` decides whether the five
 *  inbox tools are included. */
export function buildTools({
  tool,
  z,
  spec,
  callInternal,
  updateTask,
  pause,
}: SdkBindings & {
  spec: Pick<SessionSpec, "inboxEnabled">;
  callInternal: CallInternal;
  updateTask: UpdateTask;
  pause: Pause;
}) {
  const sdk = { tool, z };
  const fsTool = makeFsTool(callInternal);
  // The schema parameter is left open, as the SDK itself does for `createSdkMcpServer`'s `tools`
  // option: each tool has its own and a list cannot carry them all.
  // `any` is the right type here, a named exception rather than a shortcut (14/09, when
  // `runner-payload/` came under the linter). Each tool carries its zod schema in the shape
  // parameter, so the list is heterogeneous by construction and `createSdkMcpServer` consumes it as
  // is. `never` does not compile, nor does `unknown`, and an eleven-member union would be rewritten
  // with every new tool without proving anything: this list only carries, it calls none of its items.
  // oxlint-disable-next-line typescript/no-explicit-any
  const tools: SdkMcpToolDefinition<any>[] = coreTools({ ...sdk, updateTask, fsTool });
  // The inbox is a grant, not a default: without it an agent can neither interrupt the human, deposit
  // a task, sleep on a dependency nor request a repository. These tools then do not exist, rather
  // than exist and refuse: a tool that always says "no" teaches the model to call it again.
  if (spec.inboxEnabled) {
    tools.push(
      inboxAskTool({ ...sdk, callInternal, pause }),
      inboxSendTool({ ...sdk, callInternal }),
      proposeTaskTool({ ...sdk, callInternal }),
      waitForTaskTool({ ...sdk, callInternal, pause }),
      requestRepoTool({ ...sdk, callInternal, pause }),
    );
  }
  return tools;
}
