# Formatting and lint

Two tools, two jobs, never the same ground. `oxfmt` owns layout; `oxlint` owns meaning. Settled on
09/09 by the structure work, after the incident below.

## What the formatter does

`oxfmt` (`^0.64.0`) rewrites the code without asking: braces, indentation, wrapping a long call,
quotes, trailing commas. No configuration in the repository: the tool's defaults rule, on purpose. A
formatter you tune ends up argued about in review, exactly what a formatter is meant to prevent.

```
pnpm format         # rewrites in place
pnpm format:check   # fails if a file is not already in canonical form (CI)
```

## What the linter does

`oxlint` (`^1.79.0`, `--react-plugin`) reads the same scope and judges MEANING: an over-branched
function (`complexity`), a reassigned parameter (`no-param-reassign`), a `console.log` left in
production (`no-console`), an `any` that switches off typing at the boundary
(`typescript/no-explicit-any`). Its configuration is `.oxlintrc.json`, versioned and therefore open
to review, which the formatter refuses to be.

```
pnpm lint
```

## Why the two do not overlap

A lint rule that redoes layout duplicates the formatter, and the two end up contradicting each
other. On 09/09 `curly` wanted braces on every `if`, `oxfmt` imposed none, and `curly`'s autofix ran
alone without the formatter after it: 499 files rewritten as `{return x;}` on one line, a style
nobody would have chosen.

So `curly`, in every form, is absent from `.oxlintrc.json`: not forgotten, excluded. The principle
generalises. If `oxfmt` has an opinion on it (brace position, line length, object literal layout),
it does not go in `.oxlintrc.json`. If it is a fact about what the code DOES rather than how it
looks, it has no place in a `.prettierrc`/`.oxfmtrc` (there is none anyway).

## Order, and why it is enforced

`pnpm lint:fix` runs `oxlint --fix` THEN `oxfmt`, never the reverse and never one without the other.
A lint autofix can break layout (exactly what `curly` did); the formatter always runs last, so the
file coming out is both lint-clean and well formed.

In CI (`.github/workflows/ci.yml`) and `make gates` the check reverses the logic: CHECK format before
CHECKING lint (`format:check` then `lint`), because a badly formatted but lint-clean file must not
pass the gate silently. That check was the one missing on 09/09.

## Scope

Both commands cover `web/src`, `server/src`, `server/scripts` and `runner-payload` (the `format` and
`lint` scripts in `package.json`). `scripts/` is not in scope yet: not a settled exclusion, just the
current state of those scripts.
