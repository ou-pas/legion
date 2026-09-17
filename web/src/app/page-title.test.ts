// The bar and the browser tab say the same word: both read `SHELL_TEXT.route`.
import { describe, expect, it } from "vitest";
import { CHANNELS_TEXT } from "../channels/text.js";
import { pageTitleOf } from "./page-title.js";
import { SHELL_TEXT } from "./text/shell.js";

describe("the bar title", () => {
  it.each([
    ["/p/p1/board", SHELL_TEXT.route.board],
    ["/p/p1/channels", CHANNELS_TEXT.nav],
    ["/p/p1/channels/t1", CHANNELS_TEXT.nav],
    // The French paths (`canaux`, `planifiees`, `capabilities`, `taches`, `systeme`) are the
    // pre-12/09 URLs: they redirect in a `beforeLoad`, so they exist for an instant, and a title
    // falling back to the brand for a click would be worse than a table row.
    ["/p/p1/canaux", CHANNELS_TEXT.nav],
    ["/p/p1/canaux/t1", CHANNELS_TEXT.nav],
    // Before 12/09 this URL had no declared title and the bar showed the brand instead.
    ["/p/p1/inbox", SHELL_TEXT.route.inbox],
    ["/p/p1/goals", SHELL_TEXT.route.goals],
    ["/p/p1/scheduled", SHELL_TEXT.route.schedules],
    ["/p/p1/planifiees", SHELL_TEXT.route.schedules],
    ["/p/p1/reviews", SHELL_TEXT.route.reviews],
    ["/p/p1/issues", SHELL_TEXT.route.issues],
    ["/p/p1/agents", SHELL_TEXT.route.agents],
    ["/p/p1/libraries/skills", SHELL_TEXT.route.capabilities],
    ["/p/p1/capabilities/skills", SHELL_TEXT.route.capabilities],
    ["/p/p1/project/crate", SHELL_TEXT.route.project],
    ["/system/general", SHELL_TEXT.route.system],
    ["/systeme/general", SHELL_TEXT.route.system],
    ["/wiki/concepts/session", SHELL_TEXT.route.wiki],
    ["/chains/r1", SHELL_TEXT.route.chainRun],
  ])("%s → %s, without second segment", (path, title) => {
    expect(pageTitleOf(path)).toEqual({ title, crumb: null });
  });

  it("an open task: Task, then its id, never the project already written in the rail", () => {
    expect(pageTitleOf("/p/p1/tasks/abc123")).toEqual({
      title: SHELL_TEXT.route.task,
      crumb: "abc123",
    });
    expect(pageTitleOf("/p/p1/tasks/abc123/diff")).toEqual({
      title: SHELL_TEXT.route.task,
      crumb: "abc123",
    });
    expect(pageTitleOf("/p/p1/taches/abc123")).toEqual({
      title: SHELL_TEXT.route.task,
      crumb: "abc123",
    });
  });

  it("an open goal is named in the singular", () => {
    expect(pageTitleOf("/p/p1/goals/g1")).toEqual({ title: SHELL_TEXT.route.goal, crumb: "g1" });
  });

  it("nowhere in particular: the brand", () => {
    expect(pageTitleOf("/")).toEqual({ title: SHELL_TEXT.brand, crumb: null });
    expect(pageTitleOf("/p/p1")).toEqual({ title: SHELL_TEXT.brand, crumb: null });
  });
});
