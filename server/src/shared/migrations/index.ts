import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";
import { steps as steps1to10 } from "./v1-v10.js";
import { steps as steps11to20 } from "./v11-v20.js";
import { steps as steps21to30 } from "./v21-v30.js";
import { steps as steps31to40 } from "./v31-v40.js";
import { steps as steps41to45 } from "./v41-v45.js";
import { steps as steps46to50 } from "./v46-v50.js";
import { steps as steps51to55 } from "./v51-v55.js";
import { steps as steps56to60 } from "./v56-v60.js";
import { steps as steps61to65 } from "./v61-v65.js";
import { steps as steps66to70 } from "./v66-v70.js";
import { steps as steps71to75 } from "./v71-v75.js";
import { createLogger } from "../log.js";

const log = createLogger("db");

// Versioned migrations (PRAGMA user_version). Array order is application order and is never
// rewritten; a new migration goes at the end, in its range file.
const STEPS: MigrationStep[] = [
  ...steps1to10,
  ...steps11to20,
  ...steps21to30,
  ...steps31to40,
  ...steps41to45,
  ...steps46to50,
  ...steps51to55,
  ...steps56to60,
  ...steps61to65,
  ...steps66to70,
  ...steps71to75,
];

/** The highest version, read from the steps. Exported for tests, which used to hardcode it and
 *  broke on every unrelated migration. */
export const HEAD_VERSION: number = STEPS[STEPS.length - 1]![0];

/** Applies missing migrations oldest first, rereading `user_version` between each, so a failure
 *  leaves the database at the last complete version.
 *
 *  One terminal line, not one per migration, and not under tests: per-step lines added 2 200 lines
 *  to `pnpm test` output in an agent's window. `NODE_TEST_CONTEXT` is set by the node:test runner
 *  itself and never at real boot. The persistent summary is written by `db.ts` to
 *  `control_events`. */
export function runMigrations(sqlite: Database.Database): { from: number; to: number } {
  const current = () => (sqlite.pragma("user_version", { simple: true }) as number) ?? 0;
  const from = current();
  for (const [version, apply] of STEPS) if (current() < version) apply(sqlite);
  const to = current();
  if (to > from && !process.env.NODE_TEST_CONTEXT)
    log.info(`schema v${from} → v${to} (${to - from} migration(s) applied)`);
  return { from, to };
}
