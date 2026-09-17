// The four wake-ups and what they promise. Each text exists because a wrong one cost something: a
// re-clone promised that the wake-up no longer did, and "you were waiting for another Legion task"
// served to a session suspended by an update. A resume prompt is the only thing telling the agent
// what just happened to it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resumePrompt } from "./resume-prompt.js";

describe("resumePrompt: telling the TRUTH about the wake-up", () => {
  it("a human answered: their answer is quoted, nothing invented around it", () => {
    const p = resumePrompt({ answeredBy: "human", answer: "take option B" });
    assert.match(p, /The human answered your inbox question with: "take option B"/);
    assert.ok(!p.includes("workspace survived"), "the workspace is not the topic here");
  });

  it("causeless system wake-up: waiting for another task, the first historical case", () => {
    const p = resumePrompt({ answeredBy: "system", answer: "task t1 is done" });
    assert.match(p, /woke you up automatically/);
    assert.match(p, /task t1 is done/);
    assert.match(p, /workspace survived the pause/);
  });

  it("update: nobody asked for the stop, and a tool that failed just before is retried", () => {
    const p = resumePrompt({ answeredBy: "system", cause: "update", answer: "" });
    assert.match(p, /suspended you to update its control plane/);
    assert.match(p, /retry it/);
    assert.ok(!p.includes("waiting for another Legion task"), "it was not waiting for any task");
  });

  it("turn budget relaunch: moved, not interrupted, and the counter restarts at zero", () => {
    const p = resumePrompt({
      answeredBy: "system",
      cause: "relaunch",
      answer: "Automatic resume no. 2: 175 turns consumed",
    });
    assert.match(p, /hit its turn budget while making progress/);
    assert.match(p, /turn counter is back to zero/);
    assert.match(
      p,
      /Automatic resume no. 2: 175 turns consumed/,
      "the container's measurement, as is",
    );
    assert.ok(!p.includes("waiting for another Legion task"), "it was not waiting for anything");
    assert.match(p, /workspace survived the pause/, "the disk survived here too");
  });

  // Missing until 16/09. The full brief is not resent on resume: its attachments section vanished
  // with it, and a file attached DURING the pause reached nobody (the live notice is refused on a
  // destroyed container), leaving only a `log.warn`.
  it("repeats the brief's attachments, which the wake-up no longer resends", () => {
    const section = "## Brief attachments\nThe brief carries 1 attachment: capture.png";
    const reveils = [
      { answeredBy: "human" as const },
      { answeredBy: "system" as const },
      { answeredBy: "system" as const, cause: "update" as const },
      { answeredBy: "system" as const, cause: "relaunch" as const },
    ];
    for (const opts of reveils) {
      const p = resumePrompt({ ...opts, answer: "seen", attachments: section });
      assert.match(p, /capture\.png/, `wake-up ${opts.cause ?? opts.answeredBy}`);
    }
  });

  it("and adds nothing when there are none", () => {
    const p = resumePrompt({ answeredBy: "human", answer: "seen", attachments: null });
    assert.ok(!p.includes("Brief attachments"));
    // No gap left by a missing section, the same rule as the system prompt.
    assert.doesNotMatch(p, /\n\n\n/);
  });
});
