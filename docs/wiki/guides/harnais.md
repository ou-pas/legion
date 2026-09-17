# The architecture harness

A rule written in `CLAUDE.md` is a request. An agent reads it, or does not, or reads it and decides
its own case is different. A gate in `make gates` is a rule: it is red or green, and nobody merges
on a red gate.

The harness, added on 05/09, turns four of the repository's promises into gates. The boundaries
between bounded contexts (`make arch`), the code nobody imports any more (`make deadcode`), the
security advisories on production dependencies (`make audit-deps`), and the server's coverage
thresholds (carried by `pnpm test`). The AST architecture tests live elsewhere, in
`server/src/architecture/`, and run with `pnpm test`: they count function length, complacent `!`,
unvalidated route bodies, against their own baseline (`scripts/arch-metrics-baseline.json`).

## The ratchet, and why it fails in both directions

This repository carries architecture debt, and that is normal. On 05/09 it counted 45 forbidden
import edges and 44 pieces of code nothing reached. A gate demanding zero before letting anything through would be crossed
once, disabled two days later, forgotten the week after.

So the gates do not count. They compare. What exists today is declared in a baseline, along with the
name of the work that will settle it:

- `scripts/arch-deps-baseline.json` for the boundaries (`make arch-baseline` rewrites it)
- `scripts/deadcode-baseline.json` for dead code (`make deadcode-baseline`)
- `scripts/arch-metrics-baseline.json` for the AST ratchet (`make arch-metrics-baseline`;
  `make arch-metrics` shows the measurements without the verdict)

A finding absent from the baseline fails, because debt was just added. A baseline entry that no
longer matches anything fails too, because a debt was just settled without removing its line. That
second direction is what separates a debt list from a graveyard: the day someone deletes
`tasks/text/proposal.ts`, the gate demands the declaration go with it, so the list really does get
shorter. Without it, the file would grow dead lines until nobody read it any more.

This is exactly the mechanism of `scripts/api-pending.json`, which `make contract` has used since
August for the same reason, and of `scripts/doc-map.json` for the docs.

## Reading a `make arch` failure

