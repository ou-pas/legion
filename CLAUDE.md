# Legion project instructions

Personal Legion: a control plane and UI on top of the Claude Agent SDK. One human, the operator,
assigns tasks and goals to scoped agents running in throwaway Docker containers, with least
privilege (MCPs, repositories, folders, network), approval gates, a single inbox and mandatory
artifacts.

## Sources of truth (read before any work)

1. `docs/wiki/produit/` says what Legion is today. `etat.md` says what runs, what is explored and
   what is unfinished; `decisions.md` says what was settled and why. Do not contradict a settled
   decision without discussing it with the operator. A PR that changes the product changes these
   pages in the same move: it is the only thing that keeps a source of truth from silently becoming
   an archive.
2. GitHub issues on `ou-pas/legion` hold known defects and open work. A product gap (something
   Legion does not do yet) belongs in `docs/wiki/produit/etat.md`, not in an issue alone.
3. `docs/DESIGN.md` is the design contract (the "Atelier" world, tokens, components,
   anti-patterns). `docs/directions/` holds the UI explorations: `direction-atelier.html` is the
   retained world, the others are dated explorations and decide nothing on their own.
   `docs/maquette.html` is the old "linear" mockup, kept for history.

## Key decisions (summary, details in `docs/wiki/produit/decisions.md`)

- Stack: TypeScript on Node 20+, Hono, Drizzle + SQLite (better-sqlite3), React 19 + Vite, SSE for
  streaming (no WebSocket).
- Execution: Docker only, one container per session, `internal` network plus an egress proxy with a
  domain allowlist. Several Docker hosts (local machine, home server over `ssh://`).
- Claude only. Model routing: step or task, then agent, then project default. Auth is abstracted:
  API key OR subscription OAuth token.
- Notifications: PWA + Web Push is the recommended bridge; Discord (two-way, bot with
  `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID`) is the second. There is no Telegram bridge.
- Secrets: encrypted in the database (AES-256-GCM), master key outside the database. Never a
  plaintext secret in code or commits.
- Every template step declares its expected artifacts (`/artifacts/` per session, rendered in the
  UI).

## Working method: subagents

Delegate to the specialized subagents (`.claude/agents/`) to keep the main session's context:

- `legion-architect`: architecture consistency; consult before any structural decision.
- `planner`: break a piece of work into atomic tasks before implementing.
- `code-explorer`: search the code instead of exploring at length yourself.
- `typescript-reviewer`, `react-reviewer`, `code-reviewer`, `security-reviewer`: review after each
  significant block of code (in parallel when independent).
- `e2e-runner`: write and run E2E tests.
- `doc-updater`: keep `docs/` up to date at the end of a session.
- `impeccable-*` and the `/impeccable` skill: all UI work goes through impeccable (`DESIGN.md` and
  `PRODUCT.md` are filled in, do not rerun `init` without a reason).

Run independent subagents in parallel. A code review uses at least two reviewers in parallel
(language and security).

## Conventions

- English for code, identifiers, docs, comments and commit messages. Exchanges with the operator
  stay in French.
- Atomic commits with conventional messages (`feat:`, `fix:`, `docs:`...), never a commit without
  green tests on the touched area.
- Legion agent prompts reconstructed from Danny Postma's talk carry the header « Reconstructed from Danny Postma's Legion talk — not his verbatim prompt ».

## Attribution

