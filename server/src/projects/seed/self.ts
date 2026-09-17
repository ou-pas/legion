// Legion declared as a Legion project (dogfooding).
//
//   pnpm --filter @legion/server seed:self
//
// Idempotent: re-run, it updates instead of duplicating. It creates no task and launches nothing; it
// only declares the project, repositories, environments, agents and rules.
//
// What this script cannot do, to know before running a real agent on it (see the summary printed at
// the end):
//   1. The session image did not carry pnpm, so no monorepo test command could run in the container.
//      Fixed in the Dockerfile; `make image-session` is needed once.
//   2. Cloning goes through HTTPS + GITHUB_TOKEN, never SSH. The local remote is `git@github-legion:…`
//      (SSH alias), so the URL declared here is the HTTPS form.
//   3. Grants do not go below the repository: "front does not touch the server" is a prompt rule, not
//      a technical barrier.
import { nanoid } from "nanoid";
import { NETWORKING } from "../../shared/enums.js";
import { SELF_SLUG } from "../self-slug.js";
import { REPO_ACCESS } from "../../shared/enums.js";
import {
  agentNamesOfProject,
  agentRowByName,
  environmentRowByName,
  insertAgentRow,
  insertEnvironmentRow,
  insertProjectRow,
  insertRepoRow,
  insertRuleRow,
  projectRowBySlug,
  repoRowByName,
  ruleRowByName,
  updateAgentRow,
  updateEnvironmentRow,
  updateProjectRow,
  updateRepoRow,
  updateRuleRow,
} from "./self-store.js";

const REPO_URL = "https://github.com/ou-pas/legion.git";
export { SELF_SLUG };
const SLUG = SELF_SLUG;

const id = () => nanoid(10);
const now = new Date();

/** The monorepo is checked in one block: format, lint, types, server tests, web build. Same bar
 *  `docs/DESIGN.md` requires before delivery: the agent passes the human's bar, not a lower one.
 *
 *  `format:check` was missing (10/09). The oxfmt gate went into `make gates` and `ci.yml` on 09/09
 *  (#144) but not here, so an agent running exactly the bar quoted in its brief never formatted, and
 *  three batches landed on `main` unformatted. `check` rather than write: a verification command
 *  rewriting the agent's files under its feet would teach it that its tree moves by itself.
 *
 *  `-s` on every link: this column travels in the session spec (`repos[].testCommand`) and is quoted
 *  in every agent's brief. Without it the chain produced 10,900 lines, swallowed at once by a context
 *  window that did not recover. Fixing it here is enough for every future session to inherit it.
 *
 *  One list since 14/09. The bar was written twice in this file, here and in the
 *  `verification-avant-livraison` rule each agent reads, and they drifted in opposite directions: the
 *  command gained `format:check` on 10/09 and lost `typecheck`, the rule kept `typecheck` and never
 *  got `format:check`. An agent following the rule from memory shipped unformatted (PR #7 of 14/09,
 *  turning `main` red). Both now derive from `CHECKS`.
 *
 *  Exported so the test can follow it into the spec (`self-test-command.test.ts`). */
export const CHECKS = [
  "format:check",
  "lint",
  "typecheck",
  "test",
  "--filter @legion/web build",
] as const;

export const TEST_COMMAND = [
  "pnpm -s install --frozen-lockfile",
  ...CHECKS.map((c) => `pnpm -s ${c}`),
].join(" && ");

/** Rules injected into the system prompt. Deliberately short: a rule that cannot be quoted from memory
 *  is not followed. The long contract stays in docs/DESIGN.md, read in the repository.
 *
 *  Rule NAMES stay French: the runner and `.claude/rules/*.md` match on them. The contents were
 *  French until 17/09; data patch p2 moves rows still holding the French text to these. */
