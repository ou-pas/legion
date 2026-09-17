// The repository's boundaries, made mechanical (05/09).
//
// CLAUDE.md has described bounded contexts since batches 40-41: `ui/` knows no business domain,
// `shared/` is a leaf, a domain does not know the HTTP shell. As a prompt rule it was a request, not a
// gate. The 05/09 audit counted what the request let through: 45 forbidden edges after wave 1, 18
// import cycles, eleven domains reaching into `http/app.ts`, and fourteen `await import()` placed
// precisely to dodge a cycle no check named.
//
// This file repairs nothing, it names. Existing debt is declared in `scripts/arch-deps-baseline.json`
// with the work that settles it; anything new fails. Same ratchet as `scripts/api-pending.json`.
//
// It only looks at import graph edges. Function length, a complacent `!`, an unvalidated
// `c.req.json<T>()` are held by the AST harness in `server/src/architecture/`.
//
// No `tsConfig` (measured 05/09): neither tsconfig declares `paths`, so it adds no resolution (0
// unresolved relative imports over 1083 modules, NodeNext `.js` → `.ts` included). Passing it even
// breaks the scan: dependency-cruiser resolves the tsconfig `include` from cwd, and "src" does not
// exist at the root.
//
// The structure work's boundary (09/09, rule "domain-rule-files-do-not-query", target shape in
// CLAUDE.md): a converted domain may import `shared/db.ts` only from a
// `<subject>-store.ts`, a `*routes.ts` or `infra/`, never from its rules file. This list only grows,
// one domain per line so two batches merge without conflict.
const domainsWithSeparatedQueries = [
  "connections",
  "review",
  "inbox",
  "capabilities",
  "tasks",
  "projects",
  "infra",
  "chains",
  "portability",
  "concierge",
  "schedules",
  "updates",
  "shared",
  "integrations",
  "goals",
  "http",
  "sessions",
  "notifications",
  "environments",
  "events",
  "architecture",
  "auth",
  "models",
  "wiki",
];
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "An import cycle makes module initialisation order significant, and that order is written "
        + "nowhere. On 05/09 there were 18, most of them the cycles that dynamic `import()` calls "
        + "were hiding; scripts/arch-deps-baseline.json lists what remains.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "ui-knows-no-domain",
      comment:
        "DESIGN.md and CLAUDE.md: `web/src/ui/` is the shared design system and knows no domain. "
        + "The repository's rule: nothing domain-specific → `ui/`; one domain → its folder; several → "
        + "the screen composing them. A status label or a vocabulary table is domain, never a "
        + "primitive. `i18n/` is allowed because a primitive must be able to write text. "
        + "`*.stories.tsx` and `*.test.tsx` are exempt: the stories contract wants states mounted "
        + "with real content.\n"
        + "Zero violations since wave 1 moved `ui/graph.tsx` and `ui/graph-layout.ts` (which read "
        + "`api/tasks` for TASK_STATUS) into `tasks/`.",
      severity: "error",
      from: { path: "^web/src/ui/", pathNot: "\\.(stories|test)\\.tsx?$" },
      to: { path: "^web/src/", pathNot: "^web/src/(ui|i18n)/" },
    },
    {
      name: "domain-does-not-import-http-shell",
      comment:
        "`http/app.ts` mounts the application: middlewares, CORS, static files. A domain importing "
        + "it inverts the dependency (the shell knows the domains, not the reverse) and creates a "
        + "cycle as soon as the shell registers its routes. On 05/09 eleven modules did, all for "
        + "`crossOriginBlocked`, since moved to `http/guard.ts`, a leaf.",
      severity: "error",
      from: { path: "^server/src/[^/]+/", pathNot: "^server/src/http/" },
      to: { path: "^server/src/http/app\\.ts$" },
    },
    {
      name: "shared-is-a-leaf",
      comment:
        "`server/src/shared/` is the floor (db, crypto, events, env, docker-exec): everyone depends "
        + "on it, so it depends on nobody. A floor reaching up makes every import of it a "
        + "transitive import of that domain, which is how a crypto test ends up opening the "
        + "database. No exception for tests: a test crossing a boundary is the first place you stop "
        + "seeing it.",
      severity: "error",
      from: { path: "^server/src/shared/" },
      to: { path: "^server/src/", pathNot: "^server/src/shared/" },
    },
    {
      name: "operator-token-stays-home",
      comment:
        "The operator token never enters a container (13/09). It opens `/api`, so every project, "
        + "every repository and the credential routes, whereas an agent's session token opens only "
        + "`/internal/sessions/<its id>`. A module building a spec, a container environment "
        + "variable or an `/internal` response that could read it could leak it unnoticed. The "
        + "rule makes that impossible by construction: only the domain itself (`operator-guard.ts` "
        + "included) and the assembler creating it at boot have access.",
      severity: "error",
      from: {
        path: "^server/src/",
        // The domain, the assembler that creates the token at boot, and tests.
        //
        // Unlike `shared-is-a-leaf` above, which is layer hygiene valid everywhere, this protects a
        // secret from reaching a container, and a `.test.ts` ships in no image and builds no spec.
        // Refusing it would stop `http/errors.test.ts` from authenticating, so from going through
        // the guard: a rule that pushes toward weaker tests has the wrong target.
        pathNot: "^(server/src/operator/|server/src/index\\.ts$)|\\.test\\.ts$",
      },
      to: { path: "^server/src/operator/operator\\.ts$" },
    },
    {
      name: "runner-does-not-import-inbox-service",
      comment:
        "The runner produces session facts; the inbox formats them for the operator. Wave 1 "
        + "extracted `inbox/notices.ts` for that: the runner may import the templates, not the "
        + "service. dependency-cruiser also sees dynamic `await import(\"../../inbox/inbox.js\")`, "
        + "which a scan of static imports alone would miss.",
      severity: "error",
      from: { path: "^server/src/sessions/runner/" },
      to: { path: "^server/src/inbox/inbox\\.ts$" },
    },
    {
      name: "no-dynamic-import-to-break-cycles",
      comment:
        "A dynamic import from one server module to another is almost never lazy loading here. "
        + "It is a silenced cycle, which stays and merely becomes invisible to readers and "
        + "to `no-circular`. `import()` of a package is still allowed (loading something heavy or "
        + "optional).\n"
        + "Tests are exempt: a test here sets `process.env.LEGION_DB = …` then "
        + "`await import(\"../shared/db.js\")`, because the database module reads its path at load "
        + "time. That delay has a real ordering reason; counting them added 470 violations, and a "
        + "rule that shouts 470 times stops being read.",
      severity: "error",
      from: { path: "^server/src/", pathNot: "\\.test\\.ts$" },
      to: { path: "^server/src/", dependencyTypes: ["dynamic-import"] },
    },
    {
      name: "runner-payload-has-no-server-imports",
      comment:
        "The runner payload is compiled into the session image and runs in a container. It has "
        + "none of the control plane's `node_modules`: an import into `server/` would compile here and "
        + "explode when the first session starts; what enters the image is `tsc` output, not the "
        + "repository. Zero violations on 05/09: the rule freezes that state.",
      severity: "error",
      from: { path: "^runner-payload/" },
      to: { path: "^server/" },
    },
    {
      name: "domain-rule-files-do-not-query",
      comment:
        "A converted domain's rules file does not query the database. Target shape "
        + "(CLAUDE.md): `<subject>.ts` holds the rules and touches no database, disk "
        + "or network; `<subject>-store.ts` holds the queries, with no business `if`. A file that is "
        + "not a `-store.ts`, not a `*routes.ts` (the HTTP glue) and not under `infra/` (the layer "
        + "meant to touch the outside) may not import `shared/db.ts`.\n"
        + "No ratchet or baseline: `domainsWithSeparatedQueries`, at the top of this file, lists "
        + "only converted domains and only grows. `review` (batch 2, 09/09) came first.\n"
        + "One rule on purpose (10/09): batches 3 and 4 each wrote their own, with hard-coded name "
        + "and path, three rules for one boundary and a guaranteed conflict on every merge. The list "
        + "is the only mechanism.\n"
        + "A type-only import is exempt: it creates no runtime coupling, only a row shape "
        + "(`inbox/inbox-enums.ts` types its enums on Drizzle columns).\n"
        + "`infra/` (batch 7, 10/09) is listed without the constraint: it is one of the three named "
        + "exceptions, and the `pathNot` below keeps its files out.\n"
        + "`store.ts` without a mandatory dash (batch 12): inside its own subfolder "
        + "(`credentials/store.ts`, `seed/store.ts`) the subject prefix leaves with the file, as "
        + "`routes.ts` always allowed.\n"
        + "Both regexes are anchored (batch 13): `(^|[/-])store\\.ts$`, not bare `store\\.ts$`, "
        + "otherwise a future `restore.ts` would silently escape the constraint.",
      severity: "error",
      from: {
        path: `^server/src/(${domainsWithSeparatedQueries.join("|")})/`,
        pathNot: [
          "(^|[/-])store\\.ts$",
          "(^|[/-])routes\\.ts$",
          "\\.test\\.ts$",
          "^server/src/infra/",
        ],
      },
      to: {
        path: "^server/src/shared/db\\.(ts|js)$",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-orphans",
      comment:
        "A module nobody imports is either dead or an undeclared entry point. `warn` on purpose: "
        + "knip (`make deadcode`) answers the same question better, down to the unused export. "
        + "This rule only shows a whole file coming loose without failing the gate.",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "\\.stories\\.tsx?$",
          "\\.test\\.tsx?$",
          "^server/src/index\\.ts$",
          "^web/src/main\\.tsx$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
    // Types count as edges. A type-only cycle is a real cycle for a human reader, and for
    // `tsc --isolatedModules` as soon as an `enum` slips in.
    tsPreCompilationDeps: true,
    exclude: { path: "node_modules" },
  },
};
