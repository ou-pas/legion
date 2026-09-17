// Environments: the network allowlist an agent carries, enforced by its session's egress proxy
// (`sessions/runner/docker.ts`). The JSON shapes follow the contract the front-end task filed
// (`/artifacts/LMnSc6s36g/contract.md`), which `web/src/api/environments.ts` was written against.
//
// Two domain rules live here rather than in the routes:
//
//  1. Only `limited` is created. An environment created from the app is an allowlist, never a
//     pass. Existing `open` ones stay readable and renamable; no form field switches to `open`.
//  2. A host is a host. The proxy runs `fnmatch` over comma-separated lines: a comma inside an
//     entry splits the line, a lone `*` opens everything, a full URL never matches. All three
//     would pass silently into the database and fail at runtime, so they are refused here.
import { nanoid } from "nanoid";
import { NETWORKING } from "../shared/enums.js";
import type { Networking } from "../shared/enums.js";
import {
  agentNamesUsing,
  deleteEnvironmentRow,
  environmentRow,
  environmentRowsOf,
  insertEnvironment,
  projectRow,
  updateEnvironment,
  type EnvironmentRow,
} from "./environments-store.js";

/** `allowedHosts` as an array; the database stores JSON. Serialisation happens here, once. */
export interface EnvironmentDto {
  id: string;
  projectId: string;
  name: string;
  networking: Networking;
  allowedHosts: string[];
}

export type EnvResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 404 | 409; error: string; agentNames?: string[] };

const fail = (status: 400 | 404 | 409, error: string, agentNames?: string[]): EnvResult<never> =>
  agentNames ? { ok: false, status, error, agentNames } : { ok: false, status, error };

function toDto(row: EnvironmentRow): EnvironmentDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    networking: row.networking,
    // A row damaged by hand must not break the whole list: unreadable reads as empty, the safe
    // side of the error.
    allowedHosts: parseHosts(row.allowedHosts),
  };
}

