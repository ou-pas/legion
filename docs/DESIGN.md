# Legion design contract

Visual world: Atelier. Drawing board, structuring hairlines, Archivo for headings and interface
alike, room to breathe. Approved by the operator on 19/08 from the mock
`docs/directions/direction-atelier.html`, picked over two other directions
(`direction-flux.html`, `direction-fil.html`).

The world and the palette are two things. The world carries type, space and geometry; the palette
carries colour. Two themes, two deliberate palettes: `light` is Atelier (warm paper, vermilion, in
`tokens.css`) and `dark` is Nord (polar night, in `theme-dark.css`). A light Nord was tried on
20/08 and dropped: darkened enough to pass AA on a light sheet, its aurora hues lose their
identity.

This document is a contract, not a description. A session writing front-end code reads it first
and does not depart from it without discussing it.

---

## 1. Where things live

| File | Role |
|---|---|
| `web/src/ui/tokens.css` | Foundations. Every design value of the app. |
| `web/src/ui/base.css` | Base layer. Reset, native elements, browser surfaces. |
| `web/src/ui/<name>.tsx` + `<name>.css` | One component = one module + its co-located CSS. |
| `web/src/<domain>/<name>.tsx` | Domain components, in THEIR domain, built on `ui/`. |
| `web/src/**/<name>.stories.tsx` | The Storybook workshop: each component in each of its states, next to it. |

`theme.css` no longer exists. It had piled up 186 selectors and 11 ways to draw a list row. Do not
recreate it under any name.

No barrels. Import the module (`ui/list.js`), never an `index.ts` (see the `bundle-barrel-imports`
rule of the Vercel skill).

A file name says what the file is. A route screen is PascalCase and named after its component
(`TaskPage.tsx`, `GoalsPage.tsx`, `Board.tsx`); everything else (a `ui/` component, a domain
sub-component, a hook, a catalog, a pure module) is kebab-case (`task-card.tsx`, `use-rail.ts`,
`goal-status.ts`). About thirty PascalCase sub-components (`TaskSettings.tsx`, `RuleRow.tsx`…)
predate the rule: do not rename them in passing, but do not create new ones.

---

## 2. Foundations

### Colour

Surfaces: `--paper` (app ground, carries the grid) · `--sheet` (sheet laid on it) · `--sheet-hi`
(hover) · `--recess` / `--recess-2` (hollows: fields, inset blocks).

Ink: `--ink` (text) · `--ink-2` (secondary) · `--ink-3` (tertiary, placeholder; the AA floor, never
go lower).

Hairlines: a component never picks `--rule*` directly, it declares a ROLE.

| Token | For | Strength |
|---|---|---|
| `--border-surface` | object laid on the board (card, panel, inset block, hatching) | `--rule` |
| `--border-floating` | surface that COVERS (menu, popover, select list, toast, modal, drawer) | `--rule-2` |
| `--border-control` | button, field, closed select, checkbox | `--rule-2` |
| `--border-separator` | INTERNAL hairline (list row, table header, rule, rail edge) | `--rule` |
| `--border-strong` | hover / press on a control | `--rule-3` |

A floating surface is stronger than a laid one: it must detach from what it covers. Checked with
`getComputedStyle`: all laid surfaces share one value, all controls another, and floating surfaces
use the controls' value.

`--rule`, `--rule-2` and `--rule-3` remain the raw scale, reserved for non-hairline uses (scrollbar
thumb, disabled slider fill, breadcrumb chevron).

Rows: `--row-hover` (hovered row) and `--row-selected` (chosen row: select option, active rail
entry). They are dedicated tokens because their meaning flips with the theme: darken on a light
sheet, lighten on a dark one. Hard-coding `--recess` or `--accent-wash` dug a hole in an already
dark panel.

Semantic states, each a triplet `fg` / `-wash` / `-line`:

| Token | light (Atelier) | dark (Nord) | Meaning |
|---|---|---|---|
| `--accent` | vermilion | frost | interactive, primary, focus |
| `--run` | teal | frost teal | session running |
| `--wait` | amber | aurora yellow | waiting for you, paused |
| `--gate` | `var(--wait)` (+ hatching) | `var(--wait)` (+ hatching) | approval pending |
| `--ok` | olive | aurora green | finished successfully |
| `--bad` | brick red | aurora red | failure, refusal, danger |

Contrast computed in both themes: worst case 4.77:1 light, 4.58:1 dark. Raw Nord fails AA (`nord11`
is 2.46:1 on `nord1`): its aurora hues are lightened toward snow storm until they clear 4.5:1, at
constant hue. Every new colour is checked before it enters the foundations.

