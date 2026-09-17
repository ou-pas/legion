# Mutation testing

Coverage says a line was executed during the tests. It never says the line was checked. A test that
calls a function without asserting anything about its result covers one hundred per cent of its body
and holds nothing at all.

Mutation testing measures the gap. Stryker breaks the code one line at a time, then replays the tests
against each broken version. A `>` becomes `>=`, a `&&` becomes `||`, a string becomes empty, a
condition becomes `true`. If a test fails, the mutant is killed: someone was watching. If every test
stays green, the mutant survives, and that is the useful signal.

The score is killed mutants over generated mutants. It does not compare across domains: a parsing
module produces ten times more mutations than a state machine, and a single regular expression
produces dozens, most of which change nothing observable.

## Running the measurement

Always on one domain, never on the whole repository. Measuring the server's 348 test files at once
would take hours for a number nobody reads.

```
make mutation-server DOMAIN=projects
make mutation-web DOMAIN=tasks
make mutation-report
```

For a narrower measurement, the raw command accepts a list of files. That is what you do after writing
a suite, to find out what it holds.

```
cd server && npx stryker run \
  --mutate "src/projects/git-identity-check.ts" \
  --testFiles "src/projects/git-identity-check.test.ts"
```

On the server, `--testFiles` matters as much as `--mutate`. The runner starts each test file in its
own node process, so opening the list to the whole repository costs a minute before the first mutant,
and makes the measurement depend on unrelated tests. On the UI side, vitest runs in a single process
and Stryker filters tests per mutant itself: there is nothing to pass.

Reports land in `server/reports/mutation/` and `web/reports/mutation/`, ignored by git. Each run
overwrites the previous one, which is the right default for a measurement taken domain by domain.

## The sandbox, and the one trap it sets

Stryker never mutates your files: it copies the package into `server/.stryker-tmp/sandbox-XXXX/` and
works there. `node_modules` is a symlink there, which is vital here since `better-sqlite3` is a native
binary that copying would break.

The consequence shows up on the first try. A test that climbs three levels from its own file, like
`new URL("../../../web/src/", import.meta.url)`, used to point at the repository root and now points
at `.stryker-tmp/`, which contains nothing. About a dozen server tests do this legitimately: they read
`web/src/`, `runner-payload/` or `docs/wiki/`, outside the package. They then fail in the dry run,
and Stryker stops before the first mutant.

`make mutation-server` sets them aside on its own, by looking for the `../../../` pattern in test
files. The cause is named, not a list of names that would go stale with the next test added. With the
raw command, it is up to you not to pass them to `--testFiles`.

## It is not a gate

`make gates` runs none of this, deliberately. A gate is paid in seconds; two UI files cost two
minutes and the `tasks` domain costs twelve. The verdict is not binary either: a surviving mutant can
mean three very different things, and only reading decides. Finally the score moves when the code
moves, not only when the tests do, so a blocking threshold would fail a build over an untested branch
added somewhere else.

The configuration's thresholds exist anyway, but they colour the report without stopping anything:
`break` is `null`, `low` is 60, `high` is 80.

## Reading a survivor

The console report gives, for each survivor, the file, the line, the mutator name and the mutation's
diff. The HTML report gives the same with the surrounding code, which is more comfortable once there
are more than ten.

```
[Survived] MethodExpression
src/projects/git-identity.ts:39:19
-   const trimmed = email.trim();
+   const trimmed = email;
```

Read it as: the `trim()` can be removed without a single test noticing. Either nobody tests an
address surrounded by spaces, or the `trim()` is useless.

There are exactly three possible responses, and the choice is made by reading the code, not by
looking at the score.

The first is to add the missing assertion. It is the most frequent case and the only one that really
improves anything. Here, a test passing `" operator@acme.test "` and expecting the clean address kills
the mutant and documents the contract along the way.

The second is to delete dead code. A mutant that survives because its line changes nothing observable
is sometimes a line that serves no purpose. The mutant is then not the problem but its symptom: code
goes, no test comes.

The third is to declare the mutation uninteresting. Some are indistinguishable by construction: a
default value never reached in practice, a regular expression whose loosened quantifier accepts the
same inputs, an error message whose text nobody checks. You write it in the code, with the reason, and
Stryker stops generating it.

```ts
// Stryker disable next-line StringLiteral: the label is not a contract, no test reads it
const label = "code";
```

The long form works for a block (`// Stryker disable StringLiteral` then
`// Stryker restore StringLiteral`), and `all` replaces the mutator name when you mean every one. An
exclusion with no written reason is one nobody will be able to reread in six months: the text after
the colon shows up in the report.

## What a survivor does not say

A score of one hundred per cent does not prove the code is right, only that the tests see everything
Stryker knows how to break. And a low score on a file can be irrelevant: `markdownish.tsx` is the
example, its regular expressions alone produce about forty mutants, most describing the same
quantifier loosening.

The right question is never "is the score high enough", it is "among these survivors, which ones
describe a behaviour I believed was held".

## What was measured at the start

The numbers from 05/09, at setup, on modules chosen because they are small and reputedly well tested.

| Scope | Total score | Covered score | Survivors | Duration |
| --- | --- | --- | --- | --- |
| server, `projects/git-identity{,-check}.ts` | 69.0% | 87.3% | 13 | 11 s |
| server, `tasks/lifecycle.ts` | 84.0% | 84.6% | 23 | 2 min 05 |
| UI, `ui/safe-href.ts` | 94.4% | 94.4% | 1 | 2 min 05 |
| UI, `ui/markdownish.tsx` | 50.2% | 60.7% | 88 | for both |
| UI, whole `tasks` domain | 19.5% | 55.6% | 580 | 11 min 44 |

The gap between the two score columns is telling. The total score counts mutants no test reaches; the
covered score only counts those a test goes through. On `git-identity-check.ts`, twenty-seven mutants
are covered by nobody, all in the two functions that talk to the forge: they are only tested through
their pure part, a deliberate choice that the total score makes visible.

On `markdownish.tsx`, the test file is twenty-one lines for a parser of a hundred and thirty. The score
says so bluntly, and the survivors name what is missing: inline formatting, bold and backtick code, is
checked nowhere, and half the remaining survivors are quantifier loosenings in the table regular
expressions.

`lifecycle.ts` is the opposite and serves as the yardstick: a state machine whose tests walk every
starting status, at 84%. Its survivors point at real, small things, like the `if (moved.changes > 0)`
guard before logging the automatic settlement, which nobody checks actually protects anything.

The whole UI `tasks` domain is the one number not to read as a verdict on the tests. At 19.5% total
against 55.6% covered, it mostly says that a domain of screens is tested through its pure modules and
not through its pages: 2,429 of 3,737 mutants live in components no test mounts, `TaskComposer.tsx`
and `task-screens.tsx` first. The `text/` folder, which carries the displayed vocabulary, is the
interesting edge case: nearly all its strings survive, because nobody ever asserts that a label is
that label. A defensible choice, but a choice.

## See also

[[guides/ci]] for the gates that do block.
