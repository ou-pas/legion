// What p2 moves to English, and above all what it leaves: only a value that is exactly what the old
// code wrote. SQL on a migrated database, fixtures copied from the rows the pre-16/09 seed and
// catalog produced.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-p2-"));
process.env.LEGION_DB = join(dir, "unused.db");
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { translateSeededText } = await import("./p2-seeded-text-in-english.js");
const { steps: s1 } = await import("../migrations/v1-v10.js");
const { steps: s11 } = await import("../migrations/v11-v20.js");
const { steps: s21 } = await import("../migrations/v21-v30.js");
const { steps: s31 } = await import("../migrations/v31-v40.js");
const { steps: s41 } = await import("../migrations/v41-v45.js");
const { steps: s46 } = await import("../migrations/v46-v50.js");
const { steps: s51 } = await import("../migrations/v51-v55.js");
const { steps: s56 } = await import("../migrations/v56-v60.js");
const { steps: s61 } = await import("../migrations/v61-v65.js");
const { steps: s66 } = await import("../migrations/v66-v70.js");
const { steps: s71 } = await import("../migrations/v71-v75.js");

const ALL = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46, ...s51, ...s56, ...s61, ...s66, ...s71];

const AT = 1_700_000_000_000;
let n = 0;

function freshDb(): Database.Database {
  const sqlite = new Database(join(dir, `p2-${++n}.db`));
  for (const [, apply] of ALL) apply(sqlite);
  return sqlite;
}

