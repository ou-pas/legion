// The rail never shows two levels at once (nav slice 09, AC#2).
//
// This property breaks silently: adding a "Settings" entry to a section's list, or leaving the
// board in the Library list, fails no compiler and only shows by looking at the column. The chosen
// direction (variant A of `direction-sous-menu-rail.html`) is a rail that replaces itself; if both
// levels coexist, it is the rejected variant B.
//
// The head's second segment is checked here too, not only in the story: once the project list is
// replaced, it is the only place still saying which project you are in.
import { describe, expect, it } from "vitest";
import { ArrowLeft } from "lucide-react";
import {
  CAPABILITY_ROWS,
  PROJECT_ROWS,
  SETTINGS_ROWS,
  TASK_ROWS,
  railRowsFor,
} from "./rail-sections.js";
import { TASK_VIEWS } from "../tasks/task-views.js";
import { PROJECT_TEXT } from "./text/vocabulary.js";

const labels = (rows: readonly { label: string }[]) => rows.map((r) => r.label);

describe("what the rail lists, depending on where you are", () => {
  it.each([
    ["/p/p1/board", null],
    ["/p/p1/canaux/t1", null],
    ["/p/p1/agents", null],
    // A section's bare path already renders the section's list: it redirects, but the redirect
    // runs in a `beforeLoad`, so it exists for an instant, and a flickering rail costs more than a
    // table row.
    ["/p/p1/project", PROJECT_TEXT.rail.settings],
    ["/p/p1/project/coffre", PROJECT_TEXT.rail.settings],
    ["/p/p1/libraries", PROJECT_TEXT.rail.capabilities],
    ["/p/p1/libraries/mcp", PROJECT_TEXT.rail.capabilities],
    // `capabilities` besides `libraries` (nav project, batch 5, 12/09): the old address redirects
    // in a `beforeLoad`, so it exists for an instant.
    ["/p/p1/capabilities", PROJECT_TEXT.rail.capabilities],
    ["/p/p1/capabilities/mcp", PROJECT_TEXT.rail.capabilities],
    // "/project/chaines" is no longer a rail row (merged into Library › Chains on 12/09), but the
    // address still exists, as a redirect (see router.test.ts).
    // A task is a level, like a section (nav slice 17). Slice 09 had decided the opposite ("the
    // task page keeps its tabs"); the number reversed it: nine tabs in three named families do not
    // fit a horizontal bar, which cannot name a group.
    ["/p/p1/tasks/tk42", PROJECT_TEXT.rail.task],
    ["/p/p1/tasks/tk42/diff", PROJECT_TEXT.rail.task],
    // `taches` besides `tasks` (nav project, batch 5, 12/09): the old address redirects in a
    // `beforeLoad`, so it exists for an instant.
    ["/p/p1/taches/tk42", PROJECT_TEXT.rail.task],
    ["/p/p1/taches/tk42/diff", PROJECT_TEXT.rail.task],
  ])("%s writes '%s' after the project name", (pathname, sub) => {
    expect(railRowsFor(pathname).sub).toBe(sub);
  });

  it("on a task page, the rail lists the task", () => {
    expect(railRowsFor("/p/p1/tasks/tk42/timeline").rows).toBe(TASK_ROWS);
    // The bare address too: it resolves to a view from the page, so it exists for one render.
    expect(railRowsFor("/p/p1/tasks/tk42").rows).toBe(TASK_ROWS);
  });

  it("a path that starts like another does not go down a level", () => {
    // `projections` is not `project`, and `/p/p1` alone has no screen yet.
    expect(railRowsFor("/p/p1/projections").sub).toBe(null);
    expect(railRowsFor("/p/p1").sub).toBe(null);
    expect(railRowsFor("/p/p1/").sub).toBe(null);
  });

  it("in a section, the list is the section's and nothing else", () => {
    const settings = railRowsFor("/p/p1/project/coffre").rows;
    expect(settings).toBe(SETTINGS_ROWS);
    // No project rail entry survives: that is what tells a rail that replaces itself from one that
    // expands, and that is the choice made.
    const projet = new Set(labels(PROJECT_ROWS));
    for (const row of settings) expect(projet.has(row.label), row.label).toBe(false);
  });

  it("the eight Settings subjects and the five Library registries, in order", () => {
    expect(labels(SETTINGS_ROWS).slice(1)).toEqual([
      "General",
      "Repos",
      "Secrets",
      // Right after Secrets: what you connect, next to what you pasted.
      "Integrations",
      "Models",
      "Sessions",
      "Crate",
      "Danger",
    ]);
    expect(labels(CAPABILITY_ROWS).slice(1)).toEqual([
      "Skills",
      "Rules",
      "Chains",
      "MCP servers",
      "Environments",
    ]);
  });
});

