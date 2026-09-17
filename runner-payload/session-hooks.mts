// session-hooks: the two callbacks the SDK calls along the way.
//
// Split from `runReal` on 06/09. In-process hooks, not scripts on disk: they open no execution
// surface and are unrelated to the filesystem hooks `settingSources: ["project"]` makes readable.
//
// They do different jobs, and that difference is the point:
//
//  · `InstructionsLoaded` reports. Since native loading, what the server decided to send is no
//    longer what the agent received, and this hook is the only way to see the gap. It decides nothing.
//  · `PreToolUse` on Bash advises. It refused until 08/09; going back to advice is a decision, not a
//    surrender: the convention is still checked on every commit, so the `commits-conventionnels`
//    rule (2.1 kB in every prompt, on two projects) stays out of the prompt. A disagreement on form
//    just no longer costs a commit.
//
// The module also returns its `flush`: the batching window is `unref()`, so a session ending within
// half a second of a load would lose its trace without an explicit call at exit. That is precisely
// the short session one looks at to check native loading works.
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { adviceText, commitProblem } from "./commit-convention.mjs";
import type { Report } from "./runner-io.mjs";

/** An instruction load seen by the hook, waiting to be batched. */
type InstructionLoad = { path: string; reason: string; trigger: string | null };

/** A hook's input as this module reads it. Everything optional, and `unknown` where content depends
 *  on the tool: each hook reads a single field, and reading defensively keeps them silent rather than
 *  fatal when an SDK version renames a neighbour. */
type HookInput = {
  tool_input?: { command?: unknown };
  file_path?: unknown;
  load_reason?: unknown;
  trigger_file_path?: unknown;
};

/** `cwd` is the workspace, used to make paths relative in the trace. */
export function createSessionHooks({ cwd, report }: { cwd: string; report: Report }) {
  // v61: the instructions the session actually received, and when.
  //
  // The trace above says what the server decided to send. Since native loading that differs from
  // what the agent received: a file may arrive at startup, when a neighbouring file is opened
  // (`nested_traversal`), or because a glob matched (`path_glob_match`), or never arrive, which no
  // trace could show.
  //
  // Two measures against noise, since a read file is frequent:
  //
  //  · Dedup by path: a file is reported once per session; the first load is the interesting fact.
  //  · Batching window: startup instructions arrive in a burst (thirty-two rules would make
  //    thirty-two timeline lines in the same second). A 500 ms window renders them as one line and
  //    lets late discoveries, the informative ones, arrive alone.
  const instructionsSeen = new Set<string>();
  let instructionsPending: InstructionLoad[] = [];
  let instructionsTimer: NodeJS.Timeout | null = null;
  const flushInstructions = async () => {
    instructionsTimer = null;
    const batch = instructionsPending;
    instructionsPending = [];
    if (batch.length === 0) return;
    // The batch's first load carrying a trigger, found once: the search was written twice and the
    // second could not prove to the type what the first had just checked.
    const triggered = batch.find((i) => i.trigger);
    await report("capabilities", {
      instructions: batch.map((i) => i.path),
      // The reason makes the line useful: "loaded at startup" and "loaded because the agent opened a
      // .tsx" are different facts, and the second proves globs work.
      instructionsReason: [...new Set(batch.map((i) => i.reason))].join(", "),
      ...(triggered ? { instructionsTrigger: triggered.trigger } : {}),
    });
  };
  // v64: the commit convention, checked rather than hoped for. Checked, not enforced (08/09).
  //
  // This hook returned `permissionDecision: "deny"`: the commit did not happen and the agent had to
  // redo it. The convention is still conventionalcommits.org and still wanted; what changed is the
  // price. A refusal bought form for a model turn per mistake, and risked a blockage: on 05/09 the
  // heredoc form, Claude Code's default, was rejected, the agent gave up committing and checkpoints
  // collected its work. The module was fixed, but a guardrail whose failure costs a session's work
  // should not be a gate for the sake of a prefix.
  //
  // So the remark goes into the agent's context (`additionalContext`) and the commit goes through.
  // The agent reads, amends, continues; if not, history carries an imperfect message, which never
  // lost a line of code.
  //
  // Only what can be read is remarked on: commit-convention lets through a message outside the
  // command (`-F`), a reuse (`-C`), an `--amend --no-edit`; better miss a mistake than invent one.
  // Its header has the full reasoning.
  //
  // The trace always says it (`run_warning`), so the operator sees what went through now that
  // nothing is stopped.
  const onBashCommit = async (input: HookInput) => {
    const command = String(input?.tool_input?.command ?? "");
    const problem = commitProblem(command);
    if (!problem) return {};
    await report("run_warning", { message: `commit convention not followed: ${problem}` });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: adviceText(problem),
      },
    };
  };

  const onInstructionsLoaded = async (input: HookInput) => {
    const full = String(input?.file_path ?? "");
    if (!full || instructionsSeen.has(full)) return {};
    instructionsSeen.add(full);
    instructionsPending.push({
      // Relative to the workspace: the prefix is the one part the operator already knows.
      path: full.startsWith(`${cwd}/`) ? full.slice(cwd.length + 1) : full,
      reason: String(input?.load_reason ?? "?"),
      trigger: input?.trigger_file_path
        ? String(input.trigger_file_path).replace(`${cwd}/`, "")
        : null,
    });
    if (!instructionsTimer) {
      instructionsTimer = setTimeout(() => void flushInstructions(), 500);
      // The timer must not hold the process: a session done working does not wait half a second to
      // exit. The final flush is called explicitly.
      instructionsTimer.unref?.();
    }
    return {};
  };

  return {
    // The cast lives here and nowhere else, at the boundary where these readers become SDK
    // callbacks. The SDK describes a hook's input as a union of events, each with its own fields;
    // each reader reads one field without knowing which member arrives, and without that changing
    // what it does. Narrowing on the member would make them fatal the day the SDK renames a
    // neighbour, which `HookInput` above refuses.
    hooks: {
      InstructionsLoaded: [{ hooks: [onInstructionsLoaded] }],
      PreToolUse: [{ matcher: "Bash", hooks: [onBashCommit] }],
    } as Options["hooks"],
    flush: flushInstructions,
    cancel: () => {
      if (instructionsTimer) clearTimeout(instructionsTimer);
    },
  };
}