A theme changes ONLY colours, never the meaning of a tone. `--gate` used to be amber in light and
aurora purple in dark, so a gate switched semantic family with the theme and a queue mixing gates
and questions showed two hues. Family links between tones are written as `var()` (`--gate:
var(--wait)`) precisely so a theme cannot silently break them.

### Typography

One family carries the interface, headings included: `--sans` Archivo. Fraunces was removed on
08/09 (a serif and a grotesque that did not agree). Archivo beat the other grotesques tried: same
string at 13.5px, 347px wide against 382 for Raleway (+10.1%), so a card that took two lines in
Raleway fits one. `Heading` has no `voice` prop: there is one voice.

- `--sans` Archivo: the whole interface, headings included.
- `--mono` JetBrains Mono: ONLY paths, hashes, commands, payloads, measurements. Only `Code`,
  `CodeBlock`, `Kbd`, `Tag` and `Num` may use it. No `mono` prop on `Text` or `Heading`: mono as a
  "technical" costume on running text is an anti-pattern; a field label, a project name or a status
  sentence is not a measurement.

Fonts are self-hosted through `@fontsource-variable/*`: no external request, no FOUT, versioned in
the lockfile.

Scale: `--fs-3xs` (9.5px) → `--fs-4xl` (32px), with `--lh-*`, `--tr-*`, `--fw-*`. Prose is capped at
`--measure` (72ch).

### Vertical rhythm

`.ui-page` is a flex column with `gap`: one spacing (20px) between all stacked blocks of a page.
Pair-based margins (`card + card`, `panel + panel`…) always forget a case, and two unmargined blocks
read as one object cut by a hairline; a `gap` does not forget. Subheadings add 12px above (32 total)
to keep more air before a heading than after it.

### Space, shape, time

Space: `--sp-0` → `--sp-13` (4px scale, one set).

Dimensions: `--h-control-sm|md` (24/32px, one geometry for buttons, fields, selects and icon
buttons), `--h-head` (52px), `--sz-mark|avatar|choice`, `--w-switch` / `--h-switch` /
`--sz-switch-knob`, `--h-scroll-*`, `--w-rail`, `--w-aside`, `--w-toast`, `--w-command`. Every one
that holds text is `max(px, rem)`: the px is the floor (rule 16). A SPACE token is never a control
dimension: the checkbox used `--sp-8`, which stopped it from following the base font.

Icons: `--icon-control` (14) / `--icon-control-sm` (13) / `--icon-row` (15) / `--icon-head` (16).
The size comes from the slot, never the call site (rule 13).

A single-line control has a FIXED height, never a `min-height`. A floor is not a geometry: fields
announced 32px and measured 35 (padding and line height decided) while buttons measured exactly 32,
so no toolbar aligned. No `align-items` fixes that: in a centred row each child keeps its height.
Only `<textarea>` keeps a floor, it has to grow. Measured: buttons, fields, selects and icon buttons
all land on exactly 32 (`md`) or 24 (`sm`).

A BAND is not a control, so it takes a floor (13/09). The rule above targets what aligns INSIDE a
row; a band IS the row, and its content may legitimately change size from one column to the next.
`--h-head` is the head band shared by the shell's three columns: the icon rail, the rail head and
the bar. Each used to compute its height from its own gutters, and vertical centres landed at 22,
21 and 26px. The value comes from the most constrained of the three, the bar: an `md` control plus
two `--sp-5`.

The separating hairline belongs to the band and crosses all three columns. It is 1px and lives
INSIDE the box, so a column without it would offer one more pixel of content than its neighbours,
and its content would sit half a pixel lower.

`md` everywhere in the app (operator decision, 20/08): `sm` is only used in the workshop, which must
show both sizes. Some areas will move to `sm` when usage asks for it, never out of a density reflex.
Checked by script on 8 pages: every control height is 32.

And when `sm` comes back: one row of controls = one size. Geometry is not enough if a screen mixes
both; three `<Row>`s had `sm` buttons next to an `md` field and icon button (24 against 32).
`IconBtn` is the trap: without `size` it falls back to `md` while its neighbours are explicitly
`sm`.

Radii: `--r-1|2|3` (2/3/5px), `--r-pill`, `--r-round`. Drawing-board world: short radii.

Elevation: `--el-1`, `--el-2` (offset AND blur; a halo without offset is decoration), `--el-btn`,
`--el-inset`.

Focus: `--focus-ring` (outer ring, buttons and links ONLY) and `--field-ring` (INNER edge, every
field). A field never has an outer halo: it spilled onto neighbours and fought the hover. Every
field hover rule is written `:hover:not(:focus)`, otherwise it comes after focus in the cascade and
overwrites its border, leaving the halo orphaned.

Motion: `--dur-1` (state feedback), `--dur-2` (appearances), `--dur-pulse`, `--ease-out`.

