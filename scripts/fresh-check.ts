#!/usr/bin/env -S node --import tsx
// The gate that notices a stale base (08/09).
//
// On 08/09 six conflicts were resolved by hand in one day, all alike: PRs #126, #127, #132, #133,
// two of them resynced twice because another PR merged in between. The colliding files are always
// the shared ones every batch touches (`scripts/arch-metrics-baseline.json`,
// `scripts/api-pending.json`), and nothing told an agent its branch had fallen
// behind `main` while it worked.
//
// It does not prevent two agents finishing five minutes apart from conflicting: it narrows the
// window, it does not close it.
//
// `git fetch` rather than `git ls-remote` (measured 08/09): similar network cost (~0.6-0.7 s, this
// clone's refspec only tracks `main`), but `ls-remote` returns only the remote SHA, and counting
// commits with `git rev-list --count HEAD..origin/main` needs them locally. One call instead of two.
//
// The fetch matters: a long session's local `origin/main` is as old as its clone.
//
// It rebases nothing: it reports and gives the command.
//
// An agent that cannot resync (network cut, allowlist proxy, expired token, read-only repository)
// must never fail here, since it could not fix it. `git fetch` is the gate's only network call; if
// it fails for any reason, the gate says so and lets through.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// `GIT_TERMINAL_PROMPT=0`: an expired token or a private remote must not hang the gate on a
// password prompt no agent can answer; it fails fast into the "unreachable" case below. The 8 s
// `timeout` covers the rest (hanging proxy, dead DNS).
const fetch = spawnSync("git", ["fetch", "--quiet", "origin", "main"], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 8000,
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
});

if (fetch.error || fetch.status !== 0 || fetch.signal) {
  const why = fetch.signal
    ? `timed out (${fetch.signal})`
    : fetch.error?.message || fetch.stderr?.trim() || `git fetch failed (code ${fetch.status})`;
  console.log(`· origin unreachable, freshness not checked (${why}) — gate skipped.`);
  process.exit(0);
}

const behind = spawnSync("git", ["rev-list", "--count", "HEAD..origin/main"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (behind.error || behind.status !== 0) {
  // Fetch worked but the comparison failed (no HEAD commit, `origin/main` missing under an unusual
  // refspec): a defect of the gate, not the branch, so a different exit code, like the other gates.
  console.error(
    `⛔ freshness: cannot compare HEAD with origin/main: ${behind.error?.message || behind.stderr?.trim()}`,
  );
  process.exit(2);
}

/** The gate prescribes `git merge`, no longer `git pull --rebase` (10/09).
 *
 *  The old advice was measured twice copying `main`'s commits into the branch with new shas:
 *
 *  1. Shallow clone (batch 4). `git rebase` needs the merge base to know what is upstream; beyond a
 *     shallow graft it is invisible, so git replays everything. Thirteen commits for seven
 *     patch-ids (#146 and #147 three times each) and three add/add conflicts on identical files.
 *  2. Squash merge (batch 7). GitHub squashes a PR into one new commit on `main`, so the branch's
 *     commits are no longer ancestors; reused afterwards, the branch rebases onto a stale base.
 *     PR #158: 113 files of diff for a batch touching 22.
 *
 *  `git merge origin/main` rewrites nothing, never needs `--force`, and keeps review comment
 *  anchors. The conflict brief (`review/review.ts`) already says "do NOT rebase"; the gate said the
 *  opposite, and agents follow the gate.
 *
 *  `shallow` is still reported: the count itself is wrong on a truncated clone. The runner's clone
 *  is full since 10/09 (`runner-payload/repos.mts`), but a hand-made clone may not be. */
const shallow =
  spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd: ROOT,
    encoding: "utf8",
  }).stdout?.trim() === "true";

const count = parseInt(behind.stdout.trim(), 10);
if (count > 0) {
  console.error(
    `⛔ branch is ${count} commit${count > 1 ? "s" : ""} behind origin/main.\n` +
      (shallow
        ? `   This clone is TRUNCATED (shallow), so this count is a lower bound. Catch up\n` +
          `   the history FIRST:\n` +
          `     git fetch --unshallow origin && git merge origin/main\n`
        : `   Catch up with: git merge origin/main\n`) +
      `   Two agents finishing a few minutes apart can still conflict with each\n` +
      `   other — this gate closes the window of a \`main\` several hours old,\n` +
      `   not that one.`,
  );
  process.exit(1);
}

console.log("✓ up to date with origin/main.");
