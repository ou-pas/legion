// Drift guard (task zsqFzAcMxG, 03/09): `chromium.connect()` refuses a handshake between Playwright
// client and server of different versions. On 26/08 the repo was on playwright-core 1.62.1 while
// the browser service still ran 1.49.1; an agent with the browser grant spent thirty-three minutes
// building Chromium by hand in its container until the kernel killed it (OOM, exit 137).
//
// Four pins, nothing linking them: the repo lockfile (web/package.json), the service image
// (browser-image/Dockerfile, base AND `npm install`), and the session image client
// (session-image/Dockerfile). This test fails if one diverges.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

/** The repo's `playwright-core`. The caret range is not the installed version: compare with what
 *  the lockfile resolved. */
function webPackageVersion(): string {
  const pkg = JSON.parse(read("web/package.json"));
  const range = pkg.dependencies?.["playwright-core"] ?? pkg.devDependencies?.["playwright-core"];
  assert.ok(range, "web/package.json must declare playwright-core");
  const locked = read("pnpm-lock.yaml").match(/^\s*playwright-core@(\d+\.\d+\.\d+):/m);
  assert.ok(locked, "pnpm-lock.yaml must resolve an exact version for playwright-core");
  return locked[1]!;
}

/** TWO lines carry the version: the pinned base (`FROM …/playwright:vX.Y.Z-noble`, never `latest`)
 *  and the `playwright` npm package installed on top for `run-server`. */
function browserImageVersions(): { base: string; npm: string } {
  const dockerfile = read("browser-image/Dockerfile");
  const base = dockerfile.match(/^FROM\s+mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-\S+/m);
  assert.ok(
    base,
    "browser-image/Dockerfile must pin a mcr.microsoft.com/playwright:vX.Y.Z-<distro> base (never `latest`)",
  );
  const npm = dockerfile.match(/npm install playwright@(\d+\.\d+\.\d+)/);
  assert.ok(npm, "browser-image/Dockerfile must pin `npm install playwright@X.Y.Z`");
  return { base: base[1]!, npm: npm[1]! };
}

/** The CLIENT: `playwright-core`, never `playwright` (no browser binaries, only `chromium.connect()`). */
function sessionImageVersion(): string {
  const dockerfile = read("session-image/Dockerfile");
  const npm = dockerfile.match(/npm install[^\n]*playwright-core@(\d+\.\d+\.\d+)/);
  assert.ok(npm, "session-image/Dockerfile must pin `playwright-core@X.Y.Z` in its `npm install`");
  return npm[1]!;
}

describe("playwright-core version: repo, browser service, session client", () => {
  it("the four pins agree: web/package.json, browser-image/Dockerfile (base + npm), session-image/Dockerfile", () => {
    const web = webPackageVersion();
    const browser = browserImageVersions();
    const session = sessionImageVersion();

    const report = `
  web/package.json (resolved by pnpm-lock.yaml) : ${web}
  browser-image/Dockerfile — official base       : ${browser.base}
  browser-image/Dockerfile — npm install playwright : ${browser.npm}
  session-image/Dockerfile — npm install playwright-core : ${session}`;

    assert.equal(
      browser.base,
      web,
      `the browser-image/Dockerfile base (${browser.base}) diverges from the repo's playwright-core (${web}).` +
        ` chromium.connect() refuses a client/server mismatch — fix browser-image/Dockerfile.${report}`,
    );
    assert.equal(
      browser.npm,
      web,
      `browser-image/Dockerfile's \`npm install playwright@${browser.npm}\` diverges from the repo's playwright-core (${web}).` +
        ` fix browser-image/Dockerfile.${report}`,
    );
    assert.equal(
      session,
      web,
      `session-image/Dockerfile's \`playwright-core@${session}\` diverges from the repo's (${web}).` +
        ` chromium.connect() refuses a client/server mismatch — fix session-image/Dockerfile.${report}`,
    );
  });
});
