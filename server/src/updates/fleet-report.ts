// Fleet image results from update logs, surfaced in the control log (07/09).
//
// The ephemeral container rebuilding images has no database: it writes a file under `updates/`.
// On 07/09 one machine failed three updates in a row without a single line reaching the Logs
// screen; the file had to be opened on the host.
//
// The control plane rereads these logs periodically and records one event per finished log (warn
// if a machine failed, info otherwise). A `<log>.reported` marker next to the file prevents
// repeats and survives the control plane restart that happens mid-update. Logs older than the
// feature are marked silently.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logControlEvent } from "../events/control-log-store.js";
import type { ControlLevel } from "../shared/db.js";
import { UPDATES_DIR } from "./docker-update.js";

export interface FleetResult {
  runner: string;
  image: string;
  ok: boolean;
}
export interface FleetOutcome {
  complete: boolean;
  target: string | null;
  results: FleetResult[];
}

const OK_LINE = /^\[[^\]]*\]\s+✓ (.+?): (.+? image) up to date\s*$/;
const KO_LINE = /^\[[^\]]*\]\s+⛔ (.+?): (.+? image) — rebuild failed/;
const TARGET_LINE = /Updating to (\S+) \(/;
/** Complete, not successful: since 13/09 the closing line carries ⛔ when a rebuild failed
 *  (`shared/shell.ts`). The verdict is in `results`; without both signs a failed log would stay
 *  "running" and never be reported. */
const DONE_LINE = /^\[[^\]]*\] [✓⛔] done/m;

/** The `✓`/`⛔` fleet lines are written by `rebuildOneImageLines`; nothing else starts that way. */
export function parseFleetOutcome(text: string): FleetOutcome {
  const results: FleetResult[] = [];
  for (const line of text.split("\n")) {
    const [, okRunner, okImage] = OK_LINE.exec(line) ?? [];
    if (okRunner && okImage) {
      results.push({ runner: okRunner, image: okImage, ok: true });
      continue;
    }
    const [, koRunner, koImage] = KO_LINE.exec(line) ?? [];
    if (koRunner && koImage) results.push({ runner: koRunner, image: koImage, ok: false });
  }
  return { complete: DONE_LINE.test(text), target: TARGET_LINE.exec(text)?.[1] ?? null, results };
}

export interface ReportedEvent {
  level: ControlLevel;
  source: string;
  message: string;
  payload: Record<string, unknown>;
}

/** Older than this on first read: predates the feature, marked silently. */
const SILENT_AFTER_MS = 24 * 3600 * 1000;

/** One phrase per machine: "laptop ⛔ session image, ⛔ browser image, ✓ proxy image". */
function describe(results: FleetResult[]): string {
  const byRunner = new Map<string, FleetResult[]>();
  for (const r of results) byRunner.set(r.runner, [...(byRunner.get(r.runner) ?? []), r]);
  return [...byRunner]
    .map(
      ([runner, rs]) => `${runner} ${rs.map((r) => `${r.ok ? "✓" : "⛔"} ${r.image}`).join(", ")}`,
    )
    .join(" · ");
}

function eventFor(logName: string, outcome: FleetOutcome): ReportedEvent | null {
  const [first] = outcome.results;
  if (!first) return null;
  const failed = outcome.results.filter((r) => !r.ok);
  const level: ControlLevel = failed.length ? "warn" : "info";
  const onDemand = logName.startsWith("rebuild-");
  const head = onDemand
    ? `rebuild on “${first.runner}”`
    : `update${outcome.target ? ` ${outcome.target}` : ""}: fleet images`;
  const tail = failed.length
    ? ` — ${failed.length} failure(s), the Infra card offers to run it again`
    : "";
  return {
    level,
    source: onDemand ? "infra" : "update",
    message: `${head} — ${describe(outcome.results)}${tail}`,
    payload: { log: logName, target: outcome.target, results: outcome.results },
  };
}

/** Call periodically; no effect when nothing finished since last time. */
export function reportFinishedLogs(
  updatesDir: string = UPDATES_DIR,
  emit: (e: ReportedEvent) => void = (e) =>
    logControlEvent(e.level, e.source, e.message, e.payload),
): void {
  if (!existsSync(updatesDir)) return;
  for (const name of readdirSync(updatesDir)
    .filter((f) => f.endsWith(".log"))
    .sort()) {
    const file = join(updatesDir, name);
    const marker = `${file}.reported`;
    if (existsSync(marker)) continue;
    const outcome = parseFleetOutcome(readFileSync(file, "utf8"));
    if (!outcome.complete) continue;
    const tooOld = Date.now() - statSync(file).mtimeMs > SILENT_AFTER_MS;
    const event = tooOld ? null : eventFor(name, outcome);
    if (event) emit(event);
    writeFileSync(marker, `${new Date().toISOString()}\n`);
  }
}
