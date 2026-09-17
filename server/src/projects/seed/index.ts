// SEEDING — in the domain that writes it, no longer in the foundation (06/09).
//
// `seed()` used to live in `shared/db.ts`. The foundation created a project, five agents, two
// environments and a chain template there: in other words, `shared/` knew the vocabulary of
// `projects/`, while the whole repository depends on `shared/`. The `shared-is-a-leaf` rule did
// not catch it — those writes go through the Drizzle schema, not through a domain import — but
// its test already lived here, in `projects/seed.test.ts`, which says enough about where it
// belonged.
//
// THE QUERIES ARE IN DRIZZLE, no longer raw SQL: the `sqlite` handle stays private to `db.ts`,
// and rightly so — a single door to the database. The original raw SQL had access to it by
// proximity, not by choice.
//
// THE `console.log` LINES AT THE END OF SEEDING ARE GONE: each one duplicated word for word the
// `logControlEvent` on the next line, which survives the terminal and is read on the Infra
// screen. Same arbitration as the migration steps on 05/09.
//
// Two natures of code live here, and confusing them cost a dead server:
//
//  · MIGRATIONS / invariants — applied at every boot, on any database;
//  · first-boot SEEDING — applied once, on an empty database.
//
// The seeding guard used to be `slug = 'default'`. Consequence: deleting the "Default" project
// made it come back at the next restart (the deletion achieved nothing), and the insert of the
// "local" runner — whose name is UNIQUE in the database — then raised a constraint in the middle
// of the boot, which KILLED the server. That is exactly what happened on 20/08 after the
// database was cleaned. The guard is now "no project at all": a database that carries a project
// is an installed database, nothing gets seeded there.
import { nanoid } from "nanoid";
import { getSetting, setSetting } from "../../shared/settings.js";
import { NETWORKING, RUNNER_KIND } from "../../shared/enums.js";
import { logControlEvent } from "../../events/control-log-store.js";
import {
  agentRowExistsByName,
  hasAnyEnvironmentRow,
  hasAnyProjectRow,
  hasAnyRunner,
  hasAnyTemplateRow,
  insertAgentRow,
  insertEnvironmentRow,
  insertProjectRow,
  insertRunnerRow,
  insertTaskTemplateRow,
  setAgentFsGrants,
  ungrantedAgentRows,
} from "./store.js";

/** The first-boot mark. "First boot" is NOT "zero project": someone who deletes their last
 *  project does not want to see "Default" show up in its place. */
const BOOTSTRAP_SEEDED = "bootstrap_seeded";

/** An invariant, not seeding: a control plane without a runner can start NOTHING, and the runner
 *  belongs to no project. Guarded on the runners table, not on the projects one. */
function ensureLocalRunner(): void {
  if (!hasAnyRunner()) {
    insertRunnerRow({ id: nanoid(10), name: "local", kind: RUNNER_KIND.docker, dockerHost: null });
    logControlEvent("info", "seed", "runner 'local' seeded (no runner in the database)");
  }
}

/** Backfill (migration v1→v2): agents created before fs_grants existed got '[]'.
 *  Every agent needs at least its own home folder — grant /agents/<name> rw. */
function backfillAgentFsGrants(): void {
  const ungrantedAgents = ungrantedAgentRows();
  for (const a of ungrantedAgents)
    setAgentFsGrants(
      a.id,
      JSON.stringify([
        { folderPath: `/agents/${a.name}`, canRead: true, canWrite: true, canDelete: false },
      ]),
    );
  // One summary event, not one per agent: a backfill potentially touches every existing agent at
  // once, and that is not what should fill the rotation of 5,000.
  if (ungrantedAgents.length)
    logControlEvent(
      "info",
      "seed",
      `default fs grant added to ${ungrantedAgents.length} agent(s) (backfill v1→v2)`,
      { agents: ungrantedAgents.map((a) => a.name) },
    );
}

/** "First boot" is NOT "zero project": someone who deletes their last project does not want to
 *  see "Default" show up in its place. So we set an explicit mark, once and for all. A database
 *  that already carries a project is deemed seeded (installations older than this mark): it gets
 *  marked without anything being seeded.
 *
 *  SETS THE MARK IN EVERY CASE — this is a question AND a write, which the repository usually
 *  forbids. Here that is the point: the answer is only valid once, and separating it from its
 *  mark would reopen the window where two boots both seed. */