describe("the row going back up", () => {
  it.each([
    ["Settings", SETTINGS_ROWS],
    ["Library", CAPABILITY_ROWS],
  ])("opens the %s list and leads back to the project rail", (_nom, rows) => {
    const back = rows[0];
    // At the top: the column's first row, not a list footer discovered eight entries down.
    expect("back" in back).toBe(true);
    // The arrow names its destination, as everywhere else; the section is written in the rail
    // head. That is the pair chosen in the mock-up; the other arrangement ("← Project" with a mute
    // head) names the section nowhere.
    expect(back.label).toBe(PROJECT_TEXT.rail.back);
    expect(back.Icon).toBe(ArrowLeft);
    expect(back.to).toBe("/p/$projectId/board");
  });

  it("only exists inside a section", () => {
    expect(PROJECT_ROWS.some((r) => "back" in r)).toBe(false);
  });
});

// A task's views (nav slice 17, AC#3). Two properties break silently here, and no compiler rereads
// them: a row appearing depending on session state, and the project list surviving next to the
// task's.
describe("a task's rail", () => {
  it("carries the eight readable views, grouped, in mock-up order", () => {
    // "Diff" joined "PR" on 05/09: the diff reads under the draft, in the same view.
    expect(labels(TASK_ROWS).slice(1)).toEqual([
      "Brief",
      "Criteria",
      "Channel",
      "Report",
      "Trace",
      "Notes",
      "Artifacts",
      "PR",
    ]);
    expect(TASK_ROWS.filter((r) => "group" in r).map((r) => r.group)).toEqual([
      "Contract",
      "Flow",
      "Delivery",
    ]);
  });

  it("'Settings' is not a row: the page's right panel carries it (04/09)", () => {
    // The route existed for a while as a bare address, then was removed on 12/09 (nav project,
    // batch G): a row for what the panel already shows duplicated it. Widened to `string`:
    // TypeScript already proves statically that the table lacks this path and refuses the literal
    // comparison; the test says the same to the reader.
    const destinations: readonly string[] = TASK_ROWS.map((r) => r.to);
    expect(destinations.some((to) => to.endsWith("/settings"))).toBe(false);
  });

  it("rows are static: one per readable view, no more, no less", () => {
    // The property of this choice: `railRowsFor` is a pure function of the path and cannot know a
    // report exists. Rather than lift page state up, rows are always there and an empty view says
    // so. If a row ever depended on data, say it here before seeing it flicker on screen.
    const views = TASK_ROWS.filter((r) => !("back" in r));
    expect(views).toHaveLength(TASK_VIEWS.length);
    for (const view of TASK_VIEWS) {
      expect(
        views.some((r) => r.to.endsWith(`/${view}`)),
        view,
      ).toBe(true);
    }
  });

  it("the list leads to the task's views, and to no project screen", () => {
    // The rail replaces itself: from a task, no project screen stays offered, or it would carry two
    // levels at once.
    //
    // The assertion is on destinations, not labels, unlike the Settings one, and it is the right
    // version: two task rows use a word the project also uses. "Board" is the back row, the
    // ladder, not a survivor, hence excluded. "Settings" is the real duplicate, accepted: both lists
    // are never in the column together, and the head writes "<project> · Task" above.
    const projet = new Set<string>(PROJECT_ROWS.map((r) => r.to));
    for (const row of TASK_ROWS.filter((r) => !("back" in r))) {
      expect(projet.has(row.to), row.to).toBe(false);
    }
  });

  it("a '← Project' row at the top leads back to where a task is opened", () => {
    const back = TASK_ROWS[0];
    expect("back" in back).toBe(true);
    expect(back.Icon).toBe(ArrowLeft);
    expect(back.to).toBe("/p/$projectId/board");
    // One back label for one destination (nav/2c): a section's and a task's used two words for the
    // same place.
    expect(back.label).toBe(PROJECT_TEXT.rail.back);
  });
});

describe("the project rail leads to sections, not to the bare address", () => {
  it("'Settings' and 'Library' point at their first entry", () => {
    // Going through the redirect would cost a round trip and a history step on a daily gesture;
    // the bare address stays for links already written, not for the rail.
    const to = (label: string) => PROJECT_ROWS.find((r) => r.label === label)?.to;
    expect(to(PROJECT_TEXT.rail.settings)).toBe(SETTINGS_ROWS[1].to);
    expect(to(PROJECT_TEXT.rail.capabilities)).toBe(CAPABILITY_ROWS[1].to);
  });
});
