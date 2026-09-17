// What git knows about this clone, and what the forge knows about its tags (26/08).
//
// Read-only: never `fetch` or `checkout`. The check runs on a timer, and a timer writing to `.git`
// would eventually collide with a `git` typed by hand. Writing belongs to the detached script, run
// once on an explicit action. Tags come from the GitHub API rather than `git fetch --tags` for the
// same reason.
import { spawn } from "node:child_process";
import { freshSecret } from "../connections/secret-access.js";
import { allRepos } from "./updates-store.js";

/** Legion's own repository: the folder the control plane runs from. */
export const REPO_ROOT = process.cwd().replace(/\/server\/?$/, "");

const GIT_MS = 5_000;

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function git(args: string[], cwd = REPO_ROOT): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), GIT_MS);
    timer.unref?.();
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: String(e.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export interface LocalGit {
  branch: string | null;
  sha: string;
  /** The tag EXACTLY on HEAD, or `null`: the running version. */
  tag: string | null;
  /** The newest tag reachable from HEAD; equals `tag` when HEAD carries one. */
  lastTag: string | null;
  /** Commits between `lastTag` and HEAD. */
  ahead: number;
  dirty: boolean;
  /** `ou-pas/legion` from the origin; `null` if not a GitHub repository. */
  slug: string | null;
}

/**
 * `v0.1.0-1-gae5ab51` → the tag and the distance (`git describe --long`).
 *
 * Lot 89 used `--exact-match`, which fails whenever HEAD is not exactly on a tag, the normal state
 * while developing: the screen then offered to "update" to the last tag from a HEAD one commit
 * past it, an invitation to go backwards.
 *
 * Tag names may contain dashes (`v1.2.0-beta.1`): anchor on the last `-<n>-g<sha>`.
 */
export function describeTag(out: string): { tag: string; ahead: number } | null {
  const m = /^(.*)-(\d+)-g[0-9a-f]+$/.exec(out.trim());
  return m ? { tag: m[1]!, ahead: Number(m[2]) } : null;
}

/** A failing command does not fail the read: return what is known. */
export async function readLocalGit(): Promise<LocalGit> {
  const [branch, sha, described, status, origin] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"]),
    git(["rev-parse", "--short", "HEAD"]),
    git(["describe", "--tags", "--long"]),
    git(["status", "--porcelain"]),
    git(["remote", "get-url", "origin"]),
  ]);
  const branchName = branch.code === 0 ? branch.stdout.trim() : "";
  // `describe` fails when no tag is reachable (never tagged, or a shallow clone): no tag known.
  const d = described.code === 0 ? describeTag(described.stdout) : null;
  return {
    branch: branchName && branchName !== "HEAD" ? branchName : null,
    sha: sha.code === 0 ? sha.stdout.trim() : "",
    tag: d && d.ahead === 0 ? d.tag : null,
    lastTag: d?.tag ?? null,
    ahead: d?.ahead ?? 0,
    dirty:
      status.code === 0
        ? status.stdout.split("\n").some((l) => l.trim() && !l.startsWith("??"))
        : false,
    slug: origin.code === 0 ? githubSlug(origin.stdout.trim()) : null,
  };
}

/**
 * `ou-pas/legion` from any origin URL form, including an SSH alias: `git@github-legion:…` is a
 * `~/.ssh/config` entry, and it is what this repo uses. Any host containing `github` is accepted.
 */
export function githubSlug(url: string): string | null {
  const m = /(?:[/@]|^)([^/:@]*github[^/:@]*)[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[2]}/${m[3]}` : null;
}

/** The token of the project that declares this repository.
 *
 *  Found in production on 26/08: the repo is private, and an anonymous tags request returns 404,
 *  not 403, so the card said "GitHub unreachable" on a healthy network. The token of the project
 *  declaring the repo is the only defensible choice: its agents already clone it. */
export function tokenForSlug(slug: string): string | null {
  const match = allRepos().find((r) => githubSlug(r.url) === slug);
  if (!match) return null;
  return freshSecret(match.projectId, "GITHUB_TOKEN");
}

/** Why the tag list did not arrive. Conflating these was the original defect: "unreachable" was said
 *  for a private repo and a network outage alike, which have different fixes. */
export type TagsResult =
  | { ok: true; tags: string[] }
  | { ok: false; why: "unreachable" | "unauthorized" | "not-found" | "no-slug" };

/** "Could not ask" is never "no tags". */
export async function fetchTags(slug: string, signal?: AbortSignal): Promise<TagsResult> {
  const token = tokenForSlug(slug);
  try {
    const r = await fetch(`https://api.github.com/repos/${slug}/tags?per_page=100`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "legion",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: signal ?? AbortSignal.timeout(8_000),
    });
    // GitHub answers 404, not 403, for a private repo without a valid token, on purpose.
    if (r.status === 404) return { ok: false, why: "not-found" };
    if (r.status === 401 || r.status === 403) return { ok: false, why: "unauthorized" };
    if (!r.ok) return { ok: false, why: "unreachable" };
    const rows = (await r.json()) as { name?: unknown }[];
    return Array.isArray(rows)
      ? { ok: true, tags: rows.map((t) => String(t.name ?? "")).filter(Boolean) }
      : { ok: false, why: "unreachable" };
  } catch {
    return { ok: false, why: "unreachable" };
  }
}

/** Commit subjects between HEAD and the tag, so "6 commits behind" says what they are. Empty if the
 *  tag is not known locally, normal before the first `fetch`. */
export async function commitsBetween(tag: string, limit = 10): Promise<string[]> {
  const r = await git(["log", "--oneline", "--no-decorate", `-${limit}`, `HEAD..${tag}`]);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
