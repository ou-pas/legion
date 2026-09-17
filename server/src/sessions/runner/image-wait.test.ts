// Five tasks that fell together are one failure, not five (12/09).
//
// The registry probes nothing and writes nowhere: what is checked here is its only rule, the key
// is `(runnerId, image)` and the grace period counts from the FIRST refusal.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  clearImageWaits,
  forgetImageWait,
  imageWaitOfTask,
  imageWaits,
  markImageWaitRebuilding,
  noteImageAbsent,
  overdueImageWaits,
  tasksWaitingForImage,
  IMAGE_WAIT_GRACE_MS,
} from "./image-wait.js";

const absence = (taskId: string, over: { runnerId?: string; image?: string } = {}) => ({
  runnerId: over.runnerId ?? "run-1",
  runnerName: "mini-atelier",
  image: over.image ?? "legion-session:latest",
  projectId: "proj-1",
  taskId,
});

describe("waiting for an image", () => {
  beforeEach(() => clearImageWaits());

  it("gathers every task that fell on the same machine under ONE wait", () => {
    const first = noteImageAbsent(absence("t1"));
    const next = ["t2", "t3", "t4", "t5"].map((id) => noteImageAbsent(absence(id)));

    assert.equal(first.opened, true);
    assert.deepEqual(
      next.map((r) => r.opened),
      [false, false, false, false],
    );
    assert.equal(imageWaits().length, 1);
    assert.deepEqual([...tasksWaitingForImage()].sort(), ["t1", "t2", "t3", "t4", "t5"]);
  });

  it("separates two images on the same machine, and two machines on the same image", () => {
    noteImageAbsent(absence("t1"));
    noteImageAbsent(absence("t2", { image: "project-x:latest" }));
    noteImageAbsent(absence("t3", { runnerId: "run-2" }));

    assert.equal(imageWaits().length, 3);
    assert.equal(imageWaitOfTask("t2")?.image, "project-x:latest");
    assert.equal(imageWaitOfTask("t3")?.runnerId, "run-2");
  });

  it("returns the wait holding a task, and nothing for a free task", () => {
    noteImageAbsent(absence("t1"));

    assert.equal(imageWaitOfTask("t1")?.image, "legion-session:latest");
    assert.equal(imageWaitOfTask("t9"), null);
  });

  it("carries the rebuilding state for every task in the wait", () => {
    noteImageAbsent(absence("t1"));
    noteImageAbsent(absence("t2"));

    markImageWaitRebuilding("run-1", "legion-session:latest", true);

    assert.equal(imageWaitOfTask("t1")?.rebuilding, true);
    assert.equal(imageWaitOfTask("t2")?.rebuilding, true);
  });

  it("frees all its tasks when the wait is lifted", () => {
    noteImageAbsent(absence("t1"));
    noteImageAbsent(absence("t2"));

    const freed = forgetImageWait("run-1", "legion-session:latest");

    assert.deepEqual(freed?.taskIds.sort(), ["t1", "t2"]);
    assert.equal(tasksWaitingForImage().size, 0);
    assert.equal(forgetImageWait("run-1", "legion-session:latest"), null);
  });

  it("counts the grace period from the FIRST refusal, not the last", () => {
    noteImageAbsent(absence("t1"), 1_000);
    noteImageAbsent(absence("t2"), 1_000 + IMAGE_WAIT_GRACE_MS);

    assert.deepEqual(overdueImageWaits(1_000 + IMAGE_WAIT_GRACE_MS - 1), []);
    assert.equal(overdueImageWaits(1_000 + IMAGE_WAIT_GRACE_MS).length, 1);
  });

  it("a rebuild started along the way does not reset the clock", () => {
    noteImageAbsent(absence("t1"), 0);
    markImageWaitRebuilding("run-1", "legion-session:latest", true);

    assert.equal(overdueImageWaits(IMAGE_WAIT_GRACE_MS).length, 1);
  });
});
