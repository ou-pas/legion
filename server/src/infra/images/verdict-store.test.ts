// The store alone; the decision it feeds (`pickRunnerRow`) is tested in
// `sessions/runner/runner-health.test.ts`.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  latestImageVerdict,
  recordImageVerdict,
  resetImageVerdictStoreForTests,
} from "./verdict-store.js";

describe("verdict-store: the last image verdict, per (runner, image)", () => {
  beforeEach(() => resetImageVerdictStoreForTests());

  it("never recorded: `undefined`, not a disguised refusal", () => {
    assert.equal(latestImageVerdict("r1", "legion-session:latest"), undefined);
  });

  it("records then reads the verdict, reason included", () => {
    recordImageVerdict("r1", "legion-session:latest", { ok: false, why: "No such image" });
    const v = latestImageVerdict("r1", "legion-session:latest");
    assert.equal(v?.ok, false);
    assert.equal(v?.why, "No such image");
  });

  it("a different PROJECT image on the same machine does not answer for the default image", () => {
    recordImageVerdict("r1", "legion-session:custom", { ok: false, why: "No such image" });
    assert.equal(latestImageVerdict("r1", "legion-session:latest"), undefined);
  });

  it("a second verdict replaces the first: the LAST state counts", () => {
    recordImageVerdict("r1", "img", { ok: false, why: "missing" });
    recordImageVerdict("r1", "img", { ok: true });
    assert.equal(latestImageVerdict("r1", "img")?.ok, true);
  });
});