Two shapes, and they do not call for the same move. (The reason line under an edge is the first
sentence of the rule's comment in `.dependency-cruiser.cjs`.)

A crossed boundary is an import someone just wrote:

```
⛔ 1 BOUNDARY(IES) CROSSED, not declared:
   ui-knows-no-domain :: web/src/ui/__probe.ts → web/src/api/tasks.ts
      DESIGN.md and CLAUDE.md: `web/src/ui/` is the shared design system and knows no domain.
   Remove the import, or declare it in scripts/arch-deps-baseline.json, naming the piece of work
   that will settle it (`make arch-baseline` regenerates and keeps the names already given).
```

The line gives the rule, the edge, and the first sentence of why the rule exists. The rest of the
reason is in `.dependency-cruiser.cjs`, where every rule states the incident that motivated it and
what it does not do. In almost every case the answer is to remove the import: if a module needs what
sits on the other side, it is usually the module that is filed in the wrong place.

A stale declaration is a debt someone just settled:

```
⛔ 1 STALE declaration(s) in scripts/arch-deps-baseline.json — the edge no longer exists, remove the line:
   shared-is-a-leaf :: server/src/shared/inexistant.ts → server/src/tasks/lifecycle.ts   (work: …)
```

There, `make arch-baseline` does the work. It regenerates the file from the real state and keeps the
names already given, because that name is the one thing the tool cannot reconstruct.

## Declaring a debt

Sometimes a forbidden edge is added on purpose, because removing it cleanly needs a refactor that
has no business in the current task. In that case:

1. `make arch-baseline` (or `make deadcode-baseline`) regenerates the list
2. Find the `TO NAME` line the script just added
3. Replace it with the name of the work that will settle the edge, in one sentence that still reads
   three weeks later

"not done yet" is not a piece of work. "SessionResumer port: the runner publishes a session fact,
the inbox formats it, neither calls the other" is one, because it says what the end looks like.

The script warns you if unnamed lines remain, and it refuses to invent them.

## Settling a debt

Removing a baseline line is the only move that closes a boundary again. The procedure is the reverse
of the previous one: delete the import or the dead code, run the gate, it demands the now-stale
declaration be removed, regenerate.

It works. The 45 edges of 05/09 were spread over nine pieces of work; the four that carried most of
the count are done: `crossOriginBlocked` moved to `http/guard.ts` (eleven edges), the
`MigrationStep` type moved to its own leaf file (nine cycles), then the `SessionResumer` port and
the task closing port (the runner/inbox cycles and the dynamic imports hiding them). One edge
remains in `scripts/arch-deps-baseline.json`, a `no-circular` between two `ui/` files. The dead code
baseline holds 38 findings under five names.

## The boundary rules

`.dependency-cruiser.cjs` carries ten. Nine as errors, one as a warning.

`no-circular` forbids import cycles, including those that only go through types. A cycle makes
module initialisation order significant, and that order is written nowhere.

`ui-knows-no-domain` keeps `web/src/ui/` as the shared design system: it may import only `ui/`,
`i18n/` and packages. Story and test files are exempt, because the stories contract wants states
mounted with real content. This rule has been at zero violations since wave 1 moved the task graph
out of `ui/`.

`domain-does-not-import-http-shell` stops a domain importing `http/app.ts`, which mounts the
application. A domain that imports it inverts the dependency and creates a cycle as soon as the
shell registers its routes.

`shared-is-a-leaf` keeps `server/src/shared/` as the floor: everyone depends on it, so it depends on
nobody. Tests are not exempt, because a test crossing a boundary is the first place you stop seeing
it.

`operator-token-stays-home` keeps the operator token out of every container. That token opens
`/api`, so every project, every repository and the credential routes. Only `server/src/operator/`,
the assembler `server/src/index.ts` that creates the token at boot, and tests may import
`operator/operator.ts`. A module that builds a container spec or a `/internal` response cannot read
it, by construction rather than by vigilance.

`runner-does-not-import-inbox-service` separates what produces a session fact from what formats it.
The runner may import `inbox/notices.ts`, which carries the templates, not `inbox/inbox.ts`.

`no-dynamic-import-to-break-cycles` forbids dynamic `import()` from one server module to another.
Here it is almost never lazy loading: it is a cycle someone silenced, which stays, and merely
becomes invisible. Dynamic `import()` of a package is still allowed. Tests are exempt, and that is
not indulgence: a test in this repository writes `process.env.LEGION_DB = …` then
`await import("../shared/db.js")` because the database module reads its path at load time. Counting
them added 470 violations, and a rule that shouts 470 times stops being read.

`runner-payload-has-no-server-imports` protects the payload embedded in the session image. It runs
in the container, without the control plane's `node_modules`. An import into `server/` would compile
here and explode when the first session starts. The rule still holds now that the payload is
TypeScript: what goes into the image is the output of `tsc`, not the repository.

`domain-rule-files-do-not-query` enforces the target shape of a converted domain: `<subject>.ts`
holds the rules, `<subject>-store.ts` the queries, `routes.ts` the glue. In the domains listed in
`domainsWithSeparatedQueries`, at the top of the file, a module that is neither a store, nor a
routes file, nor under `infra/` may not import `shared/db.ts`. A type-only import is exempt. There is no
baseline here: the list only grows, one domain at a time.

`no-orphans` is a warning only, because knip answers the same question better.

## What `make deadcode` counts

knip looks for what no entry point reaches: files, exports, types, duplicate exports. Its
configuration is in `knip.json`, and three decisions there need explaining, since JSON takes no
comments.

`ignoreExportsUsedInFile` is on. Without it, knip reports every export consumed only inside its own
file, which describes a good part of the repository while teaching nothing.

The migration slices `server/src/shared/migrations/v*.ts` are ignored. Each slice exports a `steps`
array that only `migrations/index.ts` reads, spread in application order. That is the registry
mechanism, not dead code.

`runner-payload/` has been a knip workspace of its own since batch 10, with `session-runner.mts` as
its entry point. The container's three dependencies, `undici`, `zod` and
`@anthropic-ai/claude-agent-sdk`, are declared there and seen as such; they were ignored at the root
back when the payload lived there as JS, which amounted to not watching them at all.
`dependency-cruiser` and `tsx` stay ignored: they are invoked as binaries from the scripts and the
Makefile, never by import.

`make deadcode-report` gives knip's raw output, without the ratchet, when you want the landscape
rather than the delta.

## The security advisories

`make audit-deps` runs `pnpm audit --prod --audit-level=high`. The scope matters: an advisory on a
devDependency does not touch what runs, and failing the gate on it teaches people to ignore it.

Two "high" advisories were found on 05/09 and overridden from `pnpm-workspace.yaml`, which is where
`overrides` live since pnpm 11 (the `pnpm` field of `package.json` is no longer read at all, and an
override placed there commits without doing anything). Two "moderate" advisories remain,
deliberately not overridden.

## The coverage thresholds

The server's `test` script carries 80% lines, 75% branches, 75% functions. Measured today at
95.0 / 83.3 / 84.6: the margin is the point. The thresholds catch a slice of code arriving without
tests, not the current state.

Tests and migrations are excluded from the measurement. A migration is replayed by every test that
opens a database, so counting it inflates the number without proving anything about it.

One trap worth knowing: the `dot` reporter prints nothing when it is coverage that falls, the
process simply exits 1. `make gates` says it instead, and `make coverage-report` prints the
file-by-file table so you can find which one dropped.

## The lint rules turned on with the harness

Four `oxlint` rules became errors on 05/09, and only because they were already at zero violations. A
rule turned on above seventy-eight violations with a global exception is not a gate, it is scenery.

`no-console` is an error in `web/src` (zero) and off in `server/src` (seventy-eight), where
`console.*` is still the product's logging and replacing it is a piece of work in itself.
`react/exhaustive-deps` and `typescript/no-explicit-any` are at zero, except for three files named
one by one in the overrides. `import/no-default-export` is at zero outside `*.stories.tsx`, where
the CSF3 format requires a default export.

Measured and set aside: `import/no-cycle` (six violations, and weaker than dependency-cruiser, which
also sees type-only edges), `no-non-null-assertion` (seven hundred and seventy-eight) and the
`max-*` / `complexity` family, which belong to the AST ratchet.

## Measuring the compact breakpoint

`make responsive` opens the triage screens in a real browser at 375 by 812, the size of an iPhone 13
mini, and checks three things. That the document does not scroll horizontally. That the content gets
at least 60 per cent of the height. And that no button, link or field sits outside the window
without a container scrolling to reach it.

That third rule is the one needing a little attention. A questionnaire's step strip is fifteen
hundred pixels wide, and that is intended: it lives in a scrolling container, so every step stays
reachable. The three buttons of the launch bar, on the other hand, sat off screen with nothing
scrolling, and a task could no longer be run from a phone. A measurement that does not tell those
two cases apart is unusable, it either cries wolf or sees nothing.

`make dev` has to be running, since the script visits the application, and `LEGION_TOKEN` has to be
set (`LEGION_TOKEN=… make responsive`), since `/api` requires an operator session. The list of addresses is
built from what the server serves, so you also need at least one project, and one open inbox entry
for the question screens to be measured. Without an inbox entry, the two matching addresses are
simply absent from the report.

This is not a `make gates` gate, and that is deliberate. The Chrome sweep over the stories was
removed on 9 September for its six minutes and its false positives in continuous integration;
putting a browser back without discussing it would reopen a settled question. The script is a tool
you run when you touch a layout.

What the gate does not look at: a colour, an alignment, a font weight. It measures boxes. For the
rest you have to look, and `SHOTS=/path make responsive` drops one screenshot per address.

## See also

- [[guides/ci]] for what runs on every pull request
- `.dependency-cruiser.cjs` for why each boundary rule exists
- `scripts/arch-check.ts` and `scripts/deadcode-check.ts` for the ratchet itself