function project(sqlite: Database.Database, slug: string, context = ""): void {
  sqlite
    .prepare("INSERT INTO projects (id, name, slug, context, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(slug, slug, slug, context, AT);
}

function agent(sqlite: Database.Database, id: string, name: string, title: string, prompt: string) {
  sqlite
    .prepare(
      "INSERT INTO agents (id, project_id, name, title, role_prompt, created_at) VALUES (?, 'p', ?, ?, ?, ?)",
    )
    .run(id, name, title, prompt, AT);
}

const value = (sqlite: Database.Database, table: string, column: string, id: string): string =>
  (sqlite.prepare(`SELECT ${column} AS v FROM ${table} WHERE id = ?`).get(id) as { v: string }).v;

// The compound-engineer chain as the first-boot seed stored it: `JSON.stringify` of these steps.
const step = (
  name: string,
  agentName: string,
  gate: boolean,
  artifact: string,
  prompt: string,
) => ({
  name,
  agentName,
  approvalGate: gate,
  expectedArtifacts: [artifact],
  prompt,
});
const COMPOUND_STEPS_FR = [
  step(
    "Spec",
    "spec",
    true,
    "spec.md",
    "Write the specification for the request below and save it as spec.md in the run artifacts folder.",
  ),
  step(
    "Plan",
    "plan",
    false,
    "plan.md",
    "Read spec.md from the run artifacts and produce plan.md.",
  ),
  step(
    "Revue du plan",
    "review-coordinator",
    false,
    "plan-review.md",
    "Review plan.md against spec.md (feasibility, scope, coherence). Save plan-review.md.",
  ),
  step(
    "Révision du plan",
    "plan",
    false,
    "plan-v2.md",
    "Apply the must-fix items of plan-review.md to plan.md and save plan-v2.md.",
  ),
  step(
    "Implémentation",
    "senior-dev",
    false,
    "implementation.md",
    "Implement according to plan-v2.md. Save deliverables in the run artifacts folder and implementation.md summarizing what was produced and how it was verified.",
  ),
  step(
    "Code review",
    "review-coordinator",
    false,
    "code-review.md",
    "Review the implementation artifacts against plan-v2.md. Save code-review.md with must-fix/should-fix.",
  ),
  step(
    "Corrections",
    "senior-dev",
    false,
    "fixes.md",
    "Address every must-fix of code-review.md. Save fixes.md describing each fix.",
  ),
  step(
    "Wiki",
    "librarian",
    false,
    "wiki-update.md",
    "Write wiki-update.md documenting what this run produced.",
  ),
  step(
    "Revue humaine",
    "senior-dev",
    true,
    "summary.md",
    "Write summary.md: a short human-facing recap of the whole run with links to every artifact, then leave the task for human review.",
  ),
];

const SPEC_PROMPT_FR =
  "You are the spec agent. Turn the operator's request into a precise, reviewable specification, in the shape the « specify » skill gives: problem, numbered observable behaviours, seams, decisions, out of scope. Save it as the expected artifact. The human approves it — write for their reading.";

const SECRETS_RULE_FR =
  "Ne jamais écrire un secret en clair dans le code, un commentaire, un log ou un commit. Ne jamais toucher à `server/.env`. Les secrets se citent par `${SECRET:NOM}` et se déclarent dans la carte « Secrets du projet ».";

describe("p2, a value exactly as the old code wrote it", () => {
  it("moves a seeded agent title and a catalog role prompt to English", () => {
    const sqlite = freshDb();
    project(sqlite, "p");
    agent(sqlite, "a1", "spec", "Écrit des specs approuvables", SPEC_PROMPT_FR);

    translateSeededText(sqlite);

    assert.equal(value(sqlite, "agents", "title", "a1"), "Writes approvable specs");
    assert.equal(
      value(sqlite, "agents", "role_prompt", "a1"),
      SPEC_PROMPT_FR.replace("« specify »", "“specify”"),
      "only the quotes changed in the catalog's prompts",
    );
  });

  it("keeps the project name in the default agent's title", () => {
    const sqlite = freshDb();
    project(sqlite, "p");
    agent(sqlite, "a1", "default", "Agent par défaut · Mon projet", "r");

    translateSeededText(sqlite);

    assert.equal(value(sqlite, "agents", "title", "a1"), "Default agent · Mon projet");
  });

  it("renames the steps of a seeded chain and leaves everything else in them", () => {
    const sqlite = freshDb();
    project(sqlite, "p");
    sqlite
      .prepare(
        "INSERT INTO task_templates (id, project_id, name, description, steps, created_at) VALUES ('t1', 'p', 'compound-engineer', ?, ?, ?)",
      )
      .run(
        "Spec (gate) → Plan → Revue (3 angles) → Révision → Implémentation → Code review → Corrections → Wiki → Revue humaine (gate)",
        JSON.stringify(COMPOUND_STEPS_FR),
        AT,
      );

    translateSeededText(sqlite);

    const steps = JSON.parse(value(sqlite, "task_templates", "steps", "t1")) as { name: string }[];
    assert.deepEqual(
      steps.map((s) => s.name),
      [
        "Spec",
        "Plan",
        "Plan review",
        "Plan revision",
        "Implementation",
        "Code review",
        "Fixes",
        "Wiki",
        "Human review",
      ],
    );
    assert.deepEqual(
      steps.map((s) => ({ ...s, name: "" })),
      COMPOUND_STEPS_FR.map((s) => ({ ...s, name: "" })),
      "agents, gates, artifacts and prompts are untouched",
    );
    assert.match(value(sqlite, "task_templates", "description", "t1"), /Human review \(gate\)$/);
  });

  it("moves the Legion project's rule and context, whose sources of truth no longer exist", () => {
    const sqlite = freshDb();
    project(
      sqlite,
      "legion",
      "Legion : control plane + UI au-dessus du Claude Agent SDK, opérateur unique (Romuald). Monorepo pnpm : `server/` (Hono + Drizzle/SQLite, SSE), `web/` (React 19 + Vite + TanStack), `runner-payload/` (le process qui vit dans le container), `session-image/` (son image Docker). Sources de vérité : docs/plan.md (décisions actées), docs/STATE.md (état courant), docs/DESIGN.md (le contrat de design, monde « Atelier »). Français pour la doc et les commentaires, anglais pour le code et les identifiants.",
    );
    sqlite
      .prepare(
        "INSERT INTO rules (id, project_id, name, content, created_at) VALUES ('r1', 'legion', 'secrets-jamais-en-clair', ?, ?)",
      )
      .run(SECRETS_RULE_FR, AT);

    translateSeededText(sqlite);

    assert.match(value(sqlite, "rules", "content", "r1"), /^Never write a secret in plain text/);
    const context = value(sqlite, "projects", "context", "legion");
    assert.match(context, /docs\/wiki\/produit\//);
    assert.doesNotMatch(context, /STATE\.md|plan\.md/);
    assert.equal(
      (sqlite.prepare("SELECT name FROM rules WHERE id = 'r1'").get() as { name: string }).name,
      "secrets-jamais-en-clair",
      "the rule's name is an identifier: content moves, keys stay",
    );
  });
});

describe("p2, anything else", () => {
  it("leaves an edited value alone and reports it when it still looks French", () => {
    const sqlite = freshDb();
    project(sqlite, "p");
    agent(sqlite, "a1", "spec", "Écrit des specs approuvables, et vite", SPEC_PROMPT_FR + " ");
    agent(sqlite, "a2", "mine", "My own agent", "Does my own thing.");

    const report = translateSeededText(sqlite);

    assert.equal(value(sqlite, "agents", "title", "a1"), "Écrit des specs approuvables, et vite");
    assert.equal(value(sqlite, "agents", "role_prompt", "a1"), SPEC_PROMPT_FR + " ");
    assert.deepEqual(report.translated, []);
    assert.deepEqual(
      report.leftInFrench.sort(),
      ["agents.role_prompt:a1", "agents.title:a1"],
      "the English agent is neither touched nor reported",
    );
  });

  it("does nothing on a fresh database", () => {
    const report = translateSeededText(freshDb());

    assert.deepEqual(report, { translated: [], leftInFrench: [] });
  });

  it("changes nothing on a second pass", () => {
    const sqlite = freshDb();
    project(sqlite, "p");
    agent(sqlite, "a1", "spec", "Écrit des specs approuvables", SPEC_PROMPT_FR);
    sqlite
      .prepare(
        "INSERT INTO rules (id, project_id, name, content, created_at) VALUES ('r1', 'p', 'secrets-jamais-en-clair', ?, ?)",
      )
      .run(SECRETS_RULE_FR, AT);

    const first = translateSeededText(sqlite);
    const rows = () => [
      sqlite.prepare("SELECT * FROM agents").all(),
      sqlite.prepare("SELECT * FROM rules").all(),
    ];
    const snapshot = rows();
    const second = translateSeededText(sqlite);

    assert.equal(first.translated.length, 3);
    assert.deepEqual(second, { translated: [], leftInFrench: [] });
    assert.deepEqual(rows(), snapshot);
  });
});
