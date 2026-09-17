// A test command's output is bounded (spec "decoupe", slice 08), last link: the compact command is
// useless unless it is what reaches the agent. `repos.test_command` travels in the session spec
// (`repos[].testCommand`) and the runner quotes it in the brief; a seed setting the verbose version
// would feed ten thousand lines to every session.
//
// So the value is followed end to end: seed constant, database row, spec handed to the runner.
// Harness of queue-todo.test.ts: real temporary SQLite, fake runner injected.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-self-cmd-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
// Preflight requires a GITHUB_TOKEN for a github repository; secrets are encrypted, hence the key.
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { encryptSecret } = await import("../shared/crypto.js");
const { pumpQueue } = await import("../sessions/runner/manager.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
// Importing runs the seed: it is a script, and its effect is what is checked.
const { CHECKS, SELF_SLUG, TEST_COMMAND } = await import("./seed/self.js");
/** The rule name is written here because the seed does not export it: content data, not a shared
 *  constant. If it changes this test fails, as intended. */
const VERIFICATION_RULE = "verification-avant-livraison";
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { REPO_ACCESS } = await import("../shared/enums.js");

type Spec = import("../sessions/runner/types.js").SessionSpec;
const provisioned: Spec[] = [];
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned.push(spec);
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

const project = db.select().from(schema.projects).where(eq(schema.projects.slug, SELF_SLUG)).get()!;
const repo = db
  .select()
  .from(schema.repos)
  .where(and(eq(schema.repos.projectId, project.id), eq(schema.repos.name, "legion")))
  .get()!;

/** `pumpQueue` is fire-and-forget: let microtasks finish. */
const settle = () => new Promise((r) => setTimeout(r, 120));

describe("the legion repository test command", () => {
  it("is compact: the seed sets `pnpm -s test`, not the verbose version", () => {
    assert.match(TEST_COMMAND, /\bpnpm -s test\b/);
    assert.doesNotMatch(
      TEST_COMMAND,
      /(^|&&\s*)pnpm test\b/,
      "a link without -s brings the noise back",
    );
    assert.equal(repo.testCommand, TEST_COMMAND, "the database row carries the seed constant");
  });

  // The 09/09 gap: `format:check` was in `make gates` and `ci.yml` but not here, so the agent's bar
  // was lower than `main`'s and three batches landed unformatted. The test does not compare lists
  // link by link; it requires the gates an agent cannot infer from its work, those failing on form.
  it("carries the same gates as `main`: format, lint, tests, build", () => {
    for (const gate of ["format:check", "lint", "test", "build"]) {
      assert.match(TEST_COMMAND, new RegExp(`\\b${gate}\\b`), `missing gate: ${gate}`);
    }
  });

  it("lands as is in the session spec handed to the runner", async () => {
    const now = new Date();
    db.insert(schema.runners)
      .values({ id: "r-self", name: "self-test", kind: RUNNER_KIND.process })
      .run();
    db.insert(schema.secrets)
      .values({
        id: "s-gh",
        projectId: project.id,
        name: "GITHUB_TOKEN",
        ciphertext: encryptSecret("x"),
        createdAt: now,
      })
      .run();
    db.insert(schema.agents)
      .values({
        id: "a-self",
        projectId: project.id,
        name: "builder",
        rolePrompt: "r",
        createdAt: now,
        repoAccess: REPO_ACCESS.write,
        repoNames: JSON.stringify(["legion"]),
        envSecretNames: JSON.stringify(["GITHUB_TOKEN"]),
      })
      .run();
    db.insert(schema.tasks)
      .values({
        id: "t-self",
        projectId: project.id,
        name: "check the monorepo",
        status: TASK_STATUS.todo,
        assigneeAgentId: "a-self",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    pumpQueue();
    await settle();

    assert.equal(provisioned.length, 1, "the task must have been launched");
    const granted = provisioned[0]!.repos.find((r) => r.name === "legion");
    assert.ok(granted, "the legion repository must be in the spec");
    assert.equal(granted.testCommand, TEST_COMMAND);
  });
});

// The bar is written once (14/09). It used to be twice: in the command the agent runs and in the
// `verification-avant-livraison` rule it reads. They drifted in opposite directions (the command had
// `format:check` without `typecheck`, the rule the reverse) and an agent following the rule from
// memory shipped unformatted (PR #7, `main` red).
//
// Not a comparison of two lists, which would invite copying: the rule must quote every link of
// `CHECKS`, so adding a gate without telling agents is impossible.
describe("the verification rule quotes the whole bar", () => {
  const content = () =>
    db
      .select()
      .from(schema.rules)
      .where(and(eq(schema.rules.projectId, project.id), eq(schema.rules.name, VERIFICATION_RULE)))
      .get()?.content ?? "";

  it("names every link of the bar", () => {
    const rule = content();
    for (const check of CHECKS)
      assert.ok(rule.includes(check), `“${check}” is missing from the rule`);
  });

  it("announces the right number of commands", () => {
    assert.match(content(), new RegExp(`these ${CHECKS.length} commands`));
  });
});
