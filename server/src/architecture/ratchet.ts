// The ratchet (05/09). `scripts/arch-metrics.ts` measures, this file judges, in both directions:
//
//   · nothing new, nothing growing: otherwise debt rises one commit at a time, as it did; nobody
//     ever decided a file would be 1,274 lines;
//   · nothing that went down without being re-recorded: otherwise progress becomes silent slack
//     for the next regression. Same model as `scripts/api-pending.json`: a stale declaration fails
//     as hard as an undeclared hole, or the list becomes a graveyard.
//
// Accepted cost: an entry's value is its exact number, so trimming two lines from a file fails
// with "the baseline is stale". The fix is one command and one file in the commit.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  type ArchMetric,
  type ArchMetrics,
  baselinePath,
  measure,
} from "../../../scripts/arch-metrics.js";

const WRITE =
  "`node --import tsx scripts/arch-metrics.ts --write-baseline` (= `make arch-metrics-baseline`)";

let measured: ArchMetrics | undefined;
/** One measure per process: `node --test` runs one per file, and each costs ~1 s. */
const actual = (): ArchMetrics => {
  measured ??= measure();
  return measured;
};

let recorded: ArchMetrics | undefined;
function baseline(): ArchMetrics {
  if (recorded) return recorded;
  if (!existsSync(baselinePath)) {
    assert.fail(
      `The architecture baseline does not exist (${baselinePath}).\nCreate it with ${WRITE}.`,
    );
  }
  const parsed = JSON.parse(readFileSync(baselinePath, "utf8")) as { metrics?: ArchMetrics };
  if (!parsed.metrics)
    assert.fail(`${baselinePath} has no \`metrics\` key: regenerate it with ${WRITE}.`);
  recorded = parsed.metrics;
  return recorded;
}

function metric(source: ArchMetrics, name: string): ArchMetric {
  const found = source[name];
  if (!found) assert.fail(`unknown metric: ${name}. Known: ${Object.keys(source).join(", ")}.`);
  return found;
}

/** The number attached to a list entry: `"path (1274)"`, `"path:fn (221)"`. An entry without a
 *  number (a component without stories) is pure membership and maps to `null`. */
const SIZED = /^(.*) \((\d+)\)$/;

/**
 * Brings both metric shapes to one `key → number | null` table so the ratchet has one logic.
 * `keep` filters on the file (the part before `:` in `file:function`), for rules that only apply
 * to one side of the repo.
 */
function table(source: ArchMetric, keep?: (file: string) => boolean): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const add = (key: string, value: number | null) => {
    if (keep && !keep(key.split(":")[0] ?? key)) return;
    const seen = out.get(key);
    // Two entries with the same label (two anonymous callbacks in one file): keep the larger, and
    // the ratchet loses the other. Accepted ceiling; numbering anonymous functions would make the
    // baseline and its diff unreadable.
    out.set(key, seen != null && value != null ? Math.max(seen, value) : value);
  };
  if (Array.isArray(source)) {
    for (const entry of source) {
      const hit = SIZED.exec(entry);
      add(hit?.[1] ?? entry, hit?.[2] ? Number(hit[2]) : null);
    }
  } else {
    for (const [file, n] of Object.entries(source)) add(file, n);
  }
  return out;
}

/** `unit` is only for the message: "went from 221 to 240 lines" reads, "from 221 to 240" guesses. */
export function ratchet(name: string, unit: string, keep?: (file: string) => boolean): void {
  const now = table(metric(actual(), name), keep);
  const was = table(metric(baseline(), name), keep);
  const worse: string[] = [];
  const stale: string[] = [];

  for (const [key, value] of now) {
    if (!was.has(key)) {
      worse.push(
        `+ ${key}${value == null ? "" : ` — ${value} ${unit}`}: new, it was not in the baseline`,
      );
      continue;
    }
    const before = was.get(key) ?? null;
    if (value == null || before == null) continue;
    if (value > before) worse.push(`↑ ${key} went from ${before} to ${value} ${unit}`);
    if (value < before) stale.push(`↓ ${key} went down from ${before} to ${value} ${unit}`);
  }
  for (const key of was.keys()) if (!now.has(key)) stale.push(`− ${key} is gone`);

  const bullets = (lines: string[]) =>
    lines
      .sort()
      .map((l) => `   ${l}`)
      .join("\n");
  if (worse.length > 0) {
    assert.fail(
      `${name}: ARCHITECTURE REGRESSION (${worse.length}).\n${bullets(worse)}\n\n` +
        "Fix it: split the function, remove the `!`, validate the body, write the stories.\n" +
        `If the regression is INTENDED and discussed, re-record the debt with ${WRITE}\n` +
        "and say WHY in the commit message: it is the only trace that will remain." +
        (stale.length > 0 ? `\n\n(${stale.length} unrecorded improvement(s) along the way.)` : ""),
    );
  }
  if (stale.length > 0) {
    assert.fail(
      `${name}: the baseline is STALE, an improvement is not recorded (${stale.length}).\n${bullets(stale)}\n\n` +
        `Run ${WRITE} and commit the file.\nOtherwise the improvement becomes slack for the next ` +
        "regression and nobody sees it happen.",
    );
  }
}

/**
 * A rule without a baseline: zero has no debt to declare. Only for places already at zero; an
 * absolute threshold relaxed the day it is set is one nobody believes in.
 */
export function mustBeZero(name: string, why: string, keep?: (file: string) => boolean): void {
  const now = table(metric(actual(), name), keep);
  if (now.size === 0) return;
  assert.fail(
    `${name} : ${why}\n${[...now.keys()]
      .sort()
      .map((k) => `   + ${k}`)
      .join("\n")}\n\n` + "This rule has no baseline: it is zero. There is nothing to re-record.",
  );
}

/** Otherwise a metric added to the measurer without a regenerated baseline would only show up as
 *  "unknown metric" in its family's test, blaming the wrong half. */
export function sameMetricSet(): void {
  assert.deepEqual(
    Object.keys(actual()).sort(),
    Object.keys(baseline()).sort(),
    `The measurer and the baseline no longer describe the same metrics. Regenerate with ${WRITE}.`,
  );
}
