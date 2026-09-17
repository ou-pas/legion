// The fleet's network state: who is walled off, who is not, and what would break.
//
//   node --import tsx server/scripts/network-audit.ts      (or `make network-audit`)
//
// Read-only, without exception. This script once carried a migration (`--keep-current-access`) for
// a switch of the default to restricted networking that was reverted the same evening. A pointless
// migration left in the tree gets rerun one day "to see"; `git log` keeps it.
//
// The database is resolved from this file, not from cwd, and the script refuses to create one. The
// first version did the opposite: `db.ts` reads `LEGION_DB ?? "legion.db"`, relative to cwd, and
// `make` runs at the repository root, so the script opened a nonexistent `legion.db` there, seeded
// it, and reported an empty fleet. An audit tool that creates what it inspects reassures wrongly.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostAllowed } from "../src/sessions/preflight.js";

const DB_PATH =
  process.env.LEGION_DB ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "legion.db");
if (!existsSync(DB_PATH)) {
  console.error(`⛔ no database at ${DB_PATH}`);
  console.error("   Start the control plane once (make server) to create it, or point to it:");
  console.error("   LEGION_DB=/path/to/legion.db make network-audit");
  process.exit(1);
}
// Set before the import: `db.ts` reads the variable when the module loads.
process.env.LEGION_DB = DB_PATH;
const { db, schema } = await import("../src/shared/db.js");
console.log(`database: ${DB_PATH}`);

/** What the proxy always allows on its own: without it a session cannot work. */
const ALWAYS = ["api.anthropic.com", "the control plane"];

type Env = typeof schema.environments.$inferSelect;

function policyOf(
  agent: typeof schema.agents.$inferSelect,
  envs: Env[],
): { label: string; hosts: string[] | null } {
  if (!agent.environmentId) return { label: "free (no environment)", hosts: null };
  const env = envs.find((e) => e.id === agent.environmentId);
  if (!env) return { label: "free (environment not found)", hosts: null };
  if (env.networking === "open") return { label: `open, "${env.name}"`, hosts: null };
  const hosts = JSON.parse(env.allowedHosts) as string[];
  return { label: `restricted, "${env.name}" (${hosts.length} host(s))`, hosts };
}

/** Granted repositories the environment makes unreachable: the preflight's launch check, replayed
 *  cold. Returns how many launches would be refused and prints which. */
function refusedRepos(
  agent: typeof schema.agents.$inferSelect,
  allowed: string[],
  projectRepos: (typeof schema.repos.$inferSelect)[],
): number {
  const granted = JSON.parse(agent.repoNames) as string[];
  let count = 0;
  for (const repo of projectRepos.filter((r) => granted.includes(r.name))) {
    let host: string;
    try {
      host = new URL(repo.url).host;
    } catch {
      continue;
    }
    if (hostAllowed(host, [...allowed, "api.anthropic.com"])) continue;
    count++;
    console.log(`      ⛔ repo "${repo.name}": ${host} unreachable, the launch will be refused`);
  }
  return count;
}

const projects = db.select().from(schema.projects).all();
const envs = db.select().from(schema.environments).all();
const agents = db.select().from(schema.agents).all();
const repos = db.select().from(schema.repos).all();

let refused = 0;
/** What no screen shows side by side: what the container carries, and how far it can talk. A write
 *  PAT behind free egress is the case worth counting. */
let freeWithSecrets = 0;

for (const project of projects) {
  const mine = agents.filter((a) => a.projectId === project.id);
  if (mine.length === 0) continue;
  console.log(`\n${project.name}`);

  for (const agent of mine) {
    const pol = policyOf(agent, envs);
    let secrets: string[] = [];
    try {
      secrets = JSON.parse(agent.envSecretNames) as string[];
    } catch {
      secrets = [];
    }
    if (pol.hosts === null && secrets.length > 0) freeWithSecrets++;
    console.log(
      `  ${agent.name.padEnd(22)} ${pol.label.padEnd(32)} ${secrets.join(", ") || "no secret"}`,
    );

    if (pol.hosts !== null)
      refused += refusedRepos(
        agent,
        pol.hosts,
        repos.filter((r) => r.projectId === project.id),
      );
  }
}

console.log(`\nAlways reachable, whatever the environment: ${ALWAYS.join(", ")}.`);
if (refused > 0)
  console.log(
    `${refused} launch(es) would be refused as things stand. Add the host to the agent's allowlist, or remove its environment.`,
  );
if (freeWithSecrets > 0)
  console.log(
    `${freeWithSecrets} agent(s) combine free egress and an injected secret. A fact, not a verdict: decide based on what they read.`,
  );
