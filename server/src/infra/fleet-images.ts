// Shared fleet images: what is deployed, and what the repo says (03/09).
//
// The session image has long had its drift signal (`legion.payload-hash`); the proxy and browser
// images had none and were not rebuilt by updates. On 03/09 a Playwright resync was merged, the
// service kept the old version, `chromium.connect()` refused the handshake, and an agent spent
// thirty-three minutes looking in the wrong place.
//
// This is the READ side of `scripts/fleet-image.sh`'s criterion: the script stamps the context
// folder hash at build time; this module recomputes it and compares with what a runner's daemon
// REALLY holds. The hashing scheme is a cross-language contract, checked by `fleet-images.test.ts`.
//
// Failure direction: if they diverge the screen calls the image stale forever, which is noisy and
// fixable. The reverse (stale declared fresh) costs half a day.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCKER_PROBE_MS, type DockerExec, docker } from "../shared/docker-exec.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** From this file, not `process.cwd()`: the control plane runs from `server/` or `/app/server`. */
export const REPO_ROOT = path.resolve(HERE, "../../..");

/** Shared with `scripts/fleet-image.sh`: changing one side makes every image stale. */
export const CONTEXT_HASH_LABEL = "legion.context-hash";
/** The hash says THERE IS drift; this version says WHICH, the sentence missing on 03/09. */
export const PLAYWRIGHT_VERSION_LABEL = "legion.playwright-version";

/** Defined here so the Infra screen and the runner talk about the SAME image. */
export const BROWSER_IMAGE = process.env.LEGION_BROWSER_IMAGE ?? "legion-browser:latest";
export const PROXY_IMAGE = process.env.LEGION_PROXY_IMAGE ?? "legion-proxy:latest";
/** The SESSION image, deliberately outside `FLEET_IMAGES` (its drift uses the payload hash). */
export const SESSION_IMAGE = process.env.LEGION_SESSION_IMAGE ?? "legion-session:latest";

/** ALL payload SOURCES in the session image, in the SAME order as the Makefile's `image-session`
 *  recipe. The folder is read rather than a hand-written list, which once silently dropped a
 *  module. `.mts` sources are hashed (since 10/09), not the compiled `.mjs`. */
export const payloadFiles = (): string[] =>
  fs
    .readdirSync(path.resolve(REPO_ROOT, "runner-payload"))
    .filter((f) => f.endsWith(".mts"))
    .sort()
    .map((f) => path.join(REPO_ROOT, "runner-payload", f));

/** sha256 of the per-file sha256 list, one per line, in `payloadFiles()` order: IDENTICAL to the
 *  `image-session` recipe and `scripts/project-image.sh`, cross-checked by `infra.test.ts` and
 *  `images/project.test.ts`. A noisy mismatch is intended. */
export function currentPayloadHash(): string | null {
  try {
    const each = payloadFiles().map((f) =>
      crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"),
    );
    return crypto
      .createHash("sha256")
      .update(each.map((h) => `${h}\n`).join(""))
      .digest("hex");
  } catch {
    return null;
  }
}

export const FLEET_IMAGE_KEY = { browser: "browser", proxy: "proxy" } as const;
export type FleetImageKey = (typeof FLEET_IMAGE_KEY)[keyof typeof FLEET_IMAGE_KEY];

export interface FleetImageSpec {
  key: FleetImageKey;
  tag: string;
  /** Relative to the repo root; what the hash covers. */
  contextDir: string;
  /** Named in the update log. */
  makeTarget: string;
}

/** The two shared images, in rebuild order. The session image is not here: it changes almost every
 *  update and always rebuilds. Two mechanisms for two questions: "is my payload the repo's?" versus
 *  "must I pay a multi-gigabyte build?". */
export const FLEET_IMAGES: readonly FleetImageSpec[] = [
  {
    key: FLEET_IMAGE_KEY.browser,
    tag: BROWSER_IMAGE,
    contextDir: "browser-image",
    makeTarget: "image-browser",
  },
  {
    key: FLEET_IMAGE_KEY.proxy,
    tag: PROXY_IMAGE,
    contextDir: "proxy-image",
    makeTarget: "image-proxy",
  },
];

