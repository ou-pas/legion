/// <reference types="vite/client" />
// The stories gate: it proves a story RENDERS.
//
// It replaces `make ds-smoke` (09/09), which did the same in a real Chrome and took SIX MINUTES over 894
// stories (`storybook dev` compiled each on demand, and the script slept a hardcoded 400 ms per
// navigation). Measured here: 1.5 s for the same stories, in the test runner already on jsdom.
//
// What the browser did not buy: the old script only asserted a DOM node count and reported console
// errors without failing; never layout, colour or paint. jsdom gives exactly those facts. What stays out
// of reach of both is what must be checked by eye, in `make ds`.
//
// The two defects it catches, both seen in this repo:
//  · the empty canvas: a provider that never resolves, a derived value read before its hook, while
//    `tsc`, oxlint and the build were green.
//  · the file Storybook does not index: `schedules.stories.tsx` exported bare components without
//    `export default meta`, and the workshop was dead for everyone for a month.
//
// A component WITHOUT stories is not its business: `storiesMissing` in the AST metrics
// (`scripts/arch-metrics-baseline.json`, 05/09) already holds that list. Two harnesses for one fact
// would give two numbers.
import { expect, it } from "vitest";
import type { ComponentType } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { composeStories, composeStory, setProjectAnnotations } from "@storybook/react-vite";
import * as preview from "../.storybook/preview.js";

// The workshop's global decorators (router, theme, toasts, styles): without them half the stories would
// render something other than what the workshop shows.
setProjectAnnotations([preview.default]);

/** A stories module as Vite's glob returns it. `tags` are read on the RAW export, not the composed
 *  story: that is where the author writes them, and it avoids betting on what `composeStories` copies. */
type RawStory = { tags?: readonly string[] };
type StoryModule = { default?: { title?: string } };

/** A composed story is a component without required props (`composeStories` bound the `args`). The
 *  library's return type depends on the module, which comes from a glob, so `unknown`: this names the
 *  only shape this file uses. */
type ComposedStories = Record<string, ComponentType>;

const compose = (mod: StoryModule): ComposedStories =>
  composeStories(mod as never) as unknown as ComposedStories;

/** The raw export's `tags`, if any. */
const tagsOf = (mod: StoryModule, name: string): readonly string[] =>
  (mod as Record<string, RawStory | undefined>)[name]?.tags ?? [];

/** The tag allowing an empty render. A component can legitimately render nothing (a criteria panel
 *  without criteria, an unknown mode better kept silent), and those states DESERVE a story. The gate
 *  cannot tell "empty on purpose" from "empty by accident": the author declares it NEXT TO the story.
 *  It fails both ways: a tagged story that renders something fails too. */
const RENDERS_NOTHING = "renders-nothing";

const storyModules = import.meta.glob<StoryModule>("./**/*.stories.tsx", { eager: true });

const withoutPrefix = (p: string) => p.replace(/^\.\//, "");

/** The floor: what the preview decorators render BY THEMSELVES (toast region, router and theme
 *  wrappers). Without it a story rendering `null` still produces nodes, and an empty canvas cannot be
 *  told from a rendered story. Measured rather than hardcoded: one more decorator and a constant would
 *  lie. */
async function decoratorFloor(): Promise<number> {
  const Empty = composeStory({ render: () => <></> }, { title: "plancher" } as never);
  let container!: HTMLElement;
  await act(async () => {
    container = render(<Empty />).container;
  });
  const n = container.querySelectorAll("*").length;
  cleanup();
  return n;
}

it("every stories file has an `export default meta` Storybook can index", () => {
  const orphans = Object.entries(storyModules)
    .filter(([, mod]) => !mod.default?.title)
    .map(([path]) => withoutPrefix(path));
  expect(
    orphans,
    [
      "These files have no default `meta` export: Storybook does not index them, none of their",
      "stories opens, and a single one is enough to stop the WHOLE workshop from starting.",
      "CSF3 format: `const meta = { title } satisfies Meta; export default meta;`",
    ].join("\n"),
  ).toEqual([]);
});

it("every story renders something", async () => {
  const floor = await decoratorFloor();
  const empty: string[] = [];
  const threw: string[] = [];
  const staleTag: string[] = [];
  let rendered = 0;

  for (const [path, mod] of Object.entries(storyModules)) {
    if (!mod.default?.title) continue; // already reported by the test above.
    for (const [name, Story] of Object.entries(compose(mod))) {
      rendered += 1;
      try {
        let container!: HTMLElement;
        // The flush is half the check, not a precaution: without it the preview `RouterProvider`
        // has not resolved and all stories render empty, the very defect this test exists to catch.
        await act(async () => {
          container = render(<Story />).container;
        });
        const nodes = container.querySelectorAll("*").length;
        const allowed = tagsOf(mod, name).includes(RENDERS_NOTHING);
        if (nodes <= floor && !allowed)
          empty.push(`${withoutPrefix(path)} → ${name} (${nodes} nodes, floor ${floor})`);
        if (nodes > floor && allowed) staleTag.push(`${withoutPrefix(path)} → ${name}`);
      } catch (err) {
        const why = String((err as Error).message).split("\n")[0] ?? "";
        threw.push(`${withoutPrefix(path)} → ${name} : ${why.slice(0, 160)}`);
      }
      cleanup();
    }
  }

  expect(rendered).toBeGreaterThan(500); // a broken glob would render 0 stories and pass green.
  expect(threw, "These stories throw on render.").toEqual([]);
  expect(
    empty,
    [
      "These stories render NOTHING beyond the decorators: an empty canvas in the workshop.",
      `If that is the intended state, say so on the story: tags: ["${RENDERS_NOTHING}"].`,
    ].join("\n"),
  ).toEqual([]);
  expect(
    staleTag,
    [
      `These stories carry tags: ["${RENDERS_NOTHING}"] but render something.`,
      "Remove the tag: a stale exemption makes the gate lie.",
    ].join("\n"),
  ).toEqual([]);
  // An explicit timeout: 1.5 s alone, but alongside other test files competing for the same cores
  // vitest's default 5 s was hit. A timeout says nothing about the stories, exactly the false red that
  // got the Chrome sweep out of the gates.
}, 120_000);
