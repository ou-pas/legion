# Diagrams

Interactive diagrams of Legion, made with the `archify` skill (tt-a1i/archify, MIT). Each `.html`
stands on its own: light or dark theme, zoom, search, guided views, PNG, SVG or WebM export. The
`.json` next to it is the source.

| File | Type | What it shows | Checked against the code |
| --- | --- | --- | --- |
| `architecture.html` + `.svg` | architecture | control plane, TLS front, runner, egress proxy, the three trust doors, Web Push and Discord | 16/09 |
| `session-lifecycle.html` | lifecycle | session statuses, the pause that destroys the container, failure | 16/09 |
| `task-workflow.html` | workflow | from brief to done: queue, session, inbox, review, what follows | 16/09 |
| `phone-path.html` + `.svg` | sequence | the phone path: an agent's question reaches the phone through Web Push, and the answer resumes the session in a new container | 16/09 |

They are meant for the README and the site.

## Regenerating

Validate after every change to a source, then deliver. Only a delivery that passes all nine checks
with zero errors and zero warnings counts:

```bash
node ~/.agents/skills/archify/bin/archify.mjs validate <type> docs/diagrams/<name>.json --quality showcase --json
node ~/.agents/skills/archify/bin/archify.mjs deliver <type> docs/diagrams/<name>.json docs/diagrams/<name>.html --quality showcase --json
```

`architecture.svg` and `phone-path.svg` go into the README, because GitHub does not run HTML. The archify CLI has no
SVG export: it lives in the viewer's Export menu, which builds a dual-theme SVG in the browser. The
SVG was produced from the delivered HTML by driving that menu with Playwright (served over
`http://`, since `file://` is blocked), right after `deliver`. An export is a copy: when
`architecture.json` changes, regenerate the SVG in the same commit as the HTML.

## The app map

`carte-mentale.html` is not a diagram but the full tree of the application, collapsible, with the
sections and gestures of each page, and a search. It regenerates with
`node docs/diagrams/carte-mentale.mjs`; work pages live in `carte-mentale-travail.mjs`,
configuration pages in the main file.

Its menus, rails and addresses were re-read in `web/src/router.tsx` and
`web/src/projects/rail-sections.ts` on 16/09, and its labels follow `web/src/*/text.ts`. The
content listed under each page is still a 09/09 survey of the screens, translated: it was not
re-audited item by item, and a screen that changed since may list a gesture it no longer has.

When the product changes, the JSON source changes with it.