const RULES: { name: string; content: string; allAgents: boolean }[] = [
  {
    name: "verification-avant-livraison",
    allAgents: true,
    content: [
      `No task is finished until these ${CHECKS.length} commands pass, in this order:`,
      // Derived from `CHECKS`, never copied: copying made this rule drift from the command for four
      // days.
      `${CHECKS.map((c) => `\`pnpm ${c}\``).join(", ")}.`,
      "If one fails, the task is not finished: fix it, or ask a question in the inbox.",
      "Never announce work as done on the strength of reading the code.",
    ].join(" "),
  },
  {
    name: "design-system-non-negociable",
    allAgents: false,
    content: [
      "Any work in `web/` reads `docs/DESIGN.md` BEFORE writing.",
      "No inline `style={{}}`. No hardcoded value (colour, size, radius, duration, z-index):",
      "everything comes from `web/src/ui/tokens.css`, and a missing token is added THERE with a semantic name.",
      "One component = one module `ui/<name>.tsx` + its co-located `<name>.css`; no barrel.",
      "Every hook before the first `return`. lucide-react icons only, never an emoji.",
      "Every `.tsx` module has its `<name>.stories.tsx` next to it.",
    ].join(" "),
  },
  {
    name: "mesurer-plutot-que-supposer",
    allAgents: true,
    content: [
      "An interface fix is checked by MEASURING, not by eye:",
      "heights, alignments, overflows, contrasts, heading outline.",
      "Write the before/after figures in the task report.",
      "“It should work” is not a check.",
    ].join(" "),
  },
  {
    // A rule, not a skill, per the 24/08 decision (CLAUDE.md): what must always apply is imposed in
    // the system prompt; what serves to go deeper stays an invoked skill. A skill never invoked never
    // named a branch.
    //
    // Granted to all agents because the gap is everyone's: the brief tells agents they need not commit
    // or push, they sometimes do anyway, and nothing told them how to name what they create.
    name: "branches-conventionnelles",
    allAgents: true,
    content: [
      "Legion already gives you your session's branch: push to it, do not rename it.",
      "A branch you create YOURSELF follows conventionalbranch.org:",
      "`feature/<description>` for new behaviour, `bugfix/<description>` for",
      "something broken, `chore/<description>` for everything else (docs, refactoring, config).",
      "The description uses only a-z, 0-9 and the hyphen: never a capital, never an accent,",
      "never two hyphens in a row, never a hyphen at the start or the end.",
    ].join(" "),
  },
  {
    // Same text as data patch p3, which gives it to existing databases.
    name: "english-in-the-repository",
    allAgents: true,
    content: [
      "Everything that lands in the repository is written in English: commit messages, pull request",
      "titles and bodies (`pr.md`), code comments, tests and docs.",
      "Answer the operator in the language they write in.",
    ].join(" "),
  },
  {
    name: "secrets-jamais-en-clair",
    allAgents: true,
    content: [
      "Never write a secret in plain text in code, a comment, a log or a commit.",
      "Never touch `server/.env`. Secrets are referenced as `${SECRET:NAME}`",
      "and declared in the project's Secrets card.",
    ].join(" "),
  },
];

function upsertProject(): string {
  const existing = projectRowBySlug(SLUG);
  if (existing) {
    updateProjectRow(existing.id, {
      name: "Legion",
      repoUrl: REPO_URL,
      context: existing.context,
    });
    return existing.id;
  }
  const projectId = id();
  insertProjectRow({
    id: projectId,
    name: "Legion",
    slug: SLUG,
    defaultModel: "sonnet",
    repoUrl: REPO_URL,
    // fsRoot left NULL on purpose: agents write to the managed folder (`server/data/legion`), never
    // into the operator's working tree. Code lives in the repository clone inside the container, so
    // nothing an agent writes outside git can land in the local repository.
    fsRoot: null,
    context: [
      "Legion: control plane + UI on top of the Claude Agent SDK, for a single operator.",
      "pnpm monorepo: `server/` (Hono + Drizzle/SQLite, SSE), `web/` (React 19 + Vite + TanStack),",
      "`runner-payload/` (the process living in the container), `session-image/` (its Docker image).",
      "Sources of truth: docs/wiki/produit/ (what Legion is today; settled decisions in decisions.md),",
      "GitHub issues on ou-pas/legion (known defects and open work),",
      "docs/DESIGN.md (the design contract, the “Atelier” world).",
      "English for code, identifiers, comments and documentation.",
    ].join(" "),
    createdAt: now,
  });
  return projectId;
}

function upsertEnvironments(projectId: string): { open: string; limited: string } {
  const find = (name: string) => environmentRowByName(projectId, name);

  const openRow = find("open");
  const openId = openRow?.id ?? id();
  if (!openRow)
    insertEnvironmentRow({
      id: openId,
      projectId,
      name: "open",
      networking: NETWORKING.open,
      allowedHosts: "[]",
    });

  // The real allowlist for work on this repository: GitHub (clone + push), the npm registry
  // (install), and the fontsource CDN. api.anthropic.com and the control plane host are added by the
  // runner automatically.
  const hosts = [
    "github.com",
    "codeload.github.com",
    "objects.githubusercontent.com",
    "registry.npmjs.org",
    "cdn.jsdelivr.net",
  ];
  const limitedRow = find("limited");
  const limitedId = limitedRow?.id ?? id();
  if (limitedRow) {
    updateEnvironmentRow(limitedId, {
      networking: NETWORKING.limited,
      allowedHosts: JSON.stringify(hosts),
    });
  } else {
    insertEnvironmentRow({
      id: limitedId,
      projectId,
      name: "limited",
      networking: NETWORKING.limited,
      allowedHosts: JSON.stringify(hosts),
    });
  }
  return { open: openId, limited: limitedId };
}

function upsertRepo(projectId: string): void {
  const existing = repoRowByName(projectId, "legion");
  if (existing) {
    // `forge` is re-set at every boot: a row from before migration v34 carries `null`, and a `null`
    // read as "github by default" ends up looking like a choice.
    updateRepoRow(existing.id, { url: REPO_URL, testCommand: TEST_COMMAND, forge: "github" });
    return;
  }
  insertRepoRow({
    id: id(),
    projectId,
    name: "legion",
    url: REPO_URL,
    forge: "github",
    testCommand: TEST_COMMAND,
    createdAt: now,
  });
}

function upsertRules(projectId: string): Map<string, string> {
  const ids = new Map<string, string>();
  for (const rule of RULES) {
    const existing = ruleRowByName(projectId, rule.name);
    if (existing) {
      updateRuleRow(existing.id, {
        content: rule.content,
        allAgents: rule.allAgents,
        status: "active",
      });
      ids.set(rule.name, existing.id);
      continue;
    }
    const ruleId = id();
    insertRuleRow({
      id: ruleId,
      projectId,
      name: rule.name,
      content: rule.content,
      allAgents: rule.allAgents,
      status: "active",
      createdAt: now,
    });
    ids.set(rule.name, ruleId);
  }
  return ids;
}

function upsertAgents(
  projectId: string,
  env: { open: string; limited: string },
  rules: Map<string, string>,
): void {
  const design = rules.get("design-system-non-negociable");

  // Real least privilege: each agent declares what it needs, nothing more. `fsGrants` covers the
  // project's managed folder, not the repository; code access goes through `repoAccess`/`repoNames`,
  // and git is the only way code leaves.
  const agents = [
    {
      name: "front",
      title: "Interface — web/, design system, stories",
      model: null,
      repoAccess: REPO_ACCESS.write,
      environmentId: env.open,
      ruleIds: JSON.stringify(design ? [design] : []),
      rolePrompt: [
        "You work on Legion's interface, in `web/` only.",
        "You read `docs/DESIGN.md` before writing a line: it is a contract, not a description.",
        "You touch neither `server/`, nor `runner-payload/`, nor `session-image/`;",
        "if a task requires it, you ask in the inbox instead of spilling over.",
        "You check your fixes by measuring (heights, alignments, overflows, contrasts),",
        "and you write the before/after figures. You finish with `pnpm lint`,",
        "`pnpm --filter @legion/web build` and `pnpm test`, which renders every story.",
      ].join(" "),
    },
    {
      name: "server",
      title: "Control plane — server/, runner, schema",
      model: null,
      repoAccess: REPO_ACCESS.write,
      environmentId: env.open,
      rolePrompt: [
        "You work on Legion's control plane: `server/`, `runner-payload/`, `session-image/`.",
        "You do not touch `web/`. Any pure logic goes in its own module WITH its test",
        "(`node:test` + tsx, see `server/src/inbox/pending-by-project.test.ts`): a security boundary",
        "or an identifier resolution never ships without a test.",
        "Every schema change is a `PRAGMA user_version` step in `server/src/shared/migrations/`.",
        "You NEVER modify `server/.env`.",
      ].join(" "),
    },
    {
      name: "spec",
      title: "Specifies and documents — read-only on the code",
      model: null,
      repoAccess: REPO_ACCESS.read,
      // Limited network: writing a spec needs no egress. This agent demonstrates the wall works on
      // this project.
      environmentId: env.limited,
      rolePrompt: [
        "You write approvable specs and documentation for Legion.",
        "You READ the code, you do not write it. Your deliverable is a markdown file in the artifacts:",
        "the problem observed, the proposed decision with the alternatives set aside, and how we",
        "will check it is done. You quote the files and lines you actually read.",
        "You invent no behaviour: if you cannot check it in the code, you write it",
        "as a question, not as a fact.",
      ].join(" "),
    },
  ];

  for (const a of agents) {
    const existing = agentRowByName(projectId, a.name);
    const row = {
      title: a.title,
      model: a.model,
      rolePrompt: a.rolePrompt,
      repoAccess: a.repoAccess,
      repoNames: JSON.stringify(["legion"]),
      environmentId: a.environmentId,
      ruleIds: "ruleIds" in a ? a.ruleIds : JSON.stringify([]),
      // The HTTPS clone needs the PAT. It stays encrypted in the database and is resolved only at spawn.
      envSecretNames: JSON.stringify(a.repoAccess === REPO_ACCESS.write ? ["GITHUB_TOKEN"] : []),
      fsGrants: JSON.stringify([
        { folderPath: `/agents/${a.name}`, canRead: true, canWrite: true, canDelete: false },
      ]),
      inboxAccess: true,
    };
    if (existing) {
      updateAgentRow(existing.id, row);
    } else {
      insertAgentRow({ id: id(), projectId, name: a.name, createdAt: now, ...row });
    }
  }
}

const projectId = upsertProject();
const env = upsertEnvironments(projectId);
upsertRepo(projectId);
const rules = upsertRules(projectId);
upsertAgents(projectId, env, rules);

const agentNames = agentNamesOfProject(projectId);
// Not `shared/log.ts`, and not `console.log` either (batch 4): this block is a CLI script's output,
// a laid-out welcome note with indentation and ANSI bold. A log would squash it into a timestamped
// line, and `logControlEvent` has no use for it since it is not a system fact. Writing to the
// descriptor says exactly what it is, and the `no-console` gate covers this file like any other.
process.stdout.write(`
Project “Legion” declared (slug: ${SLUG}, id: ${projectId})
   repo          legion → ${REPO_URL}
   environments  open · limited (github, npm, jsdelivr)
   agents        ${agentNames.join(", ")}
   rules         ${RULES.map((r) => r.name).join(", ")}

BEFORE running an agent on it:

 1. \x1b[1mGITHUB_TOKEN secret\x1b[0m: Project page, Secrets card. A fine-grained PAT with write
    access to contents on ou-pas/legion. Cloning goes over HTTPS, not your
    “github-legion” SSH alias: without this secret, no agent can clone.

 2. \x1b[1mRebuild the image\x1b[0m: \`make image-session\`. It carried node and the SDK but not pnpm,
    so no monorepo test command could run in a container.

 3. \x1b[1mClaude credential\x1b[0m (optional): a \`CLAUDE_CODE_OAUTH_TOKEN\` secret on this
    project runs it on its own account instead of the one in server/.env.

What this script does NOT guarantee: grants do not go below the repository. “front does not
touch server/” is a prompt rule, not a barrier: an agent with write access to a repository can
write anywhere in it. Keep that in mind before handing it a broad task.
`);
