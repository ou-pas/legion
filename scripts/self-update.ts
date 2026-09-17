#!/usr/bin/env -S node --import tsx
// The script that outlives the server (26/08).
//
// The control plane starts it detached, then dies: `git checkout` touches `server/src`, `tsx watch`
// sees it and restarts. The process applying an update cannot be the one being replaced.
//
// Everything goes to stdout, redirected to `data/updates/<timestamp>.log`: the only witness, since
// the screen that would show the error is dying. Each step is announced before it runs, so a log
// cut short still says where it stopped. `bare-lock.ts` reads its `✓` / `⛔` markers.
//
// The order is not negotiable: the database copy comes first, before the `fetch`. Migrations have
// no down path, and this copy is the only way back.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = process.argv[2] ?? process.env.LEGION_UPDATE_TARGET ?? "";

function say(line) {
  process.stdout.write(`[${new Date().toISOString()}] ${line}\n`);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    say(`$ ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd: ROOT, stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      ...opts,
    });
    child.on("error", (e) => { say(`⛔ ${cmd} not found: ${e.message}`); resolve(127); });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function step(label, cmd, args) {
  say(`— ${label}`);
  const code = await run(cmd, args);
  if (code !== 0) {
    say(`⛔ FAILED (${label}, code ${code}).`);
    say(`   The database was copied before any change. To roll back:`);
    say(`   cp "${backup}" "${dbPath}" && git checkout ${before}`);
    process.exit(code);
  }
  return code;
}

if (!TARGET) { say("⛔ no target tag."); process.exit(2); }

say(`Updating to ${TARGET}.`);

const dataDir = process.env.LEGION_DATA ?? join(ROOT, "server", "data");
const dbPath = process.env.LEGION_DB ?? join(ROOT, "server", "legion.db");
const backupDir = join(dataDir, "backups");
const backup = join(backupDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
if (existsSync(dbPath)) {
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(dbPath, backup);
  say(`— database copied: ${backup}`);
} else {
  say(`— no database at ${dbPath}: nothing to copy`);
}

// Where we come from, logged before moving: the rollback command above needs it.
let before = "HEAD";
await new Promise((resolve) => {
  const p = spawn("git", ["rev-parse", "HEAD"], { cwd: ROOT });
  let out = "";
  p.stdout.on("data", (d) => { out += d.toString(); });
  p.on("close", () => { before = out.trim() || "HEAD"; resolve(); });
});
say(`— starting point: ${before}`);

await step("fetching tags", "git", ["fetch", "--tags", "--prune"]);
// `--`: a tag and a file can share a name, and git prefers the file.
await step(`checking out ${TARGET}`, "git", ["checkout", TARGET, "--"]);
await step("installing dependencies", "pnpm", ["install", "--frozen-lockfile"]);

// Migrations run when `shared/db.ts` is imported, so at server startup: nothing to run here. Said
// anyway, because a log that skips a step suggests it was forgotten.
say("— migrations: applied at the control plane's next startup (import of shared/db.ts)");

// Rebuilt only if the payload changed: several minutes otherwise paid for nothing. A failure here
// is not fatal: the code is up to date and the Infra screen can tell an image is stale.
say("— session image: rebuilt if the payload changed");
const imageCode = await run("make", ["image-session"]);
if (imageCode !== 0)
  say(`⚠ session image not rebuilt (code ${imageCode}). The code is up to date; run "make image-session" by hand, or the next sessions will run the old runtime.`);

// Under `make dev`, `tsx watch` already restarted the server during checkout, and restarting it from
// here would start a second one. Under `pnpm start` nobody watches files, so say it instead of
// guessing.
say(`— restart: automatic under "make dev" (tsx watch). Under "pnpm start", restart it by hand.`);
say(`✓ Update done: ${before} → ${TARGET}.`);
say(`  To roll back if needed: cp "${backup}" "${dbPath}" && git checkout ${before}`);
