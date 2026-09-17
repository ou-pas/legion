// Checks BEFORE creating a container. A launch that will fail must fail here, where it costs
// nothing and the cause can be NAMED, not in the container after an agent spent an opus turn
// discovering it has no code.
//
// What motivated this file (20/08): cloning a private repo failed for lack of `GITHUB_TOKEN`, the
// runner reported it as a mere warning, and the session carried on WITHOUT the code. It reacted
// well (stopped and asked through the inbox) but only after starting a container and burning a
// model turn.
//
// Design rule: refuse only what is CERTAIN, without a network call.
//   · pushing without a credential is impossible, public or not → certain refusal;
//   · reading a repo that could be public may be legitimate → let it try, and the clone fails
//     plainly (the runner no longer turns it into a warning).
// Guessing "private" locally would mean asking GitHub: a guaranteed false positive on public repos,
// so we abstain.
//
// v29: the forge decides the credential, not a constant. This file used to set
// `GIT_HOST = "github.com"` and refuse everything else: a writable GitLab repo did not start, and
// the message advised hosting the repo on GitHub. The right check was never "is it github.com?" but
// "can we present a credential to this forge, and was it granted to this agent?". The table lives in
// integrations/forge.ts.
import {
  credentialFor,
  effectiveForge,
  hostOfRepoUrl,
  isSshRepoUrl,
  type ForgeKind,
} from "../integrations/forge.js";
import { REPO_ACCESS } from "../shared/enums.js";
import type { RepoAccess } from "../shared/enums.js";

export interface RepoGrant {
  name: string;
  url: string;
  /** The repo's DECLARED forge, if any. This module applies `effectiveForge` itself: the rule
   *  "declared, else certain host, else nothing" lives in ONE place, and no caller can forget it. */
  forge?: ForgeKind | null;
}

export interface Blocker {
  repo: string;
  /** What blocks, in one sentence saying what to do. */
  reason: string;
}

export interface PreflightInput {
  agentName: string;
  repoAccess: RepoAccess;
  /** The repos ACTUALLY granted to this agent (already filtered by `repoNames`). */
  grantedRepos: readonly RepoGrant[];
  /** Secrets ticked for this agent (`envSecretNames`). */
  grantedSecretNames: readonly string[];
  /** Secrets existing on the project: tells "to create" from "to tick". */
  projectSecretNames: readonly string[];
  /** v40: does the project declare an SSH key, and is it usable? `null` = no key.
   *
   *  It flips the verdict on a `git@…` URL: the same URL is a certain refusal without a key and a
   *  perfectly normal setup with one. The FILE check (exists, no passphrase) is done upstream by
   *  `inspectSshKey`; this receives its verdict, because a preflight module reading the disk is no
   *  longer testable. */
  sshKey: { path: string; problem: string | null } | null;
}

/** Empty = nothing certain blocks. */
export function repoBlockers(input: PreflightInput): Blocker[] {
  const { agentName, repoAccess, grantedRepos, grantedSecretNames, projectSecretNames, sshKey } =
    input;
  if (repoAccess === REPO_ACCESS.none || grantedRepos.length === 0) return [];

  const out: Blocker[] = [];
  for (const repo of grantedRepos) {
    const host = hostOfRepoUrl(repo.url);
    if (!host) {
      out.push({ repo: repo.name, reason: `unreadable URL: ${repo.url}` });
      continue;
    }

    // SSH: legitimate since v40, provided a key exists.
    //
    // This check used to refuse any non-https URL ("the container has no SSH key and never will").
    // That changed. The refusal moves to where it stays certain: a `git@…` URL without a key on the
    // project, or with a key the control plane cannot mount.
    //
    // A key COVERS the push: no token, no secret to tick, no forge to declare, so the https
    // credential block below is skipped.
    if (isSshRepoUrl(repo.url)) {
      if (!sshKey)
        out.push({
          repo: repo.name,
          reason: `SSH URL (${repo.url}) but the project declares no key: set the private key path under Project → Runtime, or use the repo's https URL.`,
        });
      else if (sshKey.problem) out.push({ repo: repo.name, reason: sshKey.problem });
      continue;
    }

    if (!repo.url.startsWith("https://")) {
      out.push({
        repo: repo.name,
        reason: `URL neither https nor SSH (${repo.url}): git will not know what to do with it inside the container.`,
      });
      continue;
    }

    // The only remaining certainty: PUSHING always needs a credential, public or private repo. For
    // reads we conclude nothing: a public repo clones with nothing.
    if (repoAccess !== REPO_ACCESS.write) continue;

    // Unknown forge: we do not know WHICH secret to present, so no push. Refusing here costs a
    // sentence; letting it through cost a container, a model turn and a push refused deep in the
    // log, or worse, a token presented to a host that should not have it.
    const forge = effectiveForge(repo);
    if (!forge) {
      out.push({
        repo: repo.name,
        reason: `unknown forge for host ${host}: declare it on the repo (Project → Repos), otherwise no credential can be presented at push time.`,
      });
      continue;
    }
    const { secretName } = credentialFor(forge);
    if (!grantedSecretNames.includes(secretName)) {
      out.push({
        repo: repo.name,
        reason: projectSecretNames.includes(secretName)
          ? `${secretName} exists on the project but is not granted to “${agentName}”: tick it under Agents → ${agentName} → Secrets.`
          : `${secretName} missing from the project secrets (repo hosted on ${host}): add it under Project → Secrets, then tick it for “${agentName}”.`,
      });
    }
  }
  return out;
}