function claimFirstBoot(): boolean {
  const seeded = getSetting(BOOTSTRAP_SEEDED) ?? (hasAnyProjectRow() ? "true" : null);
  setSetting(BOOTSTRAP_SEEDED, new Date().toISOString());
  return !seeded;
}

/** The "Default" project and its agent — the bare minimum so that the screen does not open on
 *  nothing. Returns the project id, which the next two phases need. */
function seedDefaultProject(now: Date): string {
  const projectId = nanoid(10);
  insertProjectRow({ id: projectId, name: "Default", slug: "default", createdAt: now });
  insertAgentRow({
    id: nanoid(10),
    projectId,
    name: "default",
    title: "Default Legion agent",
    model: null,
    rolePrompt:
      // Reconstructed from Danny Postma's Legion talk — not his verbatim prompt
      "You are the default Legion agent. Do the assigned task with the tools you have. " +
      "Finish or report if stuck.",
    fsGrants: JSON.stringify([
      { folderPath: "/agents/default", canRead: true, canWrite: true, canDelete: false },
    ]),
    createdAt: now,
  });
  logControlEvent("info", "seed", "first boot: project “Default” + default agent seeded", {
    projectId,
  });
  return projectId;
}

/** Phase 2 seeds: environments + a deliberately-restricted demo agent.
 *  The `hasEnv` / `hasTemplate` guards of this phase and the next are now always true (we only
 *  get here on a database with no project at all, therefore with no environment and no template).
 *  They stay because they cost nothing and document the original phase; they no longer protect
 *  anything. */
function seedEnvironmentsAndWriter(projectId: string, now: Date): void {
  const hasEnv = hasAnyEnvironmentRow();
  if (!hasEnv) {
    insertEnvironmentRow({
      id: nanoid(10),
      projectId,
      name: "open",
      networking: NETWORKING.open,
      allowedHosts: "[]",
    });
    const limitedId = nanoid(10);
    insertEnvironmentRow({
      id: limitedId,
      projectId,
      name: "limited-anthropic",
      networking: NETWORKING.limited,
      allowedHosts: JSON.stringify(["api.anthropic.com", "statsig.anthropic.com", "sentry.io"]),
    });
    insertAgentRow({
      id: nanoid(10),
      projectId,
      name: "writer",
      title: "Isolated writer — network limited to the Anthropic API, writes in /agents/writer",
      model: null,
      rolePrompt:
        // Reconstructed from Danny Postma's Legion talk — not his verbatim prompt
        "You are a writing agent. Produce the requested document and save it with the " +
        "Legion filesystem tools (your folder is /agents/writer). You have no other access. " +
        "Ask the human via the inbox tool when a decision is needed.",
      environmentId: limitedId,
      fsGrants: JSON.stringify([
        { folderPath: "/agents/writer", canRead: true, canWrite: true, canDelete: false },
      ]),
      allowedTools: JSON.stringify([
        "mcp__legion__update_task",
        "mcp__legion__fs_list",
        "mcp__legion__fs_read",
        "mcp__legion__fs_write",
        "mcp__legion__inbox_ask",
        "mcp__legion__inbox_send",
      ]),
      createdAt: now,
    });
    logControlEvent(
      "info",
      "seed",
      "environments (open, limited-anthropic) + writer agent seeded",
      { projectId },
    );
  }
}