function parseHosts(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

/** A host as the proxy understands it: a name, possibly a wildcard (`*.github.com`).
 *
 *  The three refusals are three known ways to open the wall unknowingly: a comma splits the
 *  allowlist line (so "a,b" makes two entries, one never reviewed), a lone wildcard means
 *  everything, and a full URL never matches, so the agent believes it has access and hits an
 *  unreadable refusal. */
export function normalizeHost(raw: string): EnvResult<string> {
  const host = raw.trim().toLowerCase();
  if (!host) return fail(400, "empty host");
  if (/^[a-z]+:\/\//.test(host) || host.includes("/"))
    return fail(
      400,
      `“${raw}”: write the HOST alone, with no scheme and no path (e.g. “api.github.com”)`,
    );
  if (host.includes(",") || /\s/.test(host))
    return fail(
      400,
      `“${raw}”: a host contains neither comma nor space — split the hosts into several entries`,
    );
  if (/^\*+(\.\*+)*$/.test(host))
    return fail(
      400,
      "“*” would allow everything: that is no longer an allowlist. Name the hosts, or assign an open environment",
    );
  if (!/^[a-z0-9*][a-z0-9.*-]*$/.test(host)) return fail(400, `“${raw}” is not a host name`);
  return { ok: true, value: host };
}

/** Refuses at the first problem: a form accepting five hosts out of six lets the operator believe
 *  the sixth went through. */
function normalizeHosts(raw: unknown): EnvResult<string[]> {
  if (!Array.isArray(raw)) return fail(400, "allowedHosts must be a list of hosts");
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return fail(400, "allowedHosts holds text only");
    const r = normalizeHost(entry);
    if (!r.ok) return r;
    if (!out.includes(r.value)) out.push(r.value); // a duplicate is noise, not an error
  }
  return { ok: true, value: out };
}

export function listEnvironments(projectId?: string): EnvironmentDto[] {
  return environmentRowsOf(projectId).map(toDto);
}

/** Agents referencing this environment, by name: the delete refusal and the UI show them as is. */
export function agentsUsing(environmentId: string): string[] {
  return agentNamesUsing(environmentId);
}

/**
 * A project's open environment, created if missing. The only path that makes
 * `NETWORKING.open`; rule 1 above is about what a form can create, and nothing here is reachable
 * from a route.
 *
 * A built-in agent can require free egress (the `interviewer` searches for what it does not know
 * yet; no allowlist can be written in advance). Setting it explicitly rather than leaving the agent
 * without an environment is decision D19 (/artifacts/rtQLldYSm2/spec.md): the default "no
 * environment = no restriction" flipped twice in a month (d042ee2), and a capability resting on an
 * unstable default is lost silently. Written in the database, it shows on screen and survives the
 * next change of default.
 *
 * Idempotent: reuses the project's first open environment whatever its name. `networking`
 * decides, never the name.
 */
export function ensureOpenEnvironment(projectId: string): string {
  const rows = environmentRowsOf(projectId);
  const existing = rows.find((e) => e.networking === NETWORKING.open);
  if (existing) return existing.id;
  // The name may collide with an "open" switched to limited by hand. It is not overwritten: a free
  // name is taken, since renaming under the operator's feet is the silent change D19 avoids.
  const taken = new Set(rows.map((e) => e.name.toLowerCase()));
  let name = "open";
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `open-${n}`;
  const row = { id: nanoid(10), projectId, name, networking: NETWORKING.open, allowedHosts: "[]" };
  insertEnvironment(row);
  return row.id;
}

export function createEnvironment(input: {
  projectId?: string;
  name?: string;
  allowedHosts?: unknown;
}): EnvResult<EnvironmentDto> {
  const projectId = input.projectId?.trim();
  const name = input.name?.trim();
  if (!projectId || !name) return fail(400, "projectId and name required");
  const project = projectRow(projectId);
  if (!project) return fail(404, "project not found");

  const taken = environmentRowsOf(projectId).some(
    (e) => e.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) return fail(409, `an environment “${name}” already exists in this project`);

  const hosts = normalizeHosts(input.allowedHosts ?? []);
  if (!hosts.ok) return hosts;

  const row = {
    id: nanoid(10),
    projectId,
    name,
    // Rule 1. A wall with no allowed host still lets the API and the control plane through (the
    // proxy adds them).
    networking: NETWORKING.limited,
    allowedHosts: JSON.stringify(hosts.value),
  };
  insertEnvironment(row);
  return { ok: true, value: toDto(row) };
}

export function patchEnvironment(
  id: string,
  input: { name?: string; allowedHosts?: unknown },
): EnvResult<EnvironmentDto> {
  const env = environmentRow(id);
  if (!env) return fail(404, "environment not found");

  const patch: Partial<EnvironmentRow> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return fail(400, "empty name");
    const taken = environmentRowsOf(env.projectId).some(
      (e) => e.id !== env.id && e.name.toLowerCase() === name.toLowerCase(),
    );
    if (taken) return fail(409, `an environment “${name}” already exists in this project`);
    patch.name = name;
  }
  if (input.allowedHosts !== undefined) {
    // An open environment has no allowlist: setting one would display hosts the runtime ignores.
    // The UI hides the field, but the server does not rely on that.
    if (env.networking === NETWORKING.open)
      return fail(
        400,
        "this environment is open: it has no allowlist. Create a limited one to restrict the network",
      );
    const hosts = normalizeHosts(input.allowedHosts);
    if (!hosts.ok) return hosts;
    patch.allowedHosts = JSON.stringify(hosts.value);
  }
  if (Object.keys(patch).length === 0) return { ok: true, value: toDto(env) };

  updateEnvironment(env.id, patch);
  return { ok: true, value: toDto({ ...env, ...patch }) };
}

/** Refused while an agent references the environment, unlike rules and MCP servers, which are
 *  silently removed from agents. Deliberate (task 08 brief): an allowlist vanishing under a live
 *  agent turns a wall into something else without anyone deciding it. */
export function deleteEnvironment(id: string): EnvResult<{ ok: true }> {
  const env = environmentRow(id);
  if (!env) return fail(404, "environment not found");
  const used = agentsUsing(id);
  if (used.length > 0)
    return fail(409, `used by ${used.length} agent(s): ${used.join(", ")}`, used);
  deleteEnvironmentRow(id);
  return { ok: true, value: { ok: true } };
}
