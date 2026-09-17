// The freshness gate (`scripts/fresh-check.ts`) had no test (found on 08/09). It proves the three
// behaviours its header promises.
//
// The script computes its root from `import.meta.url`, not the cwd, so this test COPIES it into a
// throwaway git repo, whose root it then becomes, rather than adding a test mode to the script.
//
// TypeScript since 09/09: the throwaway repo has no `node_modules`, so `node` runs with the REAL
// repo's `tsx` loader through an absolute file URL.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const REAL_SCRIPT = join(REPO_ROOT, "scripts", "fresh-check.ts");
const TSX_LOADER = pathToFileURL(join(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;

const tmp = mkdtempSync(join(tmpdir(), "legion-fresh-check-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
}

/** A local repo with the gate copied in, cloned from a throwaway local origin, never the network. */
function fixtureRepo(name: string): { local: string; origin: string } {
  const origin = join(tmp, `${name}-origin`);
  mkdirSync(origin, { recursive: true });
  git(origin, ["init", "-q", "-b", "main"]);
  git(origin, ["config", "user.email", "test@example.com"]);
  git(origin, ["config", "user.name", "test"]);
  writeFileSync(join(origin, "file.txt"), "v1\n");
  git(origin, ["add", "."]);
  git(origin, ["commit", "-q", "-m", "init"]);

  const local = join(tmp, `${name}-local`);
  spawnSync("git", ["clone", "-q", origin, local], { encoding: "utf8" });
  mkdirSync(join(local, "scripts"), { recursive: true });
  copyFileSync(REAL_SCRIPT, join(local, "scripts", "fresh-check.ts"));
  return { local, origin };
}

function run(local: string) {
  return spawnSync("node", ["--import", TSX_LOADER, join(local, "scripts", "fresh-check.ts")], {
    cwd: local,
    encoding: "utf8",
  });
}

describe("scripts/fresh-check.ts: the freshness gate", () => {
  it("up to date with origin/main: success, no failure noise", () => {
    const { local } = fixtureRepo("up-to-date");
    const result = run(local);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /up to date with origin\/main/);
  });

  it("behind origin/main: failure naming the commit count and the command", () => {
    const { local, origin } = fixtureRepo("behind");
    // A commit on origin AFTER the clone: the local neither fetched nor merged it.
    writeFileSync(join(origin, "file.txt"), "v2\n");
    git(origin, ["add", "."]);
    git(origin, ["commit", "-q", "-m", "ahead of local"]);

    const result = run(local);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /1 commit behind origin\/main/);
    // MERGE, NOT REBASE (10/09): a rebase copies `main`'s commits with new shas once the common base
    // is stale (after a squash-merge, or on a shallow clone); both measured that day.
    assert.match(result.stderr, /git merge origin\/main/);
    assert.doesNotMatch(result.stderr, /--rebase/, "the gate no longer prescribes a rebase");
  });

  it("origin unreachable: success that says so, never a failure", () => {
    const { local } = fixtureRepo("unreachable");
    git(local, ["remote", "set-url", "origin", join(tmp, "path-that-does-not-exist.git")]);

    const result = run(local);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /unreachable/);
    assert.match(result.stdout, /gate skipped/);
  });
});
