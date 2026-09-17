// A project's session image (09/09). The Dockerfile is pasted into the project config
// (`projects.session_dockerfile`, v67), not cloned from its repo: v66 cloned the repo on the docker
// host to read `.legion/Dockerfile`, which raised questions (which repo, cloning without a token,
// keeping it fresh) for what is only a thin layer (`FROM legion-session:latest` plus an `apt-get`).
//
// Both tag and Dockerfile come from the database; hashes are compared with what a runner's daemon
// REALLY holds, never a diff between tags (same principle as `fleet-images.ts`).
//
// Silent payload drift (defect 3): a project image is built ON `legion-session:latest` and bakes a
// copy of the runner payload. The compared hash therefore COMBINES the current payload and the
// project Dockerfile: both drifts count.
//
// Trust: the Dockerfile is config, never reviewed like the fleet images. `validateProjectDockerfile`
// is the contract (first instruction exactly `FROM <base>`, then only RUN, ENV or USER; no COPY
// since there is no build context). Its shell twin `scripts/project-image.sh` (`validate_dockerfile`)
// is what really protects, at build time; `project.test.ts` cross-checks both.
import crypto from "node:crypto";
import { DOCKER_PROBE_MS, type DockerExec, docker } from "../../shared/docker-exec.js";
import { REBUILD_KO_ONE, shQuote } from "../../shared/shell.js";
import { SESSION_IMAGE, currentPayloadHash, labelValue } from "../fleet-images.js";
import { dockerRunnerRefs } from "../runner-store.js";
import { projectImageDeclarations } from "./project-store.js";

/** Same name as `scripts/project-image.sh` stamps; changing one alone makes every project image
 *  permanently stale. */
export const PROJECT_IMAGE_HASH_LABEL = "legion.project-image-hash";

export type DockerfileVerdict = { ok: true } | { ok: false; error: string };

/** The trust rule, read side (show an error before "Build here"). `scripts/project-image.sh`
 *  enforces it at build time; both MUST agree, `project.test.ts` compares them.
 *
 *  A line ending with `\` continues the previous instruction, or a multi-line `RUN` would be
 *  refused on its second line.
 *
 *  `USER` accepted since 12/09 (operator's decision after a real rebuild): the base ends with
 *  `USER agent` (no sudo), so the first `RUN apt-get` failed with exit 100, and installing an
 *  interpreter is the whole point of the feature.
 *
 *  The cost: a Dockerfile that does not return to `USER agent` yields sessions running as root.
 *  Nothing here prevents it. */
export function validateProjectDockerfile(content: string, baseImage: string): DockerfileVerdict {
  const allowed = new Set(["RUN", "ENV", "USER"]);
  let sawFrom = false;
  let continuing = false;
  for (const raw of content.split(/\r?\n/)) {
    const t = raw.trim();
    if (continuing) {
      continuing = t.endsWith("\\");
      continue;
    }
    if (t === "" || t.startsWith("#")) continue;
    if (!sawFrom) {
      const norm = t.replace(/\s+/g, " ");
      if (norm !== `FROM ${baseImage}`)
        return {
          ok: false,
          error: `the first instruction must be “FROM ${baseImage}”, found: ${t}`,
        };
      sawFrom = true;
      continuing = t.endsWith("\\");
      continue;
    }
    const word = (/^(\S+)/.exec(t)?.[1] ?? "").toUpperCase();
    if (!allowed.has(word))
      return {
        ok: false,
        error: `instruction refused “${word}” (only RUN, ENV and USER are accepted after FROM — no build context, so no COPY): ${t}`,
      };
    continuing = t.endsWith("\\");
  }
  if (!sawFrom) return { ok: false, error: `dockerfile empty or without FROM ${baseImage}` };
  return { ok: true };
}

/** Both drifts (defect 3) in ONE hash, same scheme as `scripts/project-image.sh`:
 *  `sha256("<payload>:<dockerfile>")`. */
export function combinedImageHash(payloadHash: string, dockerfileHash: string): string {
  return crypto.createHash("sha256").update(`${payloadHash}:${dockerfileHash}`).digest("hex");
}

/** One project's image on one runner. `null` (from `projectImageState`) when the project declares
 *  no tag: sessions run on the base, covered by `sessionImageState`. */
export interface ProjectImageState {
  tag: string;
  dockerfile: { present: boolean; valid: boolean; error: string | null };
  present: boolean;
  builtHash: string | null;
  currentHash: string | null;
  stale: boolean;
  rebuilding: boolean;
}

export interface ProjectForImage {
  id: string;
  sessionImage: string | null;
  sessionDockerfile: string | null;
}

export interface ProjectImageDeps {
  exec?: DockerExec;
  rebuilding?: (runnerId: string, projectId: string) => Promise<boolean>;
}

export async function projectImageState(
  runner: { id: string; dockerHost: string | null },
  project: ProjectForImage,
  deps: ProjectImageDeps = {},
): Promise<ProjectImageState | null> {
  const tag = project.sessionImage?.trim();
  if (!tag) return null;
  return projectImageStateForTag(runner, project, tag, deps);
}

function projectDockerfileState(dockerfileContent: string | null): {
  present: boolean;
  valid: boolean;
  error: string | null;
} {
  const verdict =
    dockerfileContent !== null ? validateProjectDockerfile(dockerfileContent, SESSION_IMAGE) : null;
  return {
    present: dockerfileContent !== null,
    valid: verdict?.ok ?? false,
    error: verdict && !verdict.ok ? verdict.error : null,
  };
}

