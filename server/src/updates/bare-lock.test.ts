// The bare-mode lock in detail (02/09): the reading itself, on every log shape
// `scripts/self-update.ts` can leave behind. Only the `✓` / `⛔` markers matter, not the wording.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bareUpdateRunning } from "./bare-lock.js";

/** `ageMs` is the age of the last write (0: the script just wrote). */
function fakeDir(files: Record<string, string>, ageMs = 0) {
  return {
    listLogs: () => Object.keys(files),
    readLog: (_dir: string, name: string) => files[name] ?? "",
    logAgeMs: () => ageMs,
  };
}

describe("bare-mode lock: has the newest log finished talking?", () => {
  it("no log: no update ever attempted here", () => {
    assert.equal(bareUpdateRunning("/anywhere", fakeDir({})), false);
  });

  it("a missing real folder does not crash the reading", () => {
    // No `deps`: real fs functions, on a path that does not exist.
    assert.equal(bareUpdateRunning("/legion-test-missing-folder-xyz"), false);
  });

  it("a freshly created, still empty log: nothing announced, it is running", () => {
    const dir = fakeDir({ "2026-09-02T10-00-00-000Z.log": "" });
    assert.equal(bareUpdateRunning("d", dir), true);
  });

  it("a log being written: the last line is neither ✓ nor ⛔", () => {
    const dir = fakeDir({
      "2026-09-02T10-00-00-000Z.log":
        "[2026-09-02T10:00:00Z] Updating to v0.5.0.\n" +
        "[2026-09-02T10:00:01Z] — database copied: backup.db\n" +
        "[2026-09-02T10:00:02Z] — fetching tags\n",
    });
    assert.equal(bareUpdateRunning("d", dir), true);
  });

  it("a log ending with ✓: the update finished successfully", () => {
    const dir = fakeDir({
      "2026-09-02T10-00-00-000Z.log":
        "[2026-09-02T10:00:00Z] Updating to v0.5.0.\n" +
        "[2026-09-02T10:03:00Z] ✓ Update done: abc123 → v0.5.0.\n",
    });
    assert.equal(bareUpdateRunning("d", dir), false);
  });

  it("a log ending with ⛔: the update finished, failed", () => {
    const dir = fakeDir({
      "2026-09-02T10-00-00-000Z.log":
        "[2026-09-02T10:00:00Z] Updating to v0.5.0.\n" +
        "[2026-09-02T10:01:00Z] ⛔ FAILED (installing dependencies, code 1).\n",
    });
    assert.equal(bareUpdateRunning("d", dir), false);
  });

  it("an empty final line (file ending with newlines) does not fool the reading", () => {
    const dir = fakeDir({
      "2026-09-02T10-00-00-000Z.log":
        "[2026-09-02T10:03:00Z] ✓ Update done: abc123 → v0.5.0.\n\n\n",
    });
    assert.equal(bareUpdateRunning("d", dir), false);
  });

  it("an UNCLOSED log SILENT for a quarter hour is a corpse, not an update", () => {
    // The 02/09 case: a script killed by `kill -9` (or a restarting `tsx watch`) leaves a log
    // without ✓ or ⛔ forever, and the badge stayed lit.
    const dir = fakeDir(
      { "2026-09-02T10-00-00-000Z.log": "[2026-09-02T10:00:00Z] — fetching tags\n" },
      20 * 60_000,
    );
    assert.equal(bareUpdateRunning("d", dir), false);
  });

  it("a CLOSED log stays finished, even reread a second later", () => {
    const dir = fakeDir(
      {
        "2026-09-02T10-00-00-000Z.log": "[2026-09-02T10:03:00Z] ✓ Update done: x → v0.5.0.\n",
      },
      1_000,
    );
    assert.equal(bareUpdateRunning("d", dir), false);
  });

  it("SEVERAL LOGS: only the NEWEST counts, sorted by ISO timestamp", () => {
    const dir = fakeDir({
      // An OLD successful update...
      "2026-08-01T09-00-00-000Z.log": "[2026-08-01T09:00:00Z] ✓ Update done: x → v0.4.0.\n",
      // ...and a NEWER one still running.
      "2026-09-02T10-00-00-000Z.log": "[2026-09-02T10:00:00Z] — fetching tags\n",
    });
    assert.equal(bareUpdateRunning("d", dir), true);
  });
});
