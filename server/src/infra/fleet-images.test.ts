// The shared image hash is a cross-language contract, and since 03/09 a decision:
// `scripts/fleet-image.sh` skips rebuilding an unchanged context. Diverging sh and TypeScript
// implementations would mean a multi-gigabyte rebuild every update, or worse a screen certifying a
// stale image as up to date. This file runs BOTH and compares, then plays the rebuild criterion for
// real with a fake `docker` on PATH.
//
// The `/unchanged/`, `/\bchanged \(/` and `/no hash stamped/` matches below read
// `scripts/fleet-image.sh`'s output: they change when the script does.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import type { DockerExec, DockerResult } from "../shared/docker-exec.js";
import {
  CONTEXT_HASH_LABEL,
  FLEET_IMAGE_KEY,
  FLEET_IMAGES,
  contextHash,
  driftOf,
  inspectFleetImages,
  repoPlaywrightVersion,
} from "./fleet-images.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(ROOT, "scripts", "fleet-image.sh");

const tmp = mkdtempSync(join(tmpdir(), "legion-fleet-image-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** Called as the Makefile does: `sh <script> …` from the repo root. */
function shell(args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("sh", [SCRIPT, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).trim();
}

/** A subfolder, a hidden file, a name with a space: the three ways `find | sort` and a TypeScript
 *  walk can diverge. */
function fixtureContext(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(join(dir, "sub", "folder"), { recursive: true });
  writeFileSync(join(dir, "Dockerfile"), "FROM alpine\n");
  writeFileSync(join(dir, ".dockerignore"), "*.md\n");
  writeFileSync(join(dir, "a file with space.txt"), "space\n");
  writeFileSync(join(dir, "sub", "folder", "conf.ini"), "[a]\nb=1\n");
  return dir;
}

describe("context hash: the same scheme in sh and TypeScript", () => {
  it("both real context folders give the SAME value on both sides", () => {
    for (const spec of FLEET_IMAGES)
      assert.equal(
        contextHash(spec.contextDir),
        shell(["hash", spec.contextDir]),
        `${spec.contextDir}: fleet-image.sh and contextHash() diverge —` +
          " the Infra screen would call this image stale forever",
      );
  });

  it("subfolders, hidden files and names with spaces: still the same value", () => {
    const dir = fixtureContext("context");
    assert.equal(contextHash(dir, "/"), shell(["hash", dir]));
  });

  it("a RENAMED file changes the hash: the path counts, not only the content", () => {
    const a = fixtureContext("renamed-a");
    const b = fixtureContext("renamed-b");
    writeFileSync(join(b, "entrypoint.sh"), "space\n");
    rmSync(join(b, "a file with space.txt"));
    assert.notEqual(contextHash(a, "/"), contextHash(b, "/"));
    assert.equal(contextHash(b, "/"), shell(["hash", b]));
  });

  it("an unreadable context returns `null`, never an exception or a fake hash", () => {
    assert.equal(contextHash("folder-that-does-not-exist"), null);
  });
});

describe("the browser service's Playwright version", () => {
  it("repo and script read it the same: it is what the label stamps", () => {
    const version = repoPlaywrightVersion();
    assert.match(version ?? "", /^\d+\.\d+\.\d+$/);
    assert.equal(version, shell(["playwright-version", "browser-image/Dockerfile"]));
  });
});

/** Records calls and returns the label it is told to. */
function fakeExec(answers: (args: string[]) => Partial<DockerResult>) {
  const calls: string[][] = [];
  const exec: DockerExec = async (args) => {
    calls.push(args);
    return { code: 0, stdout: "", stderr: "", ...answers(args) };
  };
  return { exec, calls };
}

const browserOf = (states: Awaited<ReturnType<typeof inspectFleetImages>>) =>
  states.find((s) => s.key === FLEET_IMAGE_KEY.browser)!;

describe("drift of a DEPLOYED image shows, not only of repo files", () => {
  it("stamped label equals the repo: nothing to report", async () => {
    const hash = contextHash("browser-image")!;
    const { exec } = fakeExec(() => ({ stdout: `${hash}|1.62.1` }));
    const browser = browserOf(await inspectFleetImages("ssh://mac.local", exec));
    assert.equal(browser.present, true);
    assert.equal(browser.stale, false);
    assert.equal(browser.builtHash, hash);
  });

  it("stamped label differs: the browser image is stale, and the drift can be NAMED", async () => {
    // The 03/09 outage exactly: the service still runs the pre-fix version.
    const { exec } = fakeExec(() => ({ stdout: "ancien-hash|1.49.1" }));
    const browser = browserOf(await inspectFleetImages(null, exec));
    assert.equal(browser.stale, true);
    assert.equal(browser.builtVersion, "1.49.1");
    assert.equal(browser.currentVersion, repoPlaywrightVersion());
    assert.notEqual(browser.builtVersion, browser.currentVersion);
    assert.equal(browser.makeTarget, "image-browser");
  });

  it("an image without the label (built before it existed) is stale: its content is unknown", async () => {
    // `<no value>` is not a value and must not reach the screen as one.
    const { exec } = fakeExec(() => ({ stdout: "<no value>|<no value>" }));
    const browser = browserOf(await inspectFleetImages(null, exec));
    assert.equal(browser.builtHash, null);
    assert.equal(browser.builtVersion, null);
    assert.equal(browser.stale, true);
  });

  it("image MISSING from the daemon: an absence, not drift, said differently", async () => {
    const { exec } = fakeExec(() => ({ code: 1, stderr: "No such image" }));
    for (const state of await inspectFleetImages(null, exec)) {
      assert.equal(state.present, false);
      assert.equal(state.stale, false);
      assert.equal(state.builtHash, null);
    }
  });

  it("the proxy has no version to name: none is invented", async () => {
    const { exec } = fakeExec(() => ({ stdout: "some-hash|1.49.1" }));
    const proxy = (await inspectFleetImages(null, exec)).find(
      (s) => s.key === FLEET_IMAGE_KEY.proxy,
    )!;
    assert.equal(proxy.builtVersion, null);
    assert.equal(proxy.currentVersion, null);
    assert.equal(proxy.makeTarget, "image-proxy");
  });

  it("an unreadable repo accuses NOTHING: without a current hash there is no evidence of drift", () => {
    assert.equal(driftOf(true, "some-hash", null), false);
    assert.equal(driftOf(false, null, "some-hash"), false);
    assert.equal(driftOf(true, null, "some-hash"), true);
  });

  it("each image is inspected on the TARGET daemon, with its own tag", async () => {
    const { exec, calls } = fakeExec(() => ({ stdout: "x|y" }));
    await inspectFleetImages("ssh://mac.local", exec);
    assert.equal(calls.length, FLEET_IMAGES.length);
    for (const spec of FLEET_IMAGES)
      assert.ok(
        calls.some((c) => c[0] === "image" && c[1] === "inspect" && c[2] === spec.tag),
        `${spec.tag} must be inspected`,
      );
  });
});

/** A fake `docker` on PATH logging its calls to a file: judges the script's DECISION without a
 *  daemon or gigabytes of Playwright base. */
function fakeDockerBin(name: string): { bin: string; log: string } {
  const bin = join(tmp, name);
  mkdirSync(bin, { recursive: true });
  const log = join(bin, "calls.log");
  const path = join(bin, "docker");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      'echo "$@" >>"$FAKE_DOCKER_LOG"',
      'if [ "$1 $2" = "image inspect" ]; then',
      '  [ -n "$FAKE_BUILT_LABEL" ] || exit 1',
      '  echo "$FAKE_BUILT_LABEL"',
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return { bin, log };
}

/** Runs `fleet-image.sh build` against the fake docker and returns the command lines seen. */
function runBuild(
  fixture: string,
  built: string | null,
  env: NodeJS.ProcessEnv = {},
): {
  out: string;
  calls: string[];
} {
  const { bin, log } = fakeDockerBin(`bin-${fixture}`);
  rmSync(log, { force: true });
  writeFileSync(log, "");
  const dir = fixtureContext(fixture);
  const out = shell(["build", "legion-browser:latest", dir], {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    FAKE_DOCKER_LOG: log,
    FAKE_BUILT_LABEL: built ?? "",
    ...env,
  });
  const calls = execFileSync("cat", [log], { encoding: "utf8" }).split("\n").filter(Boolean);
  return { out, calls };
}

describe("ONLY what changed is rebuilt", () => {
  it("unchanged context: no rebuild, and the log says so", () => {
    // The expected label is the context hash itself, as an up-to-date image carries.
    const hash = shell(["hash", fixtureContext("unchanged")]);
    const { out, calls } = runBuild("unchanged", hash);
    assert.match(out, /unchanged/);
    assert.ok(!calls.some((c) => c.startsWith("build ")), `a build happened: ${calls.join(" | ")}`);
  });

  it("modified context: rebuild, with the new hash stamped as label", () => {
    const { out, calls } = runBuild("modified", "previous-hash");
    const hash = contextHash(join(tmp, "modified"), "/");
    assert.match(out, /\bchanged \(/);
    const build = calls.find((c) => c.startsWith("build "));
    assert.ok(build, `no build: ${calls.join(" | ")}`);
    assert.ok(build!.includes(`--label ${CONTEXT_HASH_LABEL}=${hash}`), build);
    assert.ok(build!.includes("-t legion-browser:latest"), build);
  });

  it("image missing from the daemon: built, without claiming drift", () => {
    const { out, calls } = runBuild("missing", null);
    assert.match(out, /no hash stamped/);
    assert.ok(calls.some((c) => c.startsWith("build ")));
  });

  it("`FLEET_IMAGE_FORCE=1` rebuilds even with an equal hash: the escape hatch", () => {
    const hash = shell(["hash", fixtureContext("forced")]);
    const { calls } = runBuild("forced", hash, { FLEET_IMAGE_FORCE: "1" });
    assert.ok(calls.some((c) => c.startsWith("build ")));
  });

  it("arguments after the context reach `docker build`: how the browser stamps its version", () => {
    const { bin, log } = fakeDockerBin("bin-extra");
    writeFileSync(log, "");
    const dir = fixtureContext("extra");
    shell(["build", "legion-browser:latest", dir, "--label", "legion.playwright-version=1.62.1"], {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_DOCKER_LOG: log,
      FAKE_BUILT_LABEL: "",
    });
    const calls = execFileSync("cat", [log], { encoding: "utf8" });
    assert.match(calls, /--label legion\.playwright-version=1\.62\.1/);
  });
});