Layers: `--z-sticky` < `--z-drawer` < `--z-modal` < `--z-popover` < `--z-cmdp` < `--z-tooltip` <
`--z-toast`. Never a hard-coded z-index.

### Width

Wide screen first. The base CSS IS the wide layout; a media query only subtracts. So `max-width`
only, never `min-width`: a `min-width` anywhere would mean the base layout is the phone's, and the
two models cannot coexist without losing track of which rule wins.

Three breakpoints, and the scale is closed.

| Breakpoint | Value | What happens |
|---|---|---|
| `wide` | ≤ 1180px | densities tighten, side panels give way |
| `medium` | ≤ 900px | two columns become one, the rail becomes a strip |
| `compact` | ≤ 640px | phone |

On 13/09 ten distinct values lived across twenty-eight media queries, each screen having picked its
own, so neighbouring surfaces switched twenty pixels apart without meaning to.

What `compact` guarantees, and what it does not. The bound comes from
`docs/wiki/produit/pour-qui.md`: the main use is on a wide screen, mobile is for triage (see what is
waiting, answer a question, approve).

- Triage surfaces (board, inbox, question, form, task page and its gate) are DESIGNED for `compact`.
  They read and work at 375px, one hand.
- Everything else only has to NOT BREAK: nothing off screen, no unreachable control, no horizontal
  scroll of the document. Not designed, just held.

That is the difference between "make the app responsive" (expensive, never finished) and "the app
works on a phone for what a phone is for" (bounded, finishable).

### The finger

A phone is not a narrow screen, it is another device. Width is handled by media queries; what
follows does not derive from it, and each line cost a real defect on 13 and 14 September. They
apply to everything that reaches `compact`, including what is not designed for it.

| Rule | The defect it prevents |
|---|---|
| Target at least 44px tall | The `sm` size is calibrated for a cursor. A thumb misses. |
| 16px on `input`, `textarea`, `select` | Below that, WebKit ZOOMS the page on focus and never zooms back: it stays enlarged and shifts, everything looks cut. No measurement reproduces it; the document does not overflow, the viewport shrank. |
| `100dvh`, never `100vh` alone | `100vh` is the screen WITHOUT the browser bars, which Safari lays on top. The last row falls under them and the document scrolls to reach it. |
| `env(safe-area-inset-*)` wherever `viewport-fit=cover` applies | Without it the notch eats the title and the home indicator eats the last target. |
| No hover-only affordance | iOS synthesises `mouseenter` on tap and never sends `mouseleave`: whatever opens on hover never closes. Tooltips only open on `pointerType === "mouse"`. |
| `touch-action: none` only where a gesture is really captured | Set on a kanban card, it takes scrolling away from the finger: the board could only be scrolled by aiming at the eight pixels between two cards. |
| A touch drag is armed by a delay, not a distance | Six pixels of movement are the start of a scroll. `MouseSensor` (distance) and `TouchSensor` (press and hold) are two sensors, not one. |
| An exit on every screen | An installed app has no address bar: no back, no reload. A screen without navigation is a dead end you leave only by closing the app, which reopens in the same place. |
| What is chosen is remembered | A board lane, a tab: the ordinary path goes through another page and back. Resetting to the default on every mount cancels the choice. |
| No persistent surface covers the tab bar | A toast, a banner, a floating button that stays on screen untouched sits above it, never over it: the bar is in the flow, the surface is `fixed`, and nothing makes them see each other without a shared computation. A transient surface (menu, modal, popover) may cover it for the length of the gesture. |

Measurement does not catch them all. `make responsive` holds three facts (no horizontal scroll,
content above 60% of the height, no control out of reach without a scrolling ancestor) on five
addresses, in a browser without bars, notch or finger. Focus zoom, the notch, sticky hover and the
stolen gesture are invisible to it. They show on a device, which is why this table exists: what a
gate cannot hold must at least be written.

Where a media query lives, the same arbitration rule as for components, applied to width:

- the shell (`ui/shell.css`) owns the breakpoint switch: where the rail, the bar and the content
  go. One place, every route.
- a `ui/` primitive owns its own narrow behaviour (a card, a form, a timeline).
- a domain screen adds a media query only if ITS composition requires it, never to repair what the
  shell should carry. If the fix looks like "I am reclaiming height", it is in the wrong place.

### World signature

`--grid-*`: the drawing-board grid on `--paper` (minor 16px, major 96px, very low opacity; it
structures without showing).

`--hatch-*` + `--<tone>-hatch`: the diagonal hatching that marks what needs a decision (gate) or what
was refused (`fs_denied`, `run_error`). It always goes through the `Hatch` component or `Timeline
emphasis=…`, never copied.

---

## 3. Non-negotiable rules

