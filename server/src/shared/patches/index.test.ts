// The runner's mechanics (replay, isolation, surviving a failure) on test patches, independent of
// the real registry. The first patch has its own test file.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-patches-"));
process.env.LEGION_DB = join(dir, "unused.db");
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { runPatches } = await import("./index.js");
const { steps: s71 } = await import("../migrations/v71-v75.js");

let n = 0;

/** A database with the `patches` table (v75) and a sandbox table to observe writes. */
function freshDb(): Database.Database {
  const sqlite = new Database(join(dir, `run-${++n}.db`));
  s71.find(([version]) => version === 75)![1](sqlite);
  sqlite.exec("CREATE TABLE trace (word TEXT)");
  return sqlite;
}

/** A patch writing its name into `trace`. */
const writes = (id: string) => ({
  id,
  apply: (sqlite: Database.Database) =>
    void sqlite.prepare("INSERT INTO trace (word) VALUES (?)").run(id),
});

const trace = (sqlite: Database.Database): string[] =>
  (sqlite.prepare("SELECT word FROM trace").all() as { word: string }[]).map((r) => r.word);

const played = (sqlite: Database.Database): string[] =>
  (sqlite.prepare("SELECT id FROM patches ORDER BY id").all() as { id: string }[]).map((r) => r.id);

describe("runPatches, what runs and what is recorded", () => {
  it("runs in array order and records each patch", () => {
    const sqlite = freshDb();

    const run = runPatches(sqlite, [writes("a"), writes("b")]);

    assert.deepEqual(run.ran, ["a", "b"]);
    assert.deepEqual(run.failed, []);
    assert.deepEqual(trace(sqlite), ["a", "b"], "array order is application order");
    assert.deepEqual(played(sqlite), ["a", "b"]);
  });

  it("does not rerun a patch already run", () => {
    const sqlite = freshDb();
    runPatches(sqlite, [writes("a")]);

    const second = runPatches(sqlite, [writes("a"), writes("b")]);

    assert.deepEqual(second.ran, ["b"], "only the new patch runs");
    assert.deepEqual(trace(sqlite), ["a", "b"], "without `patches`, `a` would rewrite every boot");
    // Nor is `a` reported as failed: without the filter its mark would violate the primary key and
    // the boot would complain about a patch with nothing to do. The key protects the data; the
    // filter protects the report.
    assert.deepEqual(second.failed, [], "a patch already run is not rerun, so never rejected");
  });
});

describe("runPatches, a failing patch", () => {
  /** Writes then throws: the only shape that proves the transaction. */
  const writesThenThrows = (id: string) => ({
    id,
    apply: (sqlite: Database.Database) => {
      sqlite.prepare("INSERT INTO trace (word) VALUES (?)").run(id);
      throw new Error(`${id} went wrong`);
    },
  });

  it("is not marked as run and leaves no half-done work", () => {
    const sqlite = freshDb();

    const run = runPatches(sqlite, [writesThenThrows("a")]);

    assert.deepEqual(run.ran, []);
    assert.deepEqual(run.failed, [{ id: "a", why: "a went wrong" }]);
    assert.deepEqual(played(sqlite), [], "marking a failed patch would make it unrecoverable");
    assert.deepEqual(trace(sqlite), [], "the runner's transaction rolls back its writes");
  });

  it("does not bring down the next patch", () => {
    const sqlite = freshDb();

    const run = runPatches(sqlite, [writesThenThrows("a"), writes("b")]);

    assert.deepEqual(run.ran, ["b"]);
    assert.deepEqual(
      run.failed.map((f) => f.id),
      ["a"],
    );
    assert.deepEqual(trace(sqlite), ["b"], "each in its own transaction");
    assert.deepEqual(played(sqlite), ["b"]);
  });

  it("replays at the next boot and succeeds once the cause is gone", () => {
    const sqlite = freshDb();
    runPatches(sqlite, [writesThenThrows("a")]);

    // Next boot with the fixed patch: never marked, so it runs again.
    const again = runPatches(sqlite, [writes("a")]);

    assert.deepEqual(again.ran, ["a"]);
    assert.deepEqual(trace(sqlite), ["a"]);
  });

  it("keeps the boot alive: `runPatches` reports, never throws", () => {
    const sqlite = freshDb();

    // A throw here would stop `shared/db.ts` from loading, and Legion from booting.
    assert.doesNotThrow(() => runPatches(sqlite, [writesThenThrows("a")]));
  });
});

describe("runPatches, when the runner itself fails", () => {
  it("does not throw either, and names itself in the report", () => {
    // Round 1: reading `patches` and preparing statements were outside the `try`. A database
    // without `patches` reproduces that throw.
    const sqlite = new Database(join(dir, `no-table-${++n}.db`));

    let run!: ReturnType<typeof runPatches>;
    assert.doesNotThrow(() => {
      run = runPatches(sqlite, [writes("a")]);
    });

    assert.deepEqual(run.ran, []);
    assert.equal(run.failed.length, 1);
    assert.equal(
      run.failed[0]!.id,
      "(runPatches)",
      "the report must blame the mechanics, not a patch: the fix differs",
    );
    assert.match(run.failed[0]!.why, /patches/);
  });
});

describe("runPatches, a patch managing its own transaction", () => {
  /** The migrations' `exec("BEGIN; … COMMIT;")` style copied into a patch: `COMMIT` closes the
   *  runner's transaction, and the mark would then be written permanently. */
  const commitsItself = (id: string) => ({
    id,
    apply: (sqlite: Database.Database) => {
      sqlite.prepare("INSERT INTO trace (word) VALUES (?)").run(id);
      sqlite.exec("COMMIT");
    },
  });

  it("is refused: not marked, and the report says what it did", () => {
    const sqlite = freshDb();

    const run = runPatches(sqlite, [commitsItself("a")]);

    assert.deepEqual(run.ran, []);
    assert.equal(run.failed.length, 1);
    assert.match(run.failed[0]!.why, /the runner's transaction/);
    assert.deepEqual(
      played(sqlite),
      [],
      "marking a patch whose writes escaped control is the worst outcome",
    );
  });
});
