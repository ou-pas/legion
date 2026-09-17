// What the image knows about itself (01/09, multi-machine work, slice 08).
//
// Incident: on the first real Docker install, `/api/version` returned
// `{sha: "", branch: null, blocker: "detached", checkError: "no-slug"}`. `git` is not in the image
// and `.git` is not in the build context, so `readLocalGit()` queried a clone that does not exist,
// and the update button could never appear.
//
// So the version is stamped at build time: `deploy/Dockerfile` takes four ARGs, sets them as env
// vars, and this module reads them. Stamped rather than read from the mounted host clone (`/repo`):
// a clone describes the disk, an image describes the process, and between a `git pull` and the
// rebuild they differ, exactly when someone looks at the Version card.
//
// Accepted cost: `branch` is the build's, not the clone's today. The update container resets the
// clone to the target tag anyway (`docker-update.ts`).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describeTag, githubSlug, REPO_ROOT, type LocalGit } from "./git.js";

/** `bare` = a git clone (development, `tsx watch`); `docker` = the image. */
export type RuntimeMode = "bare" | "docker";

/**
 * The mode is read from a fact, not a setting: a setting could be set wrong, and `LEGION_MODE=bare`
 * in a container would reproduce the incident's empty values with no visible cause.
 *
 * `existsSync`, not `isDirectory()`: in a worktree `.git` is a file pointing to the real folder.
 */
export function runtimeMode(repoRoot: string = REPO_ROOT): RuntimeMode {
  return existsSync(join(repoRoot, ".git")) ? "bare" : "docker";
}

/** Stamped git state, plus whether the image was built with the version ARGs at all. */
export type StampedGit = LocalGit & { stamped: boolean };

/**
 * Pure: reads the env it is given, never `process.env`, so the image states are testable without
 * building images.
 *
 * `LEGION_GIT_DESCRIBE` uses `git describe --tags --long`, as `readLocalGit` does, so `describeTag`
 * serves both modes; a never-tagged repo gives "" and `lastTag` null.
 *
 * `LEGION_GIT_ORIGIN` carries the URL, not the slug: `githubSlug` already handles SSH aliases
 * (`git@github-legion:…`) and is tested; redoing it in shell in the Dockerfile would not be.
 */
export function stampedGit(env: NodeJS.ProcessEnv): StampedGit {
  const sha = (env.LEGION_GIT_SHA ?? "").trim();
  const branch = (env.LEGION_GIT_BRANCH ?? "").trim();
  const origin = (env.LEGION_GIT_ORIGIN ?? "").trim();
  const described = describeTag(env.LEGION_GIT_DESCRIBE ?? "");
  return {
    branch: branch && branch !== "HEAD" ? branch : null,
    sha,
    tag: described && described.ahead === 0 ? described.tag : null,
    lastTag: described?.tag ?? null,
    ahead: described?.ahead ?? 0,
    // A container has no working tree. This says nothing about the host clone, which may be dirty;
    // the update's `reset --hard` logs what it discards before discarding it.
    dirty: false,
    slug: origin ? githubSlug(origin) : null,
    // The sha is the witness: `deploy/up.sh` sets all four ARGs, a bare `docker build` leaves them
    // empty, and unlike a tag a sha is always there.
    stamped: sha !== "",
  };
}