/** One line per blocker, prefixed with the repo. */
export function blockerMessage(blockers: readonly Blocker[]): string {
  return blockers.map((b) => `repo “${b.repo}”: ${b.reason}`).join(" · ");
}

// The network wall.
//
// An agent with a LIMITED environment only goes out through the proxy, which matches the host
// against an allowlist. A granted repo whose host is not listed becomes unreachable, and the failure
// is the worst kind: the clone fails deep in the container, after a model turn, on a proxy refusal
// nobody reads.
//
// This check is CERTAIN, unlike "is the repo private?": the host is in the URL, the allowlist is in
// the database, and the proxy compares exactly those two strings.
//
// The wall is opt-in, and this file lied about it until 27/08. It claimed an agent with NO
// environment only reached the model API and the control plane, written on 25/08 when true.
// `d042ee2` made no environment equivalent to `open`, so that branch became UNREACHABLE
// (`networkBlockers` returns `[]` for `open`) while its text claimed the opposite. A dead message
// saying something false is worse than none: it passes for documentation.

/** The effective policy, as `buildNetworkPolicy` returns it. */
export type EffectiveNetwork =
  | { mode: "open" }
  | { mode: "limited"; allowedHosts: readonly string[] };

/** The proxy matches with `fnmatch` (see proxy-image/tinyproxy.conf): only the star is special, and
 *  `*.github.com` does NOT cover `github.com`. Reproduced here rather than an approximate
 *  `includes`: a preflight that disagrees with the wall is useless. */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (!p.includes("*")) return p === h;
    const rx = new RegExp(
      `^${p
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    );
    return rx.test(h);
  });
}

export interface NetworkPreflightInput {
  agentName: string;
  network: EffectiveNetwork;
  grantedRepos: readonly RepoGrant[];
}

/** Hosts the proxy always adds itself (docker.ts). Naming them avoids refusing a repo hosted there
 *  (which does not happen), but above all documents what an empty allowlist REALLY lets through. */
const ALWAYS_ALLOWED = ["api.anthropic.com"];

export function networkBlockers(input: NetworkPreflightInput): Blocker[] {
  if (input.network.mode === "open") return [];
  const allowed = [...input.network.allowedHosts, ...ALWAYS_ALLOWED];
  const out: Blocker[] = [];
  for (const repo of input.grantedRepos) {
    // `hostOfRepoUrl` rather than `new URL()`: a `git@github.com:o/r.git` repo returned `null` here
    // and left the check WITHOUT a word. Invisible while SSH was refused above; since v40 it was the
    // exact hole a legitimate repo escaped the wall through.
    const host = hostOfRepoUrl(repo.url);
    if (!host) continue; // unreadable URL: the neighbouring check says so, not this one
    if (hostAllowed(host, allowed)) continue;
    out.push({
      repo: repo.name,
      // Granted MCP server hosts are added to the allowlist when the spec is built; not counted
      // here: an MCP server also hosting a git repo does not exist, and counting it would mean
      // resolving MCPs (decryption included) a second time at every launch.
      reason: `${host} is not in the network allowlist of “${input.agentName}”: the proxy will refuse the clone. Add ${host} to its environment (Capabilities → Environments).`,
    });
  }
  return out;
}