1. No inline `style={{}}`. Lint error (`react/forbid-dom-props`). Exceptions, commented with
   `// oxlint-disable-next-line react/forbid-dom-props -- <reason>`: computed width of a gauge,
   computed position of a floating surface. `ui/flex.tsx`, `ui/card.tsx` and `ui/modal.tsx` are
   exempted by `.oxlintrc.json`: encapsulating style IS their job.
2. No hard-coded values (colour, font size, radius, duration, z-index), in TSX or CSS. A missing
   token is added to `tokens.css` with a semantic name.
3. All hooks before the first `return` (`react/rules-of-hooks`). A hook after an early return
   crashes the app in production and TypeScript says nothing.
4. One file = one role, small. A module is 15 to 90 lines. Beyond that, it is two modules.
5. A pattern repeated 3 times becomes a component. The longest-violated rule: 11 implementations of
   a list row before `List`/`ListItem`.
6. Composition over booleans: explicit variants (`variant="primary" | "quiet"`), slots (`leading`,
   `actions`, `meta`), compound components with provider + `use()` when state is shared (`Tabs`,
   `TaskComposer`).
7. Real accessibility: correct ARIA roles, keyboard navigation (arrows on `Tabs` and `Menu`, Escape
   on floating surfaces, focus trap in `Modal`/`Drawer`), targets ≥ 24px, a single focus ring (the
   one in `base.css`).
8. Drawn icons (`lucide-react`, size 13-16, one style). No emoji or unicode glyph used as an icon.
9bis. Nothing hidden escapes its parent. Screen-reader-only content goes through `.ui-sr`
   (`base.css`), which stays in the flow. The `position: absolute` recipe with no positioned
   ancestor takes `<html>` as its containing block and inflates the DOCUMENT's scroll height: the
   workshop measured 20,716px for a 900px shell, and the whole app scrolled behind it.
9ter. A state mark is never hidden by painting it the background colour. Hide it with
   `opacity`/`transparent`. A check painted sheet colour reappeared on hover (lighter sheet) and
   turned into a black check in the dark theme.
9octies. A subtitle never competes with its title. `CardHeader`'s `sub` slot: smaller, italic,
   tertiary ink. "Fewer pixels" is not enough: a `<Text size="sm">` inlined in the title read as
   just as important.
9sexies. Do not switch off a platform default without a reason. `Grid` forced `align-items:
   start`, cancelling the stretch grid and flex do natively: the board's four lanes ended at four
   heights depending on their empty state. A DS component keeps the CSS default and lets the caller
   opt out explicitly, never the reverse.
9septies. One kind of object is rendered by one mechanism. Gates were standalone blocks and
   questions were rows of a panel: two mechanisms for one "waiting for you" queue, so a visual
   grouping nothing justified. One queue = one surface; what sets an item apart is its mark
   (hatching), not its container.
9quinquies. A chosen row carries the same mark everywhere: `--row-selected` wash, hairline, and a
   vertical marker on the left edge. Never a dark fill: on a dark ground it digs in instead of
   standing out. The rail and select options share this treatment.
9quater. A hover state is scoped to the state it must not overwrite. `:hover:not(:focus)` for a
   field, `:hover ... :not(:checked)` for a checkbox. A hover selector is often more specific than
   the selected one: it then wins whatever the rule order, and repaints what the state just painted.
10. No `localStorage`/`sessionStorage` for application data; it goes to the database, through the
   API. Accepted exceptions, all purely local display preferences: `ui/theme.tsx`
   (`legion.theme`, or the theme resets on every reload), the Linear Issues screen filters
   (`integrations/issue-filters.ts`, key `legion.issuesFilters.<projectId>`, a selection of ids
   loaded elsewhere, not a source of truth), rail collapse (`ui/use-rail.ts`, key
   `legion.rail.collapsed`, how you look rather than where you are, so not in the URL) and the last
   visited project (`projects/project.tsx`, key `legion.lastProjectId`, a default offered to the
   global composer, never a source of truth: the current project comes from the URL). Every access
   is wrapped in a `try`: Safari private browsing throws on `localStorage`, and a lost preference
   beats a blank page.
11. No native control whose open state escapes CSS. A native `<select>` has its list drawn by the
   OS: `ui/select.tsx` is a WAI-ARIA listbox. Same for checkboxes and radios, drawn in
   `ui/choice.tsx`. The native element stays in the DOM when it carries accessibility (checkboxes,
   radios), never when it imposes rendering.
13. An icon size is imposed by the SLOT, never chosen at the call site. The survey found 11, 12, 13,
   14, 15 and 16px depending on the screen, so two neighbouring rows did not share a column. Three
   roles, three tokens: `--icon-control` (button, field), `--icon-row` (registry row head),
   `--icon-head` (card or panel header). The slot CSS beats lucide's attributes; selectors are
   direct-child so they do not touch the icons of action buttons in the same header.
