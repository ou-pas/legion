// Transmission, checked where it counts: an operator-attached file must reach the session's spec,
// as data (`spec.attachments`) and spelled out in the brief mounted in the prompt. An agent nobody
// told a screenshot awaits it will never read it: the defect this file closes, invisible when
// reading the code.
//
// Same harness as `review/review.test.ts`: a fake runner captures the provisioned spec.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-attachments-spec-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerTaskRoutes } = await import("./routes/index.js");
const { runTask } = await import("../sessions/runner/manager.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

type Spec = import("../sessions/runner/types.js").SessionSpec;
let provisioned: Spec | null = null;
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned = spec;
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

const app = new Hono();
registerTaskRoutes(app);

const PROJECT = "p1";
const AGENT = "a1";
const TASK = "t1";

const now = new Date();
db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: AGENT, projectId: PROJECT, name: "agent", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "local", kind: RUNNER_KIND.process }).run();
db.insert(schema.tasks)
  .values({
    id: TASK,
    projectId: PROJECT,
    name: "task",
    description: "The brief.",
    status: TASK_STATUS.todo,
    assigneeAgentId: AGENT,
    createdAt: now,
    updatedAt: now,
  })
  .run();

describe("the brief carries its attachments to the session", () => {
  it("lists them as data and names them in the brief, with the path to read", async () => {
    for (const [name, body] of [
      ["capture.png", "iVBORw0KGgo="],
      ["notes.md", Buffer.from("# read me").toString("base64")],
    ]) {
      const res = await app.request(`/api/tasks/${TASK}/attachments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, contentBase64: body }),
      });
      assert.equal(res.status, 201, await res.text());
    }

    await runTask(TASK);
    assert.ok(provisioned, "no session provisioned");
    const spec = provisioned;

    assert.deepEqual(
      spec.attachments.map((a) => a.name),
      ["capture.png", "notes.md"],
    );
    assert.equal(spec.attachments[0]?.kind, "image");
    assert.equal(spec.attachments[0]?.path, `${spec.artifactsPath}/attachments/capture.png`);

    // The brief says it: the half the spec alone does not replace.
    assert.match(spec.taskDescription, /## Brief attachments/);
    assert.match(spec.taskDescription, /capture\.png, notes\.md/);
    assert.match(spec.taskDescription, new RegExp(`${spec.artifactsPath}/attachments/notes\\.md`));
    // And it stays the brief: the original description still comes first.
    assert.ok(spec.taskDescription.startsWith("The brief."));
    // Attachments are inputs: they come before the artifacts contract, not after.
    assert.ok(
      spec.taskDescription.indexOf("## Brief attachments") <
        spec.taskDescription.indexOf("## Artifacts"),
      "inputs are read before the place to write deliverables",
    );
  });
});
