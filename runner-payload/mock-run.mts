// mock-run: the full plumbing, without a single credential.
//
// Split from session-runner on 06/09. A mock session talks to the control plane through the same
// channels as a real one (numbered events, file writes, inbox question, steering) and simply never
// calls the model. That verifies a chain, a goal or the steering channel end to end without spending
// a token. It shares nothing with `runReal`: it receives the runner's channels and uses them.

import type { CallInternal, PollSteers, Report, Sleep, UpdateTask } from "./runner-io.mjs";
import type { SessionSpec } from "./session-spec.mjs";

/** The spec and the runner's channels, nothing from the SDK: the model is never called. */
type MockIo = {
  spec: SessionSpec;
  report: Report;
  callInternal: CallInternal;
  updateTask: UpdateTask;
  pollSteers: PollSteers;
  sleep: Sleep;
  steerWaitMs: number;
};

/** How long a standalone mock session stays reachable, so steering can be checked without
 *  credentials. Long enough to type a sentence; cut short by the first message. Chain steps and
 *  goal rounds skip it: they must move on. */
const MOCK_STEER_WINDOW_MS = 15_000;

/** Listens up to `windowMs`, returns on the first delivery. */
async function collectSteers(
  { pollSteers, sleep, steerWaitMs }: Pick<MockIo, "pollSteers" | "sleep" | "steerWaitMs">,
  windowMs: number,
) {
  const deadline = Date.now() + windowMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return [];
    const msgs = await pollSteers(Math.min(left, steerWaitMs));
    if (msgs === null) return [];
    if (msgs.length) return msgs;
    // The server also returns `[]` on a hiccup: without this pause an outage would spin the loop.
    await sleep(300);
  }
}

export async function runMock(io: MockIo) {
  const { spec, report, callInternal, updateTask, sleep } = io;
  if (spec.resume) {
    await report("init", { model: spec.model, mock: true, resumed: true });
    await sleep(400);
    await report("text", {
      text: `Human answer received — resuming. (${spec.resume.prompt.slice(0, 120)})`,
    });
    await callInternal("/fs", {
      op: "write",
      path: `/agents/${spec.agentName}/mock-output.md`,
      content: `# Mock\nAnswer: ${spec.resume.prompt}\n`,
    });
    await report("tool_end", { tool: "fs_write", ok: true });
    const gate = await updateTask({ status: "done", note: "Mock resumed and finished." });
    if (!gate.ok) await updateTask({ status: "review", note: "Approval gate: left in review." });
    await report("result", { subtype: "success", costUsd: 0, mock: true });
    return;
  }
  await report("init", { model: spec.model, mock: true });
  await sleep(300);
  // Template steps: honor the artifact contract and finish without asking — so a whole
  // mock chain progresses end to end. Standalone tasks keep the ask/pause behavior.
  if ((spec.expectedArtifacts ?? []).length > 0) {
    for (const name of spec.expectedArtifacts) {
      const w = await callInternal("/fs", {
        op: "write",
        path: `${spec.artifactsPath}/${name}`,
        content: `# ${name}\n\nMock artifact for step "${spec.taskName}".\n`,
      });
      await report("tool_end", { tool: "fs_write", ok: w.ok });
      await sleep(150);
    }
    const gate = await updateTask({
      status: "done",
      note: `Mock step done — artifacts: ${spec.expectedArtifacts.join(", ")}`,
    });
    if (!gate.ok)
      await updateTask({ status: "review", note: "Approval gate: left in review for the human." });
    await report("result", { subtype: "success", costUsd: 0, mock: true });
    return;
  }
  // Goal-spawned mock tasks: produce a deliverable and finish — never block the loop on a question.
  if (spec.goalId) {
    const w = await callInternal("/fs", {
      op: "write",
      path: `${spec.artifactsPath}/goal-step-${spec.taskId}.md`,
      content: `# Goal step (mock)\n\n${spec.taskName}\n`,
    });
    await report("tool_end", { tool: "fs_write", ok: w.ok });
    await updateTask({
      status: "done",
      note: `Mock goal step done: ${spec.taskName.slice(0, 80)}`,
    });
    await report("result", { subtype: "success", costUsd: 0, mock: true });
    return;
  }
  // exercise the ACL: a granted write, then a deliberately un-granted delete
  const w2 = await callInternal("/fs", {
    op: "write",
    path: `/agents/${spec.agentName}/notes.md`,
    content: "hello",
  });
  await report("tool_end", { tool: "fs_write", ok: w2.ok });
  const d = await callInternal("/fs", { op: "delete", path: `/agents/${spec.agentName}/notes.md` });
  await report("text", {
    text: `fs_delete without a grant → ${d.status} (${d.body?.error ?? "refused"})`,
  });
  // Steering (v23): the session stays reachable for a while, and says so, so the channel can be
  // checked end to end without credentials: send "change course" while it runs and see it arrive
  // here.
  await report("text", {
    text: `Listening for ${MOCK_STEER_WINDOW_MS / 1000} s — you can tell me something.`,
  });
  for (const m of await collectSteers(io, MOCK_STEER_WINDOW_MS))
    await report("text", { text: `Message received, changing course: “${m.text}”` });
  // ask the human, then pause (the control plane flips us to waiting)
  await callInternal("/inbox", {
    kind: "choice",
    body: `Mock question for task “${spec.taskName}”: how do we carry on?`,
    choices: [
      { id: "a", label: "Option A — simple" },
      { id: "b", label: "Option B — complete" },
    ],
  });
  await report("text", { text: "Question sent — pausing." });
  process.exit(0);
}
