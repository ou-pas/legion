# PRODUCT.md, Legion

> This file is the DESIGN BRIEF: surface, audience, tone, references. It is what the `impeccable`
> skill reads before touching the interface, and that is its only role.
>
> Product documentation lives in the wiki, as linked pages: `docs/wiki/produit/`. It says what
> Legion is today, for whom, its principles, its settled decisions and where it stands. The "What"
> section below keeps only what does not go stale; the detail lives in the wiki.

## What

A personal Legion: a control plane and an interface on top of the Claude Agent SDK. The operator
assigns tasks, chains and goals to scoped agents running in ephemeral Docker containers. They follow
sessions live, read diffs before any pull request, and are interrupted only when a decision is
theirs to make.

Current detail: `docs/wiki/produit/ce-qu-est-legion.md`.

## Surface

Product (app UI / dashboard / tool), not brand. No marketing, no landing page: a cockpit used daily.

## Audience

One user: the operator, a developer, sole operator of the system. Power user: information density and
triage speed come before teaching. Mainly desktop; mobile is for triage only (inbox, approvals,
statuses).

## Jobs to be done

1. See at a glance what needs me (gates, questions, failures) and handle it in one click.
2. Follow agent sessions in real time (tool calls, cost, diff, artifacts) without reading raw logs.
3. Start a task from anywhere and move on; the queue takes over when there is no room left.
4. Review a diff line by line and send the review back to the agent before a pull request exists.
5. Supervise long-running goals: DoD, budget/duration/blocking guardrails, orchestrator decisions.
6. Configure agents and their grants with full readability of what is granted and refused.

Detail and reasons: `docs/wiki/produit/pour-qui.md`.

## Voice and tone

Sober, technical, factual. English for the UI, vocabulary fixed in `docs/DESIGN.md` § 5. No
decorative emoji, no exclamation marks. System states speak in precise terms ("waiting-inbox · 8
min", not "The agent is thinking… ✨").

## Anti-references

Generic SaaS dashboards (purple gradients, cards inside cards, icons in rounded tiles above every
heading). Anything that looks like a default Bootstrap/Tailwind UI admin template.

## References

Linear (chassis, chips, speed), Vibe Kanban (board + session), GitHub agents panel (triage),
terminal-like monospace technical areas (tool call timeline, diff, HUD).
