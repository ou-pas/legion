#!/usr/bin/env -S node --import tsx
// Dead code, counted and ratcheted (05/09).
//
// knip answers "what is imported nowhere" well (9 whole files and 27 exports on 05/09). It cannot
// answer the one question a gate must ask: "is there one more than yesterday, and which". Without
// that, the target either leaves `gates` or the findings go into `knip.json`, where they become
// invisible and outlive the files they name.
//
// Same ratchet as scripts/arch-check.ts and scripts/api-contract.ts: known debt lives in
// scripts/deadcode-baseline.json, an undeclared finding fails, and a declaration matching nothing
// fails too, so deleting dead code also removes its line and the list really shrinks.
//
// It deletes nothing: a dead export may be a pending public API or a real oversight, a human
// judgement. It only keeps the count from growing.
//
// `node --import tsx scripts/deadcode-check.ts --write` (`make deadcode-baseline`) regenerates the
// baseline: only when code was left without a caller on purpose, and named.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE = join(ROOT, "scripts", "deadcode-baseline.json");
const WRITE = process.argv.includes("--write");

const run = spawnSync(join(ROOT, "node_modules", ".bin", "knip"), ["--reporter", "json"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
// knip exits 1 whenever it finds something, which is expected: we read its JSON. A real crash
// (unreadable config, missing workspace) writes nothing to stdout; confusing the two would turn
// the gate green on a failure.
if (!run.stdout?.trim()) {
  console.error("⛔ knip produced nothing:\n" + (run.stderr || run.error?.message || "(silence)"));
  process.exit(2);
}

// A knip "issue" is one object per file, each field a finding category. Flattened to
// `category :: file :: symbol`: symbol granularity says "one more dead export in this file", not
// just "this file's count changed".
const CATEGORIES = {
  files: "file with no importer",
  exports: "export with no caller",
  types: "exported type with no caller",
  duplicates: "duplicate export",
  unlisted: "undeclared dependency",
  unresolved: "unresolved import",
  binaries: "undeclared binary",
  dependencies: "unused dependency",
  devDependencies: "unused devDependency",
};
// A duplicate export finding is a group of symbols (two names for one binding). Without this case
// the key ended in "[object Object],[object Object]" and different duplicates merged.
const nameOf = (item) => {
  if (typeof item === "string") return item;
  if (Array.isArray(item)) return item.map(nameOf).join(" / ");
  return item.name ?? item.symbol ?? JSON.stringify(item);
};

const found = new Map();
for (const issue of JSON.parse(run.stdout).issues ?? []) {
  for (const [field, label] of Object.entries(CATEGORIES)) {
    for (const item of issue[field] ?? []) {
      // `files` repeats the file name as its symbol: the whole file is dead, no symbol to name.
      const symbol = field === "files" ? "" : nameOf(item);
      const key = `${label} :: ${issue.file}${symbol ? ` :: ${symbol}` : ""}`;
      found.set(key, { kind: label, file: issue.file, symbol });
    }
  }
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const keyOfEntry = (e) => `${e.kind} :: ${e.file}${e.symbol ? ` :: ${e.symbol}` : ""}`;
const declared = new Map((baseline.findings ?? []).map((e) => [keyOfEntry(e), e]));

if (WRITE) {
  const kept = [...found.values()]
    .map((f) => ({
      ...f,
      // The named work survives regeneration: the one fact the tool cannot rebuild.
      chantier: declared.get(keyOfEntry(f))?.chantier ?? "TO NAME — delete it, or say what it is waiting for",
    }))
    .sort((a, b) => keyOfEntry(a).localeCompare(keyOfEntry(b)));
  writeFileSync(BASELINE, JSON.stringify({ ...baseline, findings: kept }, null, 2) + "\n");
  console.log(`✎ scripts/deadcode-baseline.json rewritten: ${kept.length} declared finding(s).`);
  const unnamed = kept.filter((e) => e.chantier.startsWith("TO NAME"));
  if (unnamed.length) console.log(`  ${unnamed.length} without a piece of work — name them before committing.`);
  process.exit(0);
}

const added = [...found.keys()].filter((k) => !declared.has(k));
const stale = [...declared.keys()].filter((k) => !found.has(k));

console.log(`${found.size} dead code finding(s)\n`);

if (added.length) {
  console.log(`⛔ ${added.length} NEW DEAD CODE finding(s), not declared:`);
  for (const k of added) console.log(`   ${k}`);
  console.log(
    "   Delete it, or declare it in scripts/deadcode-baseline.json, naming what it is\n"
    + "   waiting for (`make deadcode-baseline` regenerates and keeps the names already given).\n",
  );
}

if (stale.length) {
  console.log(
    `⛔ ${stale.length} STALE declaration(s) in scripts/deadcode-baseline.json — this code is no longer dead, remove the line:`,
  );
  for (const k of stale) console.log(`   ${k}   (work: ${declared.get(k).chantier})`);
  console.log();
}

const debt = found.size - added.length;
if (debt) {
  const chantiers = new Set([...declared.values()].map((e) => e.chantier));
  console.log(`· ${debt} known and declared finding(s), spread over ${chantiers.size} piece(s) of work.`);
}

const fail = added.length + stale.length;
if (!fail) console.log("✓ dead code: nothing new, nothing stale.");
process.exit(fail ? 1 : 0);
