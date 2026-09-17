// repo-grants: what the spec grants, and what is on disk without being granted.
//
// `grantedRepos` reads the spec (moved out of repos on 09/09, unchanged). `strayRepoDirs` looks at
// `repos/` and returns what the spec did not put there: a clone the agent made itself.
//
// The outage behind this module (09/09, task ZsbmD_N-zS): the agent had one granted repository,
// asked for a second through the inbox, got a "yes" nothing on the server honours, then ran
// `git clone` into `repos/` and made two commits there. `pushRepos` only knows the spec: it pushed
// the granted repository with no change, the task went to `review` clean, and the commits stayed in
// a volume `pruneWorkspace` erases at the next wake-up. No screen said so. We still do not push it
// (no URL, no grant), but the trace says it.
import fsSync from "node:fs";

import type { RepoGrant, SessionSpec } from "./session-spec.mjs";
import type { Report } from "./runner-io.mjs";

/** A granted repository once cloned: the spec's grant plus where it sits on this container's disk.
 *  The shape modules receive (the prompt cites it, `capabilities` scans its `.claude/rules`, `repos`
 *  commits in it); it lives here, the module of granted-repository vocabulary. */
export type ClonedRepo = RepoGrant & { dir: string };

/**
 * The repositories granted by the spec (v7), each cloned later into ./repos/<name> on the run's
 * shared branch. Backward compatibility: an old spec (repoUrl/repoAccess) becomes a single "repo".
 */
export function grantedRepos({
  spec,
}: {
  spec: Pick<SessionSpec, "repos" | "repoUrl" | "repoAccess">;
}): RepoGrant[] {
  if (Array.isArray(spec.repos))
    return spec.repos.filter((r) => r && /^[\w][\w.-]*$/.test(r.name) && r.url);
  // The cast keeps the compatibility branch as it was: an old spec could carry `repoUrl` without
  // `repoAccess`, access then being `undefined`. Inventing a default would change behaviour in
  // code no server feeds any more.
  if (spec.repoUrl && spec.repoAccess !== "none")
    return [{ name: "repo", url: spec.repoUrl, access: spec.repoAccess as RepoGrant["access"] }];
  return [];
}

/** Folders in `repos/` the spec does not grant: clones made by the agent. */
export function strayRepoDirs(repos: { name: string }[]): string[] {
  const dir = `${process.env.LEGION_WORKDIR ?? process.cwd()}/repos`;
  const granted = new Set(repos.map((r) => r.name));
  try {
    return fsSync
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !granted.has(e.name))
      .map((e) => e.name);
  } catch {
    return []; // no `repos/` folder: nothing granted, nothing stray
  }
}

/** One `run_warning` per stray repository, before the final push, so review reads the cause. */
export async function warnStrayRepos({ report }: { report: Report }, repos: { name: string }[]) {
  for (const name of strayRepoDirs(repos)) {
    await report("run_warning", {
      message: `repos/${name} is not a granted repository: cloned by the agent, it is not pushed and will be erased at the next start`,
    });
  }
}
