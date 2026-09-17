#!/usr/bin/env -S node --import tsx
// The boundaries declared in CLAUDE.md, made mechanical (05/09).
//
// What this adds to `depcruise` alone is the ratchet. dependency-cruiser can say "there are 46
// violations", not "there is one more than yesterday, here it is". On a repository already carrying
// debt that is the only question: nobody fixes 46 edges before merging, and a gate nobody can pass
// gets disabled.
//
// Same model as `scripts/api-contract.ts`: known debt lives in `scripts/arch-deps-baseline.json`,
// each entry naming the work that settles it. A violation missing from the baseline fails; a
// baseline entry matching nothing fails too, so the file does not become a graveyard.
//
// `warn` violations (currently `no-orphans`) are printed and do not fail; they stay out of the
// baseline.
//
// `node --import tsx scripts/arch-check.ts --write` (`make arch-baseline`) regenerates the baseline:
// only when debt was added on purpose and named.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// `fileURLToPath`, not `.pathname`, which is percent-encoded as soon as a folder has a space (agent
// worktrees live under .claude/worktrees/).
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE = join(ROOT, "scripts", "arch-deps-baseline.json");
const ROOTS = ["server/src", "web/src", "runner-payload"];
const WRITE = process.argv.includes("--write");

const run = spawnSync(
  join(ROOT, "node_modules", ".bin", "depcruise"),
  ["--config", ".dependency-cruiser.cjs", "--output-type", "json", ...ROOTS],
  { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);
// `depcruise` exits 1 on any `error` violation, which is expected: we read its JSON. A real crash
// writes nothing to stdout, and that is what we tell apart.
if (!run.stdout?.trim()) {
  console.error(
    "⛔ depcruise produced nothing:\n" + (run.stderr || run.error?.message || "(silence)"),
  );
  process.exit(2);
}
const result = JSON.parse(run.stdout);
// depcruise's JSON output omits the rules' `comment`, so it is read from the config: a failure that
// only says "rule X crossed" sends the reader to a file to learn why the rule exists, which is
// exactly when people decide to work around it.
//
// `createRequire` is a static import (batch 1, 09/09): `await import("node:module")` crashed the
// `tsx` loader on this file, whose dynamic import scanner drifted on the accented header comment
// (UTF-8 byte length compared with a character position).
const COMMENTS = new Map(
  createRequire(import.meta.url)(join(ROOT, ".dependency-cruiser.cjs")).forbidden.map((r) => [
    r.name,
    r.comment,
  ]),
);
const all = result.summary.violations ?? [];
const errors = all.filter((v) => v.rule.severity === "error");
const warnings = all.filter((v) => v.rule.severity === "warn");

/** A violation's key: rule and edge. Two distinct cycles leaving the same module toward the same
 *  neighbour would merge (not the case on 05/09: 46 keys, 46 violations); the ratchet would still
 *  hold, since debt can only go down. */
const keyOf = (v) => `${v.rule.name} :: ${v.from} → ${v.to}`;
const seen = new Map(errors.map((v) => [keyOf(v), v]));

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const declared = new Map(
  (baseline.violations ?? []).map((e) => [`${e.rule} :: ${e.from} → ${e.to}`, e]),
);

if (WRITE) {
  const kept = [...seen.values()]
    .map((v) => ({
      rule: v.rule.name,
      from: v.from,
      to: v.to,
      // The named work survives regeneration: the one fact the tool cannot rebuild.
      chantier: declared.get(keyOf(v))?.chantier ?? "TO NAME — which piece of work settles this edge?",
    }))
    .sort((a, b) => `${a.rule}${a.from}${a.to}`.localeCompare(`${b.rule}${b.from}${b.to}`));
  writeFileSync(BASELINE, JSON.stringify({ ...baseline, violations: kept }, null, 2) + "\n");
  console.log(`✎ scripts/arch-deps-baseline.json rewritten: ${kept.length} declared edge(s).`);
  const unnamed = kept.filter((e) => e.chantier.startsWith("TO NAME"));
  if (unnamed.length)
    console.log(`  ${unnamed.length} without a piece of work — name them before committing.`);
  process.exit(0);
}

const added = [...seen.keys()].filter((k) => !declared.has(k));
const stale = [...declared.keys()].filter((k) => !seen.has(k));

console.log(
  `${result.summary.totalCruised} module(s) scanned · ${errors.length} boundary violation(s)\n`,
);

if (added.length) {
  console.log(`⛔ ${added.length} BOUNDARY(IES) CROSSED, not declared:`);
  for (const k of added) {
    const v = seen.get(k);
    console.log(`   ${k}`);
    if (v.cycle?.length)
      console.log(`      cycle: ${v.cycle.map((c) => c.name ?? c).join(" → ")}`);
    // The comment's first sentence places the rule; the rest is in .dependency-cruiser.cjs.
    const why = COMMENTS.get(v.rule.name);
    if (why) console.log(`      ${why.split(/(?<=[a-zà-ÿ)]\.)\s/)[0]}`);
  }
  console.log(
    "   Remove the import, or declare it in scripts/arch-deps-baseline.json, naming the piece of work\n" +
      "   that will settle it (`make arch-baseline` regenerates and keeps the names already given).\n",
  );
}

if (stale.length) {
  console.log(
    `⛔ ${stale.length} STALE declaration(s) in scripts/arch-deps-baseline.json — the edge no longer exists, remove the line:`,
  );
  for (const k of stale) console.log(`   ${k}   (work: ${declared.get(k).chantier})`);
  console.log();
}

if (warnings.length) {
  console.log(`· ${warnings.length} warning(s) (they do not fail):`);
  for (const v of warnings) console.log(`   ${v.rule.name} :: ${v.from}`);
  console.log();
}

const debt = errors.length - added.length;
if (debt) {
  const chantiers = new Set([...declared.values()].map((e) => e.chantier));
  console.log(
    `· ${debt} known and declared edge(s), spread over ${chantiers.size} piece(s) of work.`,
  );
}

const fail = added.length + stale.length;
if (!fail) console.log("✓ boundaries hold: nothing new, nothing stale.");
process.exit(fail ? 1 : 0);
