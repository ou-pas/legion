// The payload hash is a cross-language contract: a shell pipe in the Makefile's `image-session`
// recipe stamps the label, and `currentPayloadHash()` recomputes it to tell whether the image is
// stale. This test runs BOTH and compares.
//
// Failure direction: divergence makes the image permanently stale, noisy and fixable. The reverse
// runs sessions on a payload three versions old, silently.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { currentPayloadHash, launchBlocker, payloadFiles } from "./infra.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MAKEFILE = resolve(ROOT, "Makefile");

/** `shasum -a 256` on macOS, `sha256sum` elsewhere. */
function hasher(): string | null {
  for (const cmd of ["sha256sum", "shasum"]) {
    try {
      execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "pipe" });
      return cmd;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

describe("payload hash", () => {
  it("the Makefile's shell scheme and currentPayloadHash() give the SAME value", () => {
    const cmd = hasher();
    if (!cmd) return; // neither sha256sum nor shasum: nothing to compare
    const h = cmd === "shasum" ? "shasum -a 256" : "sha256sum";
    // Rewritten by hand rather than extracted from the Makefile: two independent formulations.
    const shell = execFileSync(
      "sh",
      [
        "-c",
        `cd '${ROOT}' && ls runner-payload/*.mts | LC_ALL=C sort ` +
          `| while read -r f; do ${h} "$f" | cut -d' ' -f1; done | ${h} | cut -d' ' -f1`,
      ],
      { encoding: "utf8" },
    ).trim();

    assert.match(shell, /^[0-9a-f]{64}$/, "the shell pipe must return a sha256");
    assert.equal(currentPayloadHash(), shell);
  });

  it("the Makefile keeps no list: it copies and hashes the FOLDER", () => {
    // First the recipe hashed one file; then a ten-path list, which caused the 04/09 outage
    // (`turn-outcome.mjs` missing from every list, whole fleet down). No module name in the recipe.
    if (!existsSync(MAKEFILE)) return;
    // `image-session` since 26/08: only this image reads the payload.
    const recipe = execFileSync("sh", ["-c", `awk '/^image-session:/,/^$/' '${MAKEFILE}'`], {
      encoding: "utf8",
    });
    // Command lines only: comments cite module names while telling the incident.
    const commands = recipe
      .split("\n")
      .filter((l) => l.startsWith("\t") && !l.trimStart().startsWith("@#"))
      .join("\n");
    // The recipe needs ONLY docker (13/09): the rebuild container and the control plane server have
    // no node or pnpm. Compilation moved to the Dockerfile's `payload` stage.
    const outils = ["pnpm", "npm ", "npx ", "node ", "tsc"].filter((o) => commands.includes(o));
    assert.deepEqual(
      outils,
      [],
      `the recipe calls ${outils.join(", ")} — a fleet machine only has docker`,
    );
    assert.match(
      commands,
      /ls runner-payload\/\*\.mts \| LC_ALL=C sort/,
      "and the hash too, in a fixed order",
    );
    // The context is the ROOT with an explicit Dockerfile: without `-f` it would pick the root one,
    // the control plane's.
    assert.match(
      commands,
      /docker build .*-f session-image\/Dockerfile \.$/m,
      "the context carries `runner-payload/`, or the compile stage lacks its sources",
    );
    const named = [...commands.matchAll(/runner-payload\/([\w.-]+\.mts)/g)].map((m) => m[1]!);
    assert.deepEqual(
      named,
      [],
      `the recipe still names modules: ${named.join(", ")} — a list goes stale`,
    );
  });

  // The missing guardrail (04/09). Tests compared two lists with EACH OTHER, so when both forgot the
  // same file they agreed. `turn-outcome.mjs` (#102) was in none: four tasks died with `exit 1`,
  // since a module imported but not shipped breaks nothing locally and everything in the container.
  //
  // Lists are gone since 06/09 (the folder is read). This test follows the REAL imports from the
  // entry point and refuses both a missing import and a file nothing reaches.
  it("EVERY module the payload imports is shipped, and nothing shipped is orphan", () => {
    const embarques = payloadFiles().map((p) => basename(p));
    assert.ok(embarques.includes("session-runner.mts"), "the entry point must be there");

    /** Static and dynamic relative imports. The specifier is `.mjs` and the file `.mts`: under
     *  NodeNext an import names the COMPILED file, so `./repos.mjs` imports `repos.mts`. */
    const importsOf = (file: string): string[] =>
      [
        ...readFileSync(resolve(ROOT, "runner-payload", file), "utf8").matchAll(
          /(?:from\s+|import\s*\(\s*)["']\.\/([\w.-]+)\.mjs["']/g,
        ),
      ].map((m) => `${m[1]!}.mts`);

    // TRANSITIVE from session-runner.mts: some modules are only imported by other payload modules
    // (mcp-tools pulls fs-write-payload), and a first-level read would call them orphans.
    const atteints = new Set<string>();
    const file = ["session-runner.mts"];
    while (file.length) {
      const f = file.pop()!;
      if (atteints.has(f)) continue;
      atteints.add(f);
      // An import of a missing file cannot be walked; it is reported as missing below.
      for (const dep of importsOf(f)) if (embarques.includes(dep)) file.push(dep);
    }
    assert.ok(
      atteints.size > 1,
      "no relative import found — the reading pattern must have changed",
    );

    const tousImports = new Set(embarques.flatMap(importsOf));
    const manquants = [...tousImports].filter((f) => !embarques.includes(f));
    assert.deepEqual(
      manquants,
      [],
      `imported by the payload but missing from runner-payload/: ${manquants.join(", ")}`,
    );

    // The other direction: an unreachable file is dead weight and hints at a half-removed module.
    const orphelins = embarques.filter((f) => !atteints.has(f));
    assert.deepEqual(orphelins, [], `shipped but reached by nothing: ${orphelins.join(", ")}`);
  });

  it('"make image" still builds all THREE images', () => {
    // A fresh install must not stop building the proxy or browser; `image` stays the full target.
    if (!existsSync(MAKEFILE)) return;
    const full = execFileSync("sh", ["-c", `awk '/^image:/,/^$/' '${MAKEFILE}'`], {
      encoding: "utf8",
    });
    for (const t of ["image-session", "image-proxy", "image-browser"])
      assert.ok(full.includes(t), `"make image" must depend on ${t}`);
  });

  it("nothing that ignores the payload lives BELOW the final stage's COPY lines", () => {
    // Docker invalidates a layer and all after it: `corepack prepare` below the COPY lines
    // re-downloaded pnpm every lot. After the first COPY, no RUN.
    //
    // Final stage only (13/09): the `payload` stage compiles, which is necessarily a RUN below a COPY.
    const dockerfile = resolve(ROOT, "session-image/Dockerfile");
    if (!existsSync(dockerfile)) return;
    const all = readFileSync(dockerfile, "utf8").split("\n");
    const lastFrom = all.map((l) => l.startsWith("FROM ")).lastIndexOf(true);
    assert.ok(lastFrom >= 0, "the Dockerfile must have a stage");
    const lines = all.slice(lastFrom);
    const firstCopy = lines.findIndex((l) => l.startsWith("COPY "));
    assert.ok(firstCopy > 0, "the final stage must copy the payload");
    const runAfter = lines.slice(firstCopy).filter((l) => l.startsWith("RUN "));
    assert.deepEqual(
      runAfter,
      [],
      "a RUN below the COPY lines replays every lot: move it above if it does not read the payload",
    );
  });

  it("the .dockerignore lets in everything the Dockerfile copies from the context", () => {
    // Lived trap: `COPY stuck.mjs` failed with "not found" though the file was there, excluded by
    // the .dockerignore.
    //
    // Since 13/09 the context is the root, so BuildKit reads `session-image/Dockerfile.dockerignore`,
    // which allows FOLDERS: the first path segment is compared.
    const dockerfile = resolve(ROOT, "session-image/Dockerfile");
    const ignore = resolve(ROOT, "session-image/Dockerfile.dockerignore");
    if (!existsSync(dockerfile) || !existsSync(ignore)) return;
    // `COPY --from=` reads a STAGE, not the context: no `.dockerignore` applies.
    const copied = [
      ...readFileSync(dockerfile, "utf8").matchAll(/^COPY\s+(?!--from=)(.+)$/gm),
    ].flatMap((m) => m[1]!.trim().split(/\s+/).slice(0, -1));
    const allowed = readFileSync(ignore, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("!"))
      .map((l) => l.slice(1).trim());
    assert.ok(copied.length > 0, "the Dockerfile must copy at least one context file");
    for (const f of copied)
      assert.ok(
        allowed.includes(f.split("/")[0]!),
        `${f} is copied by the Dockerfile but excluded by Dockerfile.dockerignore`,
      );
  });
});

describe("what prevents any session from starting", () => {
  // 26/08: Docker off, `available` known but out of the way, an hour lost. This verdict puts the
  // information ON the path.
  const runner = (available: boolean, present = true) => ({ available, image: { present } });

  it("nothing to say when a runner is reachable and has its image", () => {
    assert.equal(launchBlocker([runner(true)]), null);
  });

  it("all runners unreachable: it is the daemon, nothing else counts", () => {
    assert.equal(launchBlocker([runner(false), runner(false)]), "daemon");
  });

  it("ONE reachable runner is enough: the reason for having several", () => {
    // The reverse trap: crying "Docker is dead" because a remote host went quiet while local runs.
    assert.equal(launchBlocker([runner(false), runner(true)]), null);
  });

  it("an unreachable daemon takes priority over the image: it cannot even be asked", () => {
    // `image.present` defaults to false on an unreachable runner; without this priority a daemon
    // outage would read as "missing image" and send toward a `make image` that cannot succeed.
    assert.equal(launchBlocker([runner(false, false)]), "daemon");
  });

  it("reachable daemon but no image: it is the image", () => {
    assert.equal(launchBlocker([runner(true, false)]), "image");
  });

  it("no enabled runner is NOT an outage", () => {
    // Missing configuration, not infrastructure down; an alarm banner would misstate it.
    assert.equal(launchBlocker([]), null);
  });
});