14. A flex child does not live in its parent's padding. The inline gate's vertical padding sat on
   the `<Hatch>` root: the hatched strip, a flex child, floated 12px from the hairlines instead of
   marking the edge, and the row was 84px against 62 for its siblings. Padding goes on the BODY.
15. A row is a row, whatever it holds. Same height, same icon column, same title line, same hover
   (`--row-hover`) as its siblings. What sets an item apart is its mark, not its geometry.
16. Every box that holds text is `max(px, rem)`. The type scale is in `rem`: at a 20-24px root (a
   common low-vision setting), a box frozen in px clips its glyph. The `px` in `max()` is the floor,
   not the value.
16bis. A media query takes a step of the scale, and subtracts. The three values are in § 2 "Width".
   `breakpointsOffScale` holds it (AST metrics, `scripts/arch-metrics-baseline.json`): a fourth
   value fails, a `min-width` fails, and a paid-off debt whose line is not removed fails too. Rule 2
   already forbids hard-coded values; this one exists because a media query is the ONLY place a CSS
   token cannot go (`@media (max-width: var(--bp))` is not valid CSS), so nothing else could stop an
   eleventh value from appearing.
17. Before shipping: `pnpm lint`, `pnpm --filter @legion/web build` and `pnpm test` green. The last
   one RESOLVES every story and checks it renders (`web/src/stories.test.tsx`). Compiling is not
   rendering: on 25/08 the other gates were green while the stories showed an empty canvas.
18. A control that calls the server shows its wait. `Button`, `IconBtn` and `ConfirmAction` spin on
   their own as soon as their handler RETURNS its promise instead of `void`-ing it (`ui/busy.ts`,
   450ms floor): return the promise, never invent local state. `discardedButtonPromises` (AST
   metrics) fails on the first handler that drops it
   (`server/src/architecture/button-loading.test.ts`).

## 3 bis. What the contract does NOT guarantee (audit of 20/08)

An impeccable audit (a11y + responsive + theming) measured the whole app. What was fixed is in the
rules above; what stays open is written here so nobody rediscovers it.

- Touch targets. Partly closed on 14/09: under `max-width: 640px` the floor is 44px (`--h-touch`,
  `--icon-touch: 17px`, `--sz-mark-touch`); the bar's project switcher, the collapsed tools panel
  and every open menu row follow it. Above the compact breakpoint nothing changes: control heights
  stay 32/24px, calibrated for a cursor. Remaining debt, named rather than promised:
  · the panel's six icons still have no visible label for a finger (`Tooltip` only opens on
  `pointerType === "mouse"`, `aria-label` is not visible);
  · `.ui-menu` has no `max-height` or scroll: with 44px rows a long menu reaches lower than before;
  no product menu is known to hit it;
  · the font size of the initials in the 28px project square (`--sz-mark-touch`) was set by eye,
  not measured.
- Helper text (closed 15/09). Helper text states a constraint, never the obvious. Under a field, a
  button or a heading, a sentence is justified only if it carries a format, a default, a unit, or a
  consequence its neighbour does not state. If it repeats the label, the placeholder, the heading,
  or a count already shown, it does not render. Nor does it render to say the action happens
  elsewhere when that elsewhere is on screen. Triage carries teaching, settings carry constraints.
  No automatic gate: no machine knows a sentence repeats its neighbour, and counting characters
  would punish useful hints. `ui/empty.tsx` holds the same contract for its cause sentence: it
  renders only if it names a cause the title does not already carry (a filter, a condition, an
  outage).

### Closed on 20/08 (measured after the fix)

- Heading levels → `ui/heading-level`. A heading's tag comes from its DEPTH, not a hard-coded `h3`.
  `Page` opens at level 2, `Section` goes down one, `CardHeader` / `PanelHeader` / `SectionTitle` /
  `PermissionGroup` read the context, `DialogBody` restarts at 3. The `level` prop is the escape
  hatch. Measured: 12 routes, one `h1` each, no skipped level. The VISUAL level stays independent
  of the tag (the class carries the size).
- Required fields → `ui/field-aria`. The 15 functionally mandatory fields carry `required`
  ("required" badge + `aria-required`). It flows through CONTEXT, not `cloneElement`: an
  interposed domain component (`<Field><TaskComposer.Name/></Field>`) silently swallowed the
  attributes, and 2 of the task composer's 4 fields were marked to the eye and silent to the ear.
  Corollary: inside a `<Field>`, only library controls, never a native `<input>`.
- Enlarged text → `max(px, rem)`. Every box holding text follows the browser's base font; the `px`
  is the floor (geometry does not shrink below 16). Measured at 16 / 20 / 24px root on 9 routes: no
  clipped glyph, no overflow.