/** `null` while the Dockerfile is invalid: it would compare with a build that cannot succeed. */
function expectedImageHash(
  dockerfileContent: string | null,
  dockerfileValid: boolean,
): string | null {
  const payloadHash = currentPayloadHash();
  const dockerfileHash =
    dockerfileContent !== null
      ? crypto.createHash("sha256").update(dockerfileContent).digest("hex")
      : null;
  return payloadHash !== null && dockerfileHash !== null && dockerfileValid
    ? combinedImageHash(payloadHash, dockerfileHash)
    : null;
}

/** Separate from the guard so callers that already checked the tag need no `!`. */
async function projectImageStateForTag(
  runner: { id: string; dockerHost: string | null },
  project: ProjectForImage,
  tag: string,
  deps: ProjectImageDeps,
): Promise<ProjectImageState> {
  const exec = deps.exec ?? docker;

  const dockerfileContent = project.sessionDockerfile?.trim() || null;
  const dockerfile = projectDockerfileState(dockerfileContent);
  const currentHash = expectedImageHash(dockerfileContent, dockerfile.valid);

  const img = await exec(
    ["image", "inspect", tag, "--format", `{{index .Config.Labels "${PROJECT_IMAGE_HASH_LABEL}"}}`],
    runner.dockerHost,
    DOCKER_PROBE_MS,
  );
  const rebuilding = (await deps.rebuilding?.(runner.id, project.id)) ?? false;
  if (img.code !== 0)
    return {
      tag,
      dockerfile,
      present: false,
      builtHash: null,
      currentHash,
      stale: false,
      rebuilding,
    };
  const builtHash = labelValue(img.stdout);
  const stale = currentHash !== null && (builtHash === null || builtHash !== currentHash);
  return { tag, dockerfile, present: true, builtHash, currentHash, stale, rebuilding };
}

export interface ProjectImageRunner {
  runnerId: string;
  runnerName: string;
  image: ProjectImageState;
}

/** The image this project REALLY uses, on every docker runner (defect 2). ALL docker runners,
 *  enabled or not: a disabled one may carry an image nobody rebuilt before turning it back on (same
 *  as `/api/infra`). */
export async function projectImageOverview(
  project: ProjectForImage,
  deps: ProjectImageDeps = {},
): Promise<ProjectImageRunner[] | null> {
  const tag = project.sessionImage?.trim();
  if (!tag) return null;
  const runners = dockerRunnerRefs();
  return Promise.all(
    runners.map(async (r) => ({
      runnerId: r.id,
      runnerName: r.name,
      image: await projectImageStateForTag(
        { id: r.id, dockerHost: r.dockerHost },
        project,
        tag,
        deps,
      ),
    })),
  );
}

export interface ProjectImageTarget {
  projectId: string;
  tag: string;
  dockerfile: string;
}

/** Projects declaring both a tag and a Dockerfile: what a base rebuild must replay (defect 3), in
 *  the fleet update (`docker-update.ts`) and in "Rebuild here" on the session image
 *  (`images/rebuild.ts`). Without a Dockerfile there is nothing to rebuild. */
export function projectImageTargets(): ProjectImageTarget[] {
  return projectImageDeclarations().flatMap((p) => {
    const tag = p.sessionImage?.trim();
    const dockerfile = p.sessionDockerfile?.trim();
    if (!tag || !dockerfile) return [];
    return [{ projectId: p.id, tag, dockerfile }];
  });
}

/** A project image seen from ONE runner, added by the Infra card next to the session image. */
export interface RunnerProjectImage {
  projectId: string;
  projectName: string;
  image: ProjectImageState;
}

/** Every declared project image seen from this runner: `projectImageOverview` with the runner fixed.
 *
 *  The Infra card only probed the DEFAULT tag, never a project's image, which is what its launches
 *  use (`sessionImageFor`): launches were refused for "missing image" while the card said "present"
 *  (spec `/artifacts/J5tmew3aT8`).
 *
 *  One row per project, not per tag: two projects may share a tag, and merging would hide WHICH
 *  launch fails.
 *
 *  No button here on purpose: the action lives on the project page
 *  (`POST /api/projects/:id/session-image/rebuild`); the card points to it. */
export async function runnerProjectImages(
  runner: { id: string; dockerHost: string | null },
  deps: ProjectImageDeps = {},
): Promise<RunnerProjectImage[]> {
  const withTag = projectImageDeclarations().flatMap((p) => {
    const tag = p.sessionImage?.trim();
    return tag ? [{ project: p, tag }] : [];
  });
  return Promise.all(
    withTag.map(async ({ project, tag }) => ({
      projectId: project.id,
      projectName: project.name,
      image: await projectImageStateForTag(runner, project, tag, deps),
    })),
  );
}

/** Shell lines rebuilding a project image, shared by the targeted click (`project-rebuild.ts`) and
 *  the cascade after a base rebuild (defect 3: `updates/docker-update.ts`, `images/rebuild.ts`),
 *  without which derived project images stay stale until a manual click.
 *
 *  Uses `$RUNNER_NAME`/`$RUNNER_HOST` set by the caller, as `rebuildOneImageLines`; a failure is an
 *  `if`, so it does not stop the script. The Dockerfile travels as a single-quoted argument,
 *  newlines included: nothing to clone or mount. */
export function projectImageRebuildLines(target: ProjectImageTarget): string[] {
  const args = [shQuote(target.tag), shQuote(SESSION_IMAGE), shQuote(target.dockerfile)].join(" ");
  return [
    `if DOCKER_HOST="$RUNNER_HOST" sh scripts/project-image.sh build ${args}; then`,
    `  say "  ✓ $RUNNER_NAME: ${target.tag} image up to date"`,
    "else",
    `  ${REBUILD_KO_ONE}`,
    `  say "  ⛔ $RUNNER_NAME: ${target.tag} image — rebuild failed, no consequence for this update; a manual “Rebuild here” will catch up"`,
    "fi",
  ];
}