/** Phase 3 seeds (idempotent): blueprint agents + the compound-engineer template. */
function seedBlueprintAgentsAndTemplate(projectId: string, now: Date): void {
  const hasTemplate = hasAnyTemplateRow();
  if (!hasTemplate) {
    // Reconstructed from Danny Postma's Legion talk — not his verbatim prompts
    const blueprintAgents: {
      name: string;
      title: string;
      model: string | null;
      rolePrompt: string;
    }[] = [
      {
        name: "spec",
        title: "Writes approvable specs",
        model: "opus",
        rolePrompt:
          "You are the spec agent. Turn the operator's request into a precise, reviewable specification: scope, formats, edge cases, out-of-scope. Save it as the expected artifact. The human approves it — write for their reading.",
      },
      {
        name: "plan",
        title: "Turns a spec into an ordered plan",
        model: "opus",
        rolePrompt:
          "You are the plan agent. Read the approved spec artifact and produce an ordered implementation plan with atomic steps, risks, and test strategy. Save it as the expected artifact.",
      },
      {
        name: "senior-dev",
        title: "Implements and fixes",
        model: null,
        rolePrompt:
          "You are the senior-dev agent. Implement or fix according to the plan artifacts. Persist every deliverable through the Legion fs tools. Verify your work before finishing.",
      },
      {
        name: "review-coordinator",
        title: "Coordinates reviews, consolidates must-fix/should-fix",
        model: null,
        rolePrompt:
          "You are the review coordinator. Review the referenced artifacts from three angles — feasibility, scope creep, coherence — and produce ONE consolidated report with must-fix and should-fix items. Save it as the expected artifact.",
      },
      {
        name: "librarian",
        title: "Keeps the documentation up to date",
        model: "haiku",
        rolePrompt:
          "You are the librarian. Read the artifacts of this template run and write the documentation/wiki update. Save it as the expected artifact.",
      },
    ];
    for (const a of blueprintAgents) {
      // project-scoped (review P3 #10): a same-named agent in ANOTHER project must not skip this seed
      if (agentRowExistsByName(a.name, projectId)) continue;
      insertAgentRow({
        id: nanoid(10),
        projectId,
        name: a.name,
        title: a.title,
        model: a.model,
        rolePrompt: a.rolePrompt,
        fsGrants: JSON.stringify([
          { folderPath: `/agents/${a.name}`, canRead: true, canWrite: true, canDelete: false },
        ]),
        createdAt: now,
      });
    }

    // The flagship 9-step chain. Step prompts reference artifacts of previous steps
    // (all steps of a run share read access to /artifacts/<runId>).
    const steps = [
      {
        name: "Spec",
        agentName: "spec",
        approvalGate: true,
        expectedArtifacts: ["spec.md"],
        prompt:
          "Write the specification for the request below and save it as spec.md in the run artifacts folder.",
      },
      {
        name: "Plan",
        agentName: "plan",
        approvalGate: false,
        expectedArtifacts: ["plan.md"],
        prompt: "Read spec.md from the run artifacts and produce plan.md.",
      },
      {
        name: "Plan review",
        agentName: "review-coordinator",
        approvalGate: false,
        expectedArtifacts: ["plan-review.md"],
        prompt:
          "Review plan.md against spec.md (feasibility, scope, coherence). Save plan-review.md.",
      },
      {
        name: "Plan revision",
        agentName: "plan",
        approvalGate: false,
        expectedArtifacts: ["plan-v2.md"],
        prompt: "Apply the must-fix items of plan-review.md to plan.md and save plan-v2.md.",
      },
      {
        name: "Implementation",
        agentName: "senior-dev",
        approvalGate: false,
        expectedArtifacts: ["implementation.md"],
        prompt:
          "Implement according to plan-v2.md. Save deliverables in the run artifacts folder and implementation.md summarizing what was produced and how it was verified.",
      },
      {
        name: "Code review",
        agentName: "review-coordinator",
        approvalGate: false,
        expectedArtifacts: ["code-review.md"],
        prompt:
          "Review the implementation artifacts against plan-v2.md. Save code-review.md with must-fix/should-fix.",
      },
      {
        name: "Fixes",
        agentName: "senior-dev",
        approvalGate: false,
        expectedArtifacts: ["fixes.md"],
        prompt: "Address every must-fix of code-review.md. Save fixes.md describing each fix.",
      },
      {
        name: "Wiki",
        agentName: "librarian",
        approvalGate: false,
        expectedArtifacts: ["wiki-update.md"],
        prompt: "Write wiki-update.md documenting what this run produced.",
      },
      {
        name: "Human review",
        agentName: "senior-dev",
        approvalGate: true,
        expectedArtifacts: ["summary.md"],
        prompt:
          "Write summary.md: a short human-facing recap of the whole run with links to every artifact, then leave the task for human review.",
      },
    ];
    insertTaskTemplateRow({
      id: nanoid(10),
      projectId,
      name: "compound-engineer",
      description:
        "Spec (gate) → Plan → Review (3 angles) → Revision → Implementation → Code review → Fixes → Wiki → Human review (gate)",
      steps: JSON.stringify(steps),
      autoRunNext: true,
      createdAt: now,
    });
    logControlEvent("info", "seed", "blueprint agents + compound-engineer template seeded", {
      projectId,
    });
  }
}

/** THE ORDER IS THE ONLY THING THIS FUNCTION DECIDES: invariants first, on any database, then
 *  the seeding, once, on a fresh one. */
export function seed(): void {
  const now = new Date();
  ensureLocalRunner();
  backfillAgentFsGrants();
  if (!claimFirstBoot()) return;
  const projectId = seedDefaultProject(now);
  seedEnvironmentsAndWriter(projectId, now);
  seedBlueprintAgentsAndTemplate(projectId, now);
}