- Autocomplete. `Input` / `Textarea` / `SearchInput` set `autocomplete="off"` by default: Chrome
  offered an address card above the ⌘K palette. No field of this control plane has a use for the
  browser's saved data.

## 3 ter. Themes

A theme is the colour block and nothing else: type, space, radii, motion and geometry stay
Atelier's. A theme lives in a single `ui/theme-<name>.css` under `[data-theme="<name>"]`, and
redefines only colour, shadow, grid, hatching, selection and chevron tokens. If it needs to
redefine anything else, the component had a hard-coded value: fix the component, not the theme.

Existing themes: light (default, Atelier palette) and dark (Nord palette). A theme does not have to
be a variant of the other: what must stay shared is the world, not the hue. The world is still
called Atelier and carries type, space and geometry for both themes. `ThemeProvider` sets the
attribute on `<html>`: floating surfaces live in portals outside the React tree and must inherit
too. The switch is a day/night toggle in the rail (`ThemeToggle`, in `router.tsx`).

A reference palette is never taken as is. Raw Nord fails AA on its states (`nord11` at 2.46:1,
`nord15` at 3.55:1): hues were raised until they cleared 4.5:1. On a dark ground a wash DARKENS
(tint laid on the recess) instead of lightening, or the chip text becomes unreadable. Every new
theme goes through the same contrast computation before it ships.

## 4. Banned anti-patterns (craft floor)

Grid of identical icon+title+text cards as page structure · nested cards · big-number-small-label
as a hero template (`Stat` is `inline` by default for that reason) · kicker/eyebrow above a heading ·
decorative section numbering · gradient text · decorative glass/blur · coloured `border-left` wider
than 1px · hard shadow without blur · sparkline or progress ring instead of content · modal for an
action that needs neither interruption nor protected focus (use `ConfirmAction`) · mono as costume ·
grey "Loading…" instead of a `Skeleton` · empty state that is just a centred sentence (use `Empty`).

## 5. Copy