/** `null` when unreadable, and an absence is NEVER drift (see `driftOf`).
 *
 *  Same scheme as `context_hash()` in `scripts/fleet-image.sh`: sha256 of
 *  "<file sha256><two spaces><relative path>" lines, byte-sorted. The path counts: a rename changes
 *  the image. */
export function contextHash(contextDir: string, root: string = REPO_ROOT): string | null {
  const dir = path.resolve(root, contextDir);
  try {
    const files = walkFiles(dir).sort(compareBytes);
    const lines = files.map((rel) => {
      const digest = crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(dir, rel)))
        .digest("hex");
      return `${digest}  ${rel}\n`;
    });
    return crypto.createHash("sha256").update(lines.join("")).digest("hex");
  } catch {
    return null;
  }
}

/** Relative paths, dotfiles included, like the script's `find . -type f` (symlinks ignored). */
function walkFiles(dir: string, prefix = ""): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) return walkFiles(path.join(dir, e.name), rel);
    return e.isFile() ? [rel] : [];
  });
}

/** `LC_ALL=C sort`: byte order. `localeCompare` depends on the machine and would give two hashes. */
function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** The repo's pinned Playwright, from `browser-image/Dockerfile`'s `FROM` line (as stamped by
 *  `scripts/fleet-image.sh`). `null` on another shape, where `browser-version.test.ts` fails. */
export function repoPlaywrightVersion(root: string = REPO_ROOT): string | null {
  try {
    const dockerfile = fs.readFileSync(path.resolve(root, "browser-image/Dockerfile"), "utf8");
    return dockerfile.match(/^FROM .*playwright:v([0-9][0-9.]*)-/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** One shared image on one runner, for the Infra screen. */
export interface FleetImageState {
  key: FleetImageKey;
  tag: string;
  makeTarget: string;
  /** Missing is not drift, it is absence, and they are said differently. */
  present: boolean;
  /** `null` if built before this label existed. */
  builtHash: string | null;
  currentHash: string | null;
  stale: boolean;
  /** Readable version (Playwright for the browser); `null` on both sides for the proxy. */
  builtVersion: string | null;
  currentVersion: string | null;
}

/** Null `currentHash` (repo unreadable from here) is not drift: no evidence. Null `builtHash` on a
 *  PRESENT image (built before the label) IS drift: its content is unknown, and saying so is the
 *  only way it shows. */
export function driftOf(
  present: boolean,
  builtHash: string | null,
  currentHash: string | null,
): boolean {
  if (!present || currentHash === null) return false;
  return builtHash !== currentHash;
}

/** `{{index .Config.Labels "x"}}` returns `<no value>` for a missing label. Also used by
 *  `sessions/runner/browser-service.ts` for the same docker output. */
export function labelValue(raw: string): string | null {
  const v = raw.trim();
  return v && v !== "<no value>" ? v : null;
}

/** One `docker image inspect` per image, in parallel: `/api/infra` refetches every 10 s and each
 *  call over `ssh://` costs a connection. A silent daemon gives `present: false`. */
export async function inspectFleetImages(
  dockerHost: string | null,
  exec: DockerExec = docker,
  root: string = REPO_ROOT,
): Promise<FleetImageState[]> {
  const currentVersion = repoPlaywrightVersion(root);
  return Promise.all(
    FLEET_IMAGES.map(async (spec) => {
      const currentHash = contextHash(spec.contextDir, root);
      const format = `{{index .Config.Labels "${CONTEXT_HASH_LABEL}"}}|{{index .Config.Labels "${PLAYWRIGHT_VERSION_LABEL}"}}`;
      const r = await exec(
        ["image", "inspect", spec.tag, "--format", format],
        dockerHost,
        DOCKER_PROBE_MS,
      );
      const present = r.code === 0;
      const [rawHash = "", rawVersion = ""] = present ? r.stdout.trim().split("|") : [];
      const builtHash = present ? labelValue(rawHash) : null;
      return {
        key: spec.key,
        tag: spec.tag,
        makeTarget: spec.makeTarget,
        present,
        builtHash,
        currentHash,
        stale: driftOf(present, builtHash, currentHash),
        // Only for the browser: the proxy pins no Playwright.
        builtVersion:
          spec.key === FLEET_IMAGE_KEY.browser && present ? labelValue(rawVersion) : null,
        currentVersion: spec.key === FLEET_IMAGE_KEY.browser ? currentVersion : null,
      };
    }),
  );
}
