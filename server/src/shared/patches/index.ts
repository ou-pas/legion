// Data patches run at boot: the counterpart of `shared/migrations/` for the database's content
// rather than its shape (operator's request 15/09, after `rappasoft/laravel-patches`).
//
// A migration describes shape and must pass before anything reads the database, so a failed one
// blocks the boot. A patch describes content: a failed transformation leaves Legion usable with
// unchanged data, so it never blocks the boot. Differences from the reference are noted at
// migration v75 (`migrations/v71-v75.ts`).
import type Database from "better-sqlite3";
import { p1SecretsVersConnexions } from "./p1-secrets-vers-connexions.js";
import { p2SeededTextInEnglish } from "./p2-seeded-text-in-english.js";
import { p3LegionWritesInEnglish } from "./p3-legion-writes-in-english.js";
import type { DataPatch } from "./step.js";

/** Array order is application order; add patches at the end. The `patches` table, not the
 *  position, records what already ran. */
const PATCHES: DataPatch[] = [
  p1SecretsVersConnexions,
  p2SeededTextInEnglish,
  p3LegionWritesInEnglish,
];

/** What a boot did to the content. `failed` carries the reason, not the exception: it goes to
 *  `control_events`, where a stack trace helps nobody. */
type PatchRun = { ran: string[]; failed: { id: string; why: string }[] };

/** The name the runner reports itself under when its own mechanics fail (reading `patches`,
 *  preparing statements), not a patch id. A `SQLITE_BUSY` there used to kill the boot. */
const RUNNER = "(runPatches)";

/** Runs patches never run before, in order, and reports what happened.
 *
 *  Logs nothing itself; `db.ts` writes one line (the test suite opens hundreds of databases).
 *
 *  A failing patch stops neither the boot nor the next patch. It is not marked, so it replays at
 *  the next boot, which is sound because each patch runs in its own transaction with its mark
 *  inside: nothing is half-written.
 *
 *  `patches` is a parameter so tests exercise the runner's mechanics without the real patches. */
export function runPatches(
  sqlite: Database.Database,
  patches: readonly DataPatch[] = PATCHES,
): PatchRun {
  const run: PatchRun = { ran: [], failed: [] };
  // The whole body is guarded (round 1): reading `patches` and preparing statements also touch
  // disk, and a throw there reached module load in `db.ts`, i.e. the boot.
  try {
    const played = new Set(
      (sqlite.prepare("SELECT id FROM patches").all() as { id: string }[]).map((row) => row.id),
    );
    const mark = sqlite.prepare("INSERT INTO patches (id, ran_at) VALUES (?, ?)");
    for (const patch of patches) {
      if (played.has(patch.id)) continue;
      try {
        sqlite.transaction(() => {
          patch.apply(sqlite);
          // A patch must not close this transaction (checked, round 1): otherwise the mark would
          // be written permanently on a patch reported as failed. Refused before the mark.
          if (!sqlite.inTransaction)
            throw new Error(
              `${patch.id} closed the runner's transaction (BEGIN/COMMIT inside a patch):` +
                " a patch writes, it does not commit",
            );
          mark.run(patch.id, Date.now());
        })();
        run.ran.push(patch.id);
      } catch (e) {
        run.failed.push({ id: patch.id, why: String((e as Error)?.message ?? e) });
      }
    }
  } catch (e) {
    run.failed.push({ id: RUNNER, why: String((e as Error)?.message ?? e) });
  }
  return run;
}