A control names its action ("Approve and merge", not "OK"). An error names the problem AND the way
out (`ErrorState` requires both). An empty state says what to do ("connect Linear from Settings ›
Integrations"). English for the interface, comments, code and identifiers.

The vocabulary below is fixed. Two translations of the same word on two screens is the defect that
costs longest: it does not show when reading one file, only in use, and it makes the user doubt
what they understood. A missing word is added here first, not negotiated file by file.

### Product objects

| Term | Never |
|---|---|
| task | job, ticket, issue |
| agent | bot, worker, assistant |
| session | run (a run is something else) |
| container | sandbox, box |
| runner | host, node, machine (a machine carries a runner) |
| repository in a sentence, repo in a label | project |
| brief | description, prompt |
| trace | log, history, timeline |
| artifact | deliverable, output, file |
| attachment | file, upload |
| inbox | notifications, messages |
| question | prompt, ask |
| round | form, questionnaire |
| draft | |
| channel | thread, conversation |
| interview | discussion, chat |
| chain | pipeline, workflow, template |
| step | stage, phase |
| goal | objective, epic |
| approval gate | checkpoint, review step |
| grant (given to an agent) | permission, scope, right |
| secret | credential (a credential is an account) |
| Claude credential | account, key, token |
| connection (to a provider) | integration (Integrations is the TAB) |
| provider | vendor, service |
| token | key |
| crate | vault, export, bundle |
| scheduled | cron, recurring |
| review | QA, approval |
| PR, also on its own (one word per thing beats nuance) | "pull request" spelled out for the same thing |
| queue | backlog |
| operator | user, admin |
| concierge | assistant, helper |

### States

later · todo · doing · review · done · waiting for you · failed · queued · blocked by · connected /
not connected yet · exhausted (an account).

### Gestures

Run · Run again · Save for later · Discuss · Save · Send · Answer · Resume · Connect · Disconnect ·
Add · Remove · Approve · Stop · Attach · Retry.

### Added during translation (16/09)

Words the translation had to choose, adopted as is: rewriting them costs more than it gains.

| Term | Use |
|---|---|
| batch | unit of approval in the Breakdown step |
| slice | |
| Breakdown step | |
| lineage | |
| propose | filing a task (`propose_task`), distinct from `file` |
| file (verb) | filing work (channel, interview) |
| drop | dropping an artifact; three distinct verbs |
| log | the orchestrator's log: its decisions, not a session's run (that is `trace`) |
| situation report | |
| guardrail | |
| on hold | a channel's paused state |
| Artifacts | a channel's state column ("deliverable" is banned, so the title changes) |
| ended | destroyed session |
| Completed | derived "finished" state; deliberately NOT "Done", the chip can contradict the Done column and the same word would erase the one thing it says |
| pending | unknown merge state |
| forge | |

Two accepted divergences: `ChannelState` is literally `running` and the goals filter is `live`.
Using `doing`, the board column word, would put a section title on a state that is not that one. A
second word beats a misreading.

### Tone

Short, declarative, no filler. Literal translation always lengthens.

- Cut the sentence that explains what the screen already shows, the justification of an obvious
  setting, politeness. "What your connected tokens can reach", nothing more.
- Keep what a user cannot guess. A repository missing from a list is not a repository that does not
  exist: that sentence stays, it prevents a wrong conclusion.
- Sentence case for button labels and headings ("Save for later"), never Title Case. Section labels
  in capitals stay in capitals.
- No contraction in an error message ("cannot", not "can't"): an error is read fast and badly, and
  the full form cannot be mistaken for anything.

### Dates, numbers, units

The display locale is `en-GB`, in one place: `web/src/ui/locale.ts`. The choice is about the clock:
twelve screens show a 24-hour clock, which `en-US` would have switched to AM/PM. Dates use `month:
"short"` everywhere except `infra/LogsPage.tsx`.

Agreement with a count goes through `plural(count, one, many?)` in `web/src/ui/plural.ts`, never a
recopied `n > 1` test (wrong at zero).

| What is shown | Form |
|---|---|
| byte size (`ui/bytes.ts`) | `B` / `kB` / `MB` |
| duration beyond a day (`ui/duration.ts`) | `3 d`; `min`, `h`, `s` as usual |
| thousands (`ui/num.tsx`) | `3,821.5` |
| `<html lang>` | `en` |

### Where a sentence lives

No interface sentence is written in a component. It lives in its domain's CATALOG, and the
component reads it by path.

| File | Content |
|---|---|
| `web/src/i18n/catalog.ts` | The infrastructure: `defineText`, a typed identity function. That is all. |
| `web/src/<domain>/text.ts` | The domain catalog (`export const <DOMAIN>_TEXT`). |
| `web/src/<domain>/text/<screen>.ts` | The split when a domain exceeds ~120 lines. No barrel. |
| `web/src/ui/vocabulary.ts` | The vocabulary of MECHANICS (close, cancel, next page). It names no domain object. It is not called `text.ts`: `ui/text.tsx` is typography, and a `text.ts` beside it would steal its imports. |

- The key is the access path (`BOARD_TEXT.columns.later.empty`). No `t("key")`: a missing key is a
  compile error, not a runtime surprise, and the bundle pays no lookup. English is the only
  language; there is no locale detection.
- A value in a sentence goes through a function, never concatenation at the call site: `step: (n:
  number) => \`step ${n}\``. Otherwise word order becomes impossible to change.
- A sentence split by an inline element stays split (`before` / `after`). Joining it into one
  string would drop the `<Code>` or `<b>` it holds: a rendering change disguised as a refactor, and
  the easiest mistake to make here.
- A label table stays a table, in the catalog, with `satisfies Record<Union, string>`: that
  guarantees a new status cannot arrive without its word.
- What is NOT copy does not move: API keys, status values, class names, route ids, code quoted on
  screen (`GITHUB_TOKEN`, `allAgents: true`).
- The safety net: `node web/scripts/text-audit.mjs <ref>` compares the set of visible sentences
  before/after. An extraction must change NOTHING on screen: both lists must be empty.

#### Why not `react-i18next` (review question, 24/08)

Because Legion has one language, and a translation engine only starts paying at the second.
Measured: `i18next@26.4.0` + `react-i18next@17.0.12`, bundled and minified (React external), weigh
68.4 kB / 23.3 kB gzip, +9% on the 255 kB gzip bundle. The in-house infrastructure is 27 lines
(`i18n/catalog.ts`), zero dependencies, compiled to object literals: no lookup at render.

The real argument is key checking, not weight. Here the key IS the access path: a missing or
renamed key breaks `typecheck`. With `t("board.columns.later.empty")` it only breaks on screen, and
i18next's degraded mode is to display the key, exactly the defect we do not want on a tool looked at
every day.

What the in-house infrastructure does NOT have, and we accept: ICU plural/gender rules (`ui/plural.ts`
covers English), lazy loading of a catalog per locale, export tooling for a translator. Date and
number formatting already goes through native `Intl`.

What would flip the decision: a second locale shipped. Then we take `react-i18next`, and the costly
part is done: each domain catalog becomes a namespace, each path a key, `defineText` the adapter.
Until that day, the dependency is not added.

---

## 6. Inventory

`ui/` library, 63 modules.

Layout and structure: `Row` `Stack` `Grid` `Spacer` · `Divider` · `Page` `PageHeader` `Section`
`SectionTitle` · `Card` `CardHeader` `CardBody` `CardDescription` · `Panel` `PanelHeader`
`PanelRow` `PanelNote` · `Inset` · `Toolbar` · `SplitPane` · `ScrollArea` · `AppShell` `TopBar`
`ShellBody` `Rail` `MainArea` `Logo` `Avatar` · `CommandTrigger`

Renderless mechanisms: `HeadingScope` `AutoHeading` `useHeadingLevel` (`heading-level.tsx`, a
heading's tag comes from its depth) · `FieldAriaProvider` `useFieldAria` (`field-aria.tsx`, the
link between a `Field` and its control, through interposed components). They have no states to
show; they are described in § 3 bis.

Typography: `Heading` · `Text` `Caption` `Label` · `Prose` · `Link` · `Code` `CodeBlock` · `Kbd` ·
`Ellipsis` · `Num` · `Markish`

Controls: `Button` `IconBtn` `ButtonGroup` `ToggleButton` · `Input` `SearchInput` `Textarea` ·
`Select` (drawn listbox) · `Checkbox` `Radio` `RadioMark` `RadioGroup` `Switch` · `OptionCards` (an
exclusive choice as cards: label, reason, chip) · `Field` `Fieldset` `FormRow` `FormError` `FormOk` ·
`Dropzone` `FileChip`

Data: `List` `ListItem` `ListRow` · `Table` `Thead` `Tbody` `Tr` `Th` `Td` · `Chip` `StatusChip`
`Tag` `Badge` · `Meter` `ProgressBar` · `Sparkline` · `Stat` `StatGroup` · `KeyValue`
`KeyValueList` · `Timeline` `TimelineItem` · `PermissionList` `PermissionGroup` `Permission` ·
`Graph`

Feedback and states: `Banner` · `ToastProvider` `useToast` · `Empty` · `Skeleton` `SkeletonText` ·
`Spinner` · `Tooltip` · `Hatch` · `ErrorState` · `ConfirmAction`

Navigation and surfaces: `Tabs` `TabList` `Tab` `TabPanel` · `NavItem` `NavGroup` `NavLabel` ·
`Menu` `MenuItem` `MenuSeparator` · `Modal` `ModalHeader` `ModalBody` `ModalFooter` · `Drawer` ·
`Popover` · `Breadcrumb` · `Pagination` · `StepRail` `StepRailItem` `StepRailDivider` (the rail of a
multi-screen flow: step, answer under the step, progress)

Domain components, in their domain (`tasks/task-card.tsx`, `inbox/inbox-card.tsx`,
`review/diff-file.tsx`…): `TaskCard` · `InboxCard` `InboxCardRow` (ONE card, four frames: a
channel's last round, a task's head, inbox rows, the waiting panel; `InboxCardRow` is the same at
list density) · `InboxRounds` (an interview's rounds, as chips) · `InboxQuestionRead` (an answered
round, frozen) · `InboxItem` (the collapsible form from before 07/09, still rendered by the board's
inbox registry) · `DodChecklist` · `Guardrails` · `CostValue` · `ModelChip` · `RepoChip` · `PrLink` ·
`ArtifactChip` `ArtifactPreview`

The question page added no `ui/` primitive: its card, rounds bar and round reading compose existing
`StatusChip`, `ProgressBar`, `Breadcrumb`, `Disclosure` and `StepRail`. They live in `inbox/` because
they know the domain (a round, a draft, a waiting reason).

---

## 7. The workshop is the documentation

Every component has its `<name>.stories.tsx` next to it, showing it in each of its real states with
domain content (agents `senior-dev`/`spec`, Stripe/PDF tasks, costs in $, `legion/…` branches). It
is where a visual regression is checked, and the best API documentation available, better than this
file.

Add a component, add its stories file. No exception.

The workshop runs on Storybook (`make ds`, or `make dev`, which mounts it on :6006 next to the
server and the UI).

- It does not ship to production. It is a separate application; the old `/ds` page travelled in the
  main bundle (122 kB, 13% of the shipped weight).
- Each state is ISOLATED. A story owns its state; opening a modal in one specimen does not change
  another's tab.
- Co-location makes the rule enforceable. A module without its stories file shows in the folder.
- `web/src/stories.test.tsx` is the gate, run by `pnpm test`. It renders every story and checks it
  produces more than the preview decorators; `make ds-build` only compiles, and the difference is not
  theoretical: on migration day `tsc`, the linter and the build were green while the workshop showed
  nothing. Co-location is held by the `storiesMissing` metric: declared modules are debt, and
  removing a line is how it is paid.
- A story that renders NOTHING must say so: `tags: ["renders-nothing"]`. An empty panel is a
  legitimate state, but no machine tells "empty on purpose" from "empty by accident"; the tag also
  fails the other way, when the story ends up rendering something.

Two forms to know. A story's label is its `name` field: accents and punctuation are allowed, it is
displayed text, not an identifier. A stateful story is written `render: function Render() { … }`:
an anonymous arrow is not a component to `react-hooks`.
