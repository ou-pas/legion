// The missing-image rebuild question (12/09):
//
//  1. One question per machine and image, deduplicated in the database (survives a restart).
//  2. No assigned agent, no question.
//  3. The question names the tasks it holds back.
//  4. An unreadable JSON column does not break reading the queue.
//  5. No rebuild on a sentence: only `rebuild` and `park` decide, never `retry`, which would rerun
//     the task against the still-missing image.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-image-rebuild-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  askImageRebuild,
  closeImageRebuildQuestions,
  imageRebuildBody,
  imageRebuildDecision,
  imageRebuildTargetOf,
  IMAGE_REBUILD_CHOICE,
} = await import("./image-rebuild.js");
const { INBOX_STATUS } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

type Target = import("./image-rebuild.js").ImageRebuildTarget;

const TARGET: Target = {
  runnerId: "r1",
  runnerName: "mini-atelier",
  image: "legion-session-p1",
  projectId: "p1",
};

const now = new Date();

function reset() {
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: "p1", name: "p1", slug: "p1", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: "a1", projectId: "p1", name: "server", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners)
    .values({ id: "r1", name: "mini-atelier", kind: RUNNER_KIND.docker })
    .run();
}

/** A task and its refused preflight session: the entry references a session (foreign key).
 *  `assigned` decides whether the question goes out. */
function task(id: string, assigned = true) {
  db.insert(schema.tasks)
    .values({
      id,
      projectId: "p1",
      name: `task ${id}`,
      assigneeAgentId: assigned ? "a1" : null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: `s-${id}`,
      taskId: id,
      agentId: "a1",
      runnerId: "r1",
      model: "m",
      status: "failed",
      callbackToken: "tok",
      mock: true,
      startedAt: now,
    })
    .run();
}

const openRows = () =>
  db
    .select()
    .from(schema.inboxMessages)
    .where(eq(schema.inboxMessages.status, INBOX_STATUS.open))
    .all();

describe("question body", () => {
  it("names the held tasks rather than counting them", () => {
    const body = imageRebuildBody(TARGET, ["rail cleanup", "volume purge"]);
    assert.match(body, /“rail cleanup”, “volume purge”/);
    assert.match(body, /“legion-session-p1”/);
    assert.match(body, /“mini-atelier”/);
  });

  it("says no task is waiting", () => {
    assert.match(imageRebuildBody(TARGET, []), /no task for now/);
  });
});

describe("target read from an entry", () => {
  it("reads back as written", () => {
    assert.deepEqual(imageRebuildTargetOf({ imageRebuild: JSON.stringify(TARGET) }), TARGET);
  });

  it("is null when the entry has none", () => {
    assert.equal(imageRebuildTargetOf({ imageRebuild: null }), null);
  });

  it("is null on unreadable JSON, without throwing", () => {
    assert.equal(imageRebuildTargetOf({ imageRebuild: "{not json" }), null);
  });
});

describe("what the answer asks for", () => {
  const row = { imageRebuild: JSON.stringify(TARGET) };

  it("rebuild", () => {
    assert.deepEqual(imageRebuildDecision(row, IMAGE_REBUILD_CHOICE.rebuild), {
      target: TARGET,
      choice: "rebuild",
    });
  });

  it("park the tasks", () => {
    assert.deepEqual(imageRebuildDecision(row, IMAGE_REBUILD_CHOICE.park), {
      target: TARGET,
      choice: "park",
    });
  });

  it("nothing, on free text without a choice", () => {
    assert.equal(imageRebuildDecision(row, undefined), null);
  });

  it("nothing, on another choice: retry would rerun into the loop", () => {
    assert.equal(imageRebuildDecision(row, "retry"), null);
  });

  it("nothing, when the entry had no target", () => {
    assert.equal(imageRebuildDecision({ imageRebuild: null }, IMAGE_REBUILD_CHOICE.rebuild), null);
  });
});

describe("asking the question", () => {
  beforeEach(reset);

  it("writes it once, with its target and two choices", () => {
    task("t1");
    const id = askImageRebuild(TARGET, { taskId: "t1", taskIds: ["t1"] });
    assert.ok(id);

    const rows = openRows();
    assert.equal(rows.length, 1);
    assert.deepEqual(imageRebuildTargetOf(rows[0]!), TARGET);
    const choices = JSON.parse(rows[0]!.choices!) as { id: string }[];
    assert.deepEqual(
      choices.map((c) => c.id),
      [IMAGE_REBUILD_CHOICE.rebuild, IMAGE_REBUILD_CHOICE.park],
    );
    assert.match(rows[0]!.body, /“task t1”/);
  });

  it("stays silent when the same machine and image already have an open question", () => {
    task("t1");
    task("t2");
    assert.ok(askImageRebuild(TARGET, { taskId: "t1", taskIds: ["t1"] }));
    assert.equal(askImageRebuild(TARGET, { taskId: "t2", taskIds: ["t2"] }), null);
    assert.equal(openRows().length, 1);
  });

  it("asks again for another image on the same machine", () => {
    task("t1");
    task("t2");
    assert.ok(askImageRebuild(TARGET, { taskId: "t1", taskIds: ["t1"] }));
    assert.ok(
      askImageRebuild({ ...TARGET, image: "legion-browser" }, { taskId: "t2", taskIds: ["t2"] }),
    );
    assert.equal(openRows().length, 2);
  });

  it("stays silent for a task without an assigned agent", () => {
    task("t1", false);
    assert.equal(askImageRebuild(TARGET, { taskId: "t1", taskIds: ["t1"] }), null);
    assert.equal(openRows().length, 0);
  });

  it("stays silent for a task that does not exist", () => {
    assert.equal(askImageRebuild(TARGET, { taskId: "ghost", taskIds: [] }), null);
    assert.equal(openRows().length, 0);
  });
});

describe("closing questions once the wait is lifted", () => {
  beforeEach(reset);

  it("closes the one for this machine and image, leaves others open", () => {
    task("t1");
    task("t2");
    askImageRebuild(TARGET, { taskId: "t1", taskIds: ["t1"] });
    askImageRebuild({ ...TARGET, image: "legion-browser" }, { taskId: "t2", taskIds: ["t2"] });

    closeImageRebuildQuestions({ runnerId: "r1", image: "legion-session-p1" });

    const still = openRows();
    assert.equal(still.length, 1);
    assert.equal(imageRebuildTargetOf(still[0]!)?.image, "legion-browser");
  });

  it("closes without answering: nobody decided", () => {
    task("t1");
    const id = askImageRebuild(TARGET, { taskId: "t1", taskIds: ["t1"] })!;
    closeImageRebuildQuestions(TARGET);

    const row = db
      .select()
      .from(schema.inboxMessages)
      .where(eq(schema.inboxMessages.id, id))
      .get()!;
    assert.equal(row.status, INBOX_STATUS.closed);
    assert.equal(row.selectedChoiceId, null);
  });

  it("touches nothing when no question is open", () => {
    closeImageRebuildQuestions(TARGET);
    assert.equal(openRows().length, 0);
  });
});
