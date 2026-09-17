// The bare-mode lock (02/09): no new mechanism, the log itself.
//
// In Docker mode the `legion-update` container name is the lock (`docker-update.ts`). In bare mode
// the detached script (`scripts/self-update.ts`) writes a log, and its only two ways to stop both
// announce themselves: a `✓` line on success, a `⛔` line on failure. While the last line of the
// newest log carries neither, the script is still writing.
//
// A script killed silently (`kill -9`, host shutdown, `tsx watch` restarting) leaves a log never
// closed, and the first version read it as running forever: the update badge stayed lit on any dev
// machine with an old log (02/09). Freshness decides: a live script keeps writing.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Silence beyond which an unclosed log is a corpse. Generous: the longest silent step of a real
 *  update (a cold-cache `pnpm install`) takes minutes, not quarter hours. */
const STALE_AFTER_MS = 15 * 60_000;

/** A closing line written by `say()`: after the timestamp, `✓` on success or `⛔` on failure. */
const TERMINAL_LINE = /[✓⛔]/;

export interface BareLockDeps {
  /** Log file names, any order. Injected for tests. */
  listLogs?: (dir: string) => string[];
  readLog?: (dir: string, name: string) => string;
  /** Age of the log's last write, in ms. Injected: a real mtime would tie the verdict to the CI
   *  machine's clock. */
  logAgeMs?: (dir: string, name: string) => number;
}

function defaultListLogs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".log"));
  } catch {
    return []; // no update attempted since this folder exists
  }
}

function defaultReadLog(dir: string, name: string): string {
  try {
    return readFileSync(join(dir, name), "utf8");
  } catch {
    return "";
  }
}

function defaultLogAgeMs(dir: string, name: string): number {
  try {
    return Date.now() - statSync(join(dir, name)).mtimeMs;
  } catch {
    // Unreadable is no proof a script writes: fall back to "nothing running", which lights no
    // badge wrongly.
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Reads the newest log (names are ISO timestamps with `:` replaced by `-`, so lexicographic order
 * is chronological) and looks at its last non-empty line.
 */
export function bareUpdateRunning(dir: string, deps: BareLockDeps = {}): boolean {
  const list = (deps.listLogs ?? defaultListLogs)(dir);
  if (list.length === 0) return false;
  const latest = [...list].sort().at(-1)!;
  const content = (deps.readLog ?? defaultReadLog)(dir, latest);
  const lastLine =
    content
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .at(-1) ?? "";
  if (lastLine !== "" && TERMINAL_LINE.test(lastLine)) return false;
  // Unclosed: only a log that just wrote proves a live script.
  return (deps.logAgeMs ?? defaultLogAgeMs)(dir, latest) <= STALE_AFTER_MS;
}
