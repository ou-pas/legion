# Continuous integration

Two files in the repository's `.github/workflows/`: `ci.yml` runs the gates on every pull request,
`pr-title.yml` checks that the PR title is a conventional commit. Both run dry: no secret is needed,
neither on the repository nor in the workflow.

## Why this file exists

On 02/09, PR #66 landed on `main` with six red tests. Every PR carried its agent's checks, green on
its branch when the agent finished, but nobody replayed `make gates` at merge time. `main` stayed
taggable-but-red until someone found out while cutting v0.4.0.

The same evening, three more merge breakages followed on the v0.5.0 batch: each PR green on its
branch, `main` broken by their sum (a port type widened by one, two test harnesses left behind by
the other two). `ci.yml` closes the first hole. On its own it does not close the second, see below.

## What `ci.yml` checks

A single job, `gates`, which replays in order what `make gates` does locally: formatting
(`pnpm format:check`), `pnpm lint`, `pnpm typecheck` (server and web), the boundaries
(`scripts/arch-check.ts`), dead code (`scripts/deadcode-check.ts`), the dependency audit
(`pnpm audit --prod --audit-level=high`), `pnpm test` (server and web), the API contract
(`scripts/api-contract.ts`), the docs contract (`scripts/doc-contract.ts`), then the production
build of the UI. The job has `timeout-minutes: 10`: roomy, not generous. A runner that hangs is not
a gate.

`make gates` has one more step that CI does not: the freshness check (`scripts/fresh-check.ts`),
which runs first so that a branch built on an old `main` fails before the suite runs for nothing.

The `pull_request` trigger runs the gates on the PR's MERGE COMMIT against its base, not on the
branch alone. That is the move the operator makes by hand when merging from GitHub, replayed
automatically. The workflow also runs on `push` to `main`: that is the safety net while the branch
protection setting is not in place (next section), so a broken `main` shows up the minute it is born
instead of at the next tag.

## The setting to apply by hand (the operator, not this file)

`ci.yml` alone does not prevent the three breakages of 02/09. CI on `pull_request` tests the merge
commit AT THE MOMENT IT RUNS. If `main` moves afterwards, because another PR merged in between, and
you merge anyway without replaying the gates, the green on display is a fossil. That is exactly the
mechanism behind the three merge breakages on v0.5.0.

The only setting that closes that hole is a GitHub checkbox, not a YAML file:

1. Repository → Settings → Branches → Branch protection rules → rule on `main`.
2. Require a pull request before merging.
3. Require status checks to pass before merging, and tick the `gates` check (the one `ci.yml` sets)
   as required.
4. Require branches to be up to date before merging. This is the box that matters most here.
   Without it, GitHub lets through a PR whose green predates the last push to `main`. With it, a
   lagging PR has to update (merge or rebase) and replay the gates before it can merge.

`ci.yml` is designed to be the ONLY required check in step 3: one file, one job (`gates`), one name
to tick.

If PR throughput makes the systematic re-run of step 4 painful, with several PRs overtaking each
other and re-testing in a loop on every merge, GitHub's alternative is the merge queue (Settings →
Branches → same rule → Require merge queue): it serialises merges and tests each PR against the real
state of `main` as it enters the queue, without anyone re-running anything.

## The stories gate left the browser

Until 9 September, `make gates` opened every story of the workshop in a real Chrome, and that gate
did not run in CI. That was not an oversight: the measurement recorded in the script said that with
six tabs on a contended Chrome, three passes over the same 260 stories rendered 257, 247 and 253,
with different victims each time. A two-core GitHub runner reproduces that kind of contention by
construction, and a check that produces false reds stops being believed, then stops being run.

The sweep also cost six minutes on its own over 894 stories, which made it the dominant item of the
local gates. Two causes, measured: Storybook's dev server compiles each story on first load, and the
script waited a hard-coded 400 milliseconds after each navigation.

What it checked never needed a browser: a node count in the document and console errors, nothing
more. No layout, no colour, no paint. Stories composed with `composeStories` and rendered in the test
suite, which already runs under jsdom, give the same facts in a second and a half. That is
`web/src/stories.test.tsx`, so it runs wherever `pnpm test` runs, CI included.

It checks three things: that each stories file carries its `export default meta` (without it
Storybook does not index the file, and the whole workshop may refuse to start), that each story
renders more than the preview decorators, and that a story declared empty with
`tags: ["renders-nothing"]` really is. Whether a module has its stories file at all is another,
older gate: the `storiesMissing` metric of [[guides/harnais]].

What stays out of reach is what always was, in a browser as in jsdom: what has to be judged by eye.
`make ds` opens the workshop for that.

## The title validator (`pr-title.yml`)

A file separate from `ci.yml`, using the same action as Acme's two repositories
(`ytanikin/PRConventionalCommits`, the one that once rejected `AcmeHQ/frontend#526`). It checks that
the PR title starts with one of eight conventional types (`feat fix docs chore refactor test perf
ci`): the three that `task-branch.ts` emits (`feat`, `fix`, `chore`) plus the five needed to cover
the rest of the repository.

This repository merges with merge commits, never squash, so the PR title never becomes the message
that reaches `main`. The validator is still useful: clean titles are material that other tooling
reads. It sets no label (`add_label: false`): reading the title is all it needs, and setting labels
would have required a write token for a benefit nobody asked for.
