// Forge vocabulary, screen side. One domain (projects), so it lives here, not in `ui/`.
//
// What this file prevents: "pull request" hardcoded on a screen that also shows a GitLab
// repository, where the right word is "merge request". Code keeps a neutral name (a change
// request); the human reads their forge's word.
//
// The secret name repeats the server's (`integrations/forge.ts`) on purpose: the front end must not
// query a route to show a field label. The cost is two duplicated strings; the check holding them
// is server side, where the run refusal names the expected secret.
import type { ForgeKind } from "../api/projects.js";
import { hostOfRepoUrl } from "./repo-url.js";

export const FORGE_KINDS: ForgeKind[] = ["github", "gitlab"];

type ForgeText = {
  /** The forge name as it is written. */
  label: string;
  /** "pull request" / "merge request": the word the human expects. */
  changeRequest: string;
  /** The project secret that must be ticked to push to this forge. */
  secretName: string;
  /** A URL example, for the add field. */
  urlExample: string;
};

const TEXT: Record<ForgeKind, ForgeText> = {
  github: {
    label: "GitHub",
    changeRequest: "pull request",
    secretName: "GITHUB_TOKEN",
    urlExample: "https://github.com/org/repo.git",
  },
  gitlab: {
    label: "GitLab",
    changeRequest: "merge request",
    secretName: "GITLAB_TOKEN",
    urlExample: "https://gitlab.com/group/subgroup/project.git",
  },
};

/** `null` = repo written before the forge question existed: the server reads it as GitHub, and the
 *  screen must say the same rather than show a gap. */
export function forgeText(forge: ForgeKind | null): ForgeText {
  return TEXT[forge ?? "github"];
}

/** An instance declared by one of the project's connections. `framagit.org` does not reveal itself
 *  by name, but a GitLab connection talking to `framagit.org` says so, and that is a fact. */
export type DeclaredInstance = { host: string; forge: ForgeKind };

/** The instances the project's connections declare, read from the field the provider asks for
 *  besides the token. The screen does not know the field is an instance: it knows a connected
 *  connection named a host, and a repository on that host belongs to that forge.
 *
 *  A connection that is not connected does not count: its field holds a suggested default, not a
 *  host someone confirmed, and inferring from a suggestion would be guessing. */
export function declaredInstances(
  connections: readonly {
    provider: string;
    connected: boolean;
    field: { suggestion: string } | null;
  }[],
): DeclaredInstance[] {
  const out: DeclaredInstance[] = [];
  for (const c of connections) {
    if (!c.connected || c.field === null) continue;
    // A provider that is not a forge is ignored: Linear connects like the other two and carries no
    // repository. Provider and forge names coincide for the two that are forges, and this check
    // verifies it rather than assume it.
    if (!isForgeKind(c.provider)) continue;
    const host = hostOfRepoUrl(c.field.suggestion);
    if (host !== null) out.push({ host, forge: c.provider });
  }
  return out;
}

function isForgeKind(kind: string): kind is ForgeKind {
  return (FORGE_KINDS as string[]).includes(kind);
}

/** The forge inferred from the typed URL. Mirror of server-side `forgeOfUrl` for public hosts, and
 *  deliberately as cautious: a host nothing names returns nothing, because a self-hosted instance
 *  does not reveal itself by name.
 *
 *  `declared` closes half of that gap (16/09): a self-hosted instance shows on the connection
 *  talking to it, so a project connected to `framagit.org` no longer has to answer "which forge"
 *  for a `framagit.org` repository. Only hosts no connection covers are still asked.
 *
 *  The host is read with `hostOfRepoUrl`, not a local `new URL()` (29/08): the server knows the scp
 *  form (`git@github.com:org/repo.git`) since v40 and this function did not, so the most common
 *  clone path's forge went unguessed. One host rule for the screen, as on the server. */
export function guessForge(
  url: string,
  declared: readonly DeclaredInstance[] = [],
): ForgeKind | null {
  const host = hostOfRepoUrl(url);
  if (host === null) return null;
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab";
  return declared.find((d) => d.host === host)?.forge ?? null;
}