Agents `.claude/agents/{planner,code-reviewer,typescript-reviewer,react-reviewer,security-reviewer,e2e-runner,code-explorer,doc-updater}.md`
come from ECC (https://github.com/affaan-m/ecc). The impeccable skill: https://impeccable.style
(pbakaus/impeccable, v4.1.1).

## Architecture skills

Read before any structural change: `.claude/skills/` `domain-driven-design`,
`clean-architecture`, `a-philosophy-of-software-design`, `refactoring` (OBEY rules distilled from
the books, ciembor/agent-rules-books, MIT, mini version). For any web work:
`modern-web-guidance` (GoogleChrome, Apache-2.0, `npx modern-web-guidance search`, or grep
`guides/` offline).

On the runtime side (Legion's own agents) the arrangement has two tiers on purpose, because a rule
is enforced and a skill is only a request:

- the nano versions of the four books are project rules checked "all agents": they are injected
  into the system prompt of every session, with no invocation to forget;
- the mini versions stay skills (`data/skills`), invoked when a decision is truly structural. They
  reach agents through the project's `default_skill_names`; a skill granted to no agent cannot be
  invoked.

`lean-ctx` is a built-in skill (`server/src/capabilities/builtin-skills.ts`), like `grilling`. It is
a context discipline: search before reading, read a range rather than a file, never pass thousands
of lines of test output through the context window. It is a project default rather than an agent
grant, because it applies to anyone touching a repository.

## Code structure

This structure is the rule, not an ideal.

- `server/src/<domain>/`: one folder per bounded context (architecture, auth, capabilities, chains,
  concierge, connections, environments, events, goals, http, inbox, infra, integrations, models,
  notifications, operator, portability, projects, review, schedules, sessions, shared, tasks,
  updates, wiki). Each domain carries its own routes (`registerXRoutes`), its service and its tests.
  `index.ts` is the assembler: it composes the boot and registers each domain's routes. Never add a
  route or a business rule there.

  The target shape of a converted domain separates three kinds of files, and the kind reads in the
  name. `<subject>.ts` holds the rules and touches no database, disk or network. `<subject>-store.ts`
  next to it holds the queries, named after what they read or write, with no business `if`.
  `routes.ts` glues the two (reads the request, calls the store, calls the rule, writes the
  response). `ports.ts` only where two implementations really exist (`inbox/ports.ts`). The
  dependency-cruiser rule `domain-rule-files-do-not-query` enforces it for converted domains
  (`domainsWithSeparatedQueries` in `.dependency-cruiser.cjs`): a rules file importing
  `shared/db.ts` fails the build instead of waiting for a review.

  A subfolder appears when four or more files of a domain share a prefix, because that prefix is a
  folder copied into every name. The prefix leaves the file once it is in its folder
  (`sessions/runner/boot.ts`, not `sessions/runner/runner-boot.ts`), except when it collides with a
  tooling convention: `*-enums.ts` files keep their hyphen (`capabilities/agent/agent-enums.ts`),
  otherwise `NO_TEST_EXPECTED` in `scripts/arch-metrics.ts` misses them.
- `web/src/<domain>/`: its components and its pages. `web/src/ui/` is the shared design system (no
  business knowledge). `web/src/api/<domain>.ts` is the client (types and calls).
  `<name>.stories.tsx` sits next to each component. No `components` or `ds` folder: sorting by
  technical type is the anti-pattern.
- The arbitration rule: nothing domain-specific goes to `ui/`; one domain goes to its folder;
  several go to the screen (or `app/`) that composes them. A status label, a business format, a
  vocabulary table are domain, never a primitive.

## The wiki

`docs/wiki/` is Legion's documentation, written for the people who use it: concepts, guides,
reference. It is versioned with the code, so it is in every session's clone: an agent wondering
what an approval gate is finds the answer without leaving its container.

Links between pages are written `[[path/page]]` or `[[path/page|label]]`, Obsidian style (the
folder opens as is in Obsidian). Resolution accepts the bare name: `[[agent]]` finds
`concepts/agent`. The server serves it read-only (`server/src/wiki/`), the screen renders it in the
panel (`/wiki`), and writing happens in the repository, under review, like code.

The corpus style follows `blader/humanizer`: no em dashes, sentence-case headings, no lists with
bold headers, no mechanical bold, no vague conclusions, no forced triads. It differs from the code
comment style on purpose: docs address a reader, not a code reviewer.

The wiki holds two corpora that answer different questions:

- `docs/wiki/{concepts,guides,reference}` answers "how do I use it". It changes when usage changes:
  a new gesture, a different screen, a failure we can now name.
- `docs/wiki/produit/` answers "what is it, and why is it built this way": what Legion is, for
  whom, its principles, its settled decisions with their reasons, and where it stands. It changes
  when the product changes.

When a feature changes, the page describing it changes in the same PR. A code change often touches
neither corpus, sometimes one, rarely both; "nothing to document" is a valid answer that should
take three seconds.

`PRODUCT.md` is not product documentation: it is the design brief read by the `impeccable` skill
(surface, audience, tone, references). Asking it to play both roles made it drift.

## Front-end skills

For any work on `web/`, first read the relevant skills in `.claude/skills/`:
`react-best-practices`, `composition-patterns`, `web-design-guidelines` (Vercel,
github.com/vercel-labs/agent-skills), `tanstack-router`, `tanstack-query`, `tanstack-integration`
(github.com/DeckardGer/tanstack-agent-skills). Combine them with impeccable and `DESIGN.md` for
style.

## Non-negotiable front-end rules (design system)

The full contract is `docs/DESIGN.md`; read it before any work on `web/`. The executable summary:

1. No inline `style={{}}`: it is a lint error (`react/forbid-dom-props`). Commented exceptions: a
   gauge's computed width, a floating surface's computed position. Only `ui/flex.tsx`,
   `ui/card.tsx` and `ui/modal.tsx` are exempt.
2. No hard-coded value (color, size, radius, duration, z-index), in TSX or CSS. Everything comes from
   `web/src/ui/tokens.css`. A missing token is added there, with a semantic name.
3. `theme.css` no longer exists and must not come back. A component is a module `ui/<name>.tsx`
   plus its co-located `<name>.css`. No `index.ts` barrel.
4. A pattern repeated three times becomes a component; one file, one role (15 to 90 lines).
5. Composition over booleans: explicit variants, slots, compound components.
6. All hooks before the first `return` (`react/rules-of-hooks`): a hook after an early return
   crashes the app in production with no TypeScript error.
7. `lucide-react` icons only. No emoji or unicode glyph as an icon.
8. Every `.tsx` module has its `<name>.stories.tsx` file next to it. `storiesMissing` in the AST
   metrics (`scripts/arch-metrics-baseline.json`, regenerated with `make arch-metrics-baseline`)
   holds it as a membership list that fails both ways: one more module without stories fails, and
   removing a line is the gesture that pays the debt back. A `.test.tsx` counts as co-location.

   How many states depends on the folder, because no machine counts a component's states and an
   unverifiable rule is only a request:
     · `ui/`: every state. It is the design system, and a human reads that folder.
     · a domain: one state minimum, and more only for what a reader cannot guess: empty, error,
       truncation, loading.
   A story that renders nothing is a legitimate state, but it must say so:
   `tags: ["renders-nothing"]`. The gate cannot tell "empty on purpose" from "empty by accident",
   and the tag fails both ways too.

   The workshop is Storybook (`make ds`, or `make dev`, which serves it on :6006). What matters is
   co-location: a module without its stories file shows in the folder.
   CSF3 format: `const meta = { title } satisfies Meta`, then one story per state as
   `export const X: Story = { name: "readable label", render: () => … }`. `name` is a label, not an
   identifier, so it accepts any punctuation.
   A stateful story is written `render: function Render() { … }`: an anonymous arrow is not a
   component for `react-hooks`, and rule 6 would fall.

Mandatory check at the end of a front-end task:
`pnpm lint && pnpm --filter @legion/web build`.

`make contract` compares what the screen calls with what the server serves. It is the one contract
no compiler reads: the two halves share a string, not a type, so a front-end task can ship a call
before any server task ships the route. It fails on a new gap in either direction (a route served
that nobody calls is a gap too). A known gap is declared in `scripts/api-pending.json` with the
name of the task that will fill it, and a stale declaration fails as well, so the list stays debt
and not a graveyard.

`make gates` checks the whole of `main`: freshness against `origin/main`, format, lint, types on
every package, boundaries, dead code, dependency audit, tests (with server coverage and the stories
gate), API contract, UI build. Run it before pushing to `main` and after any merge, because
`tsx watch` does not typecheck and nothing else runs `tsc` on the main branch.

`web/src/stories.test.tsx` proves that a story renders, and it runs in `pnpm test`, so everywhere:
locally, in CI, in an agent session. `tsc`, the linter and the workshop build only prove a story
compiles. It checks four facts: each file has its `export default meta` (without it Storybook does
not index the file, and a single malformed file stops the workshop from starting for everyone);
each story renders more than the preview decorators; a story tagged `renders-nothing` is indeed
empty; each module has its stories file or its declared debt (rule 8).

The floor is measured, not hard-coded: the preview decorators render nodes on their own, so
"the story rendered" is judged above a floor measured at startup by composing an empty story. A
constant would lie as soon as a decorator is added.

It needs an `await act(async () => …)` after each render. Without that flush the preview's
`RouterProvider` has not resolved and every story renders empty, the very defect the gate exists
to catch.

The gate does not look at layout or color. `make ds-build` remains useful as a quick compilation
check, and `make ds` for what is judged by eye.

## Architecture harness

A prompt rule is a request; a gate is a rule. Boundaries written only in this file were readable
and bypassable, so they are enforced by these gates, all part of `make gates` and `ci.yml`:

- `make arch`: dependency-cruiser (`.dependency-cruiser.cjs`) against
  `scripts/arch-deps-baseline.json`. Boundaries: no cycles, `ui/` knows no domain, a domain does not
  import the `http/` shell, `shared/` is a leaf, the runner does not import the inbox service, no
  internal dynamic `import()` to hide a cycle, `runner-payload/` does not import `server/`, rules
  files do not query, no orphans.
- `make deadcode`: knip (`knip.json`) against `scripts/deadcode-baseline.json`, the files and
  exports nothing reaches. `make deadcode-report` gives the raw output.
- `make audit-deps`: `pnpm audit --prod --audit-level=high`. `overrides` live in
  `pnpm-workspace.yaml`, not `package.json`: pnpm 11 no longer reads the `pnpm` field, and an
  override placed there commits without doing anything.
- Coverage thresholds (80 lines / 75 branches / 75 functions) are in the server `test` script. The
  `dot` reporter prints nothing when coverage is what fails: `make gates` says so instead, and
  `make coverage-report` prints the table.

Baselines fail both ways, like `scripts/api-pending.json`: an undeclared finding fails (debt added),
and a stale declaration fails too (debt paid without removing the line). Without the second
direction the list becomes a graveyard and the number never goes down. `make arch-baseline` and
`make deadcode-baseline` regenerate while keeping the pieces of work already named: run them only
for debt added on purpose and named. "Not done yet" is not a piece of work.

An oxlint rule is enabled only once its count is at zero (`no-console`, `react/exhaustive-deps`,
`typescript/no-explicit-any`, `import/no-default-export` were). A rule enabled over dozens of
violations with a global exception is decoration, not a gate.

The AST architecture tests live elsewhere: `server/src/architecture/`, run by `pnpm test`, with
their own baseline `scripts/arch-metrics-baseline.json`. They count what the import graph does not
see: nesting depth, gratuitous `!`, unvalidated route bodies, missing stories. Two harnesses, two
baselines, two names: do not confuse them.

The reading guide is `docs/wiki/guides/harnais.md`: how to read a failure, declare a debt, pay it
back.
