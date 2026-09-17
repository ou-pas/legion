// The view the page opens when nobody chose, and what `effectiveView` NO LONGER does: correct a
// requested view. It used to fold back a chosen view that stopped existing (a session restarts, the
// report is no longer one); that case is handled one level up in `use-task-view.ts`, which knows
// WHO set the address. Here a requested view stays where it is.
//
// Since slice nav/17 there is also the PATH: a view is an address, so its id is a segment, and the
// two must never diverge.
import { describe, expect, it } from "vitest";
import {
  agentReport,
  effectiveView,
  parseTaskView,
  TASK_VIEWS,
  TASK_VIEW_PATH,
  viewOfPath,
} from "./task-views.js";

const text = (t: string) => ({ type: "text", data: { text: t } });

describe("agentReport", () => {
  it("takes the agent's LAST text", () => {
    const r = agentReport([text("d'abord"), { type: "tool_start", data: {} }, text("ensuite")], {
      hasSession: true,
      active: false,
    });
    expect(r.text).toBe("ensuite");
    expect(r.available).toBe(true);
  });

  it("ignores an empty or blank text: it is not a summary", () => {
    const r = agentReport([text("the summary"), text("   \n ")], {
      hasSession: true,
      active: false,
    });
    expect(r.text).toBe("the summary");
  });

  it("is not a report while the session runs", () => {
    const r = agentReport([text("j'avance")], { hasSession: true, active: true });
    expect(r.text).toBe("j'avance");
    expect(r.available).toBe(false);
  });

  it("does not exist without a session", () => {
    expect(agentReport([text("x")], { hasSession: false, active: false }).available).toBe(false);
  });

  it("no text at all: nothing to read", () => {
    const r = agentReport([{ type: "status", data: {} }], { hasSession: true, active: false });
    expect(r).toEqual({ text: "", available: false });
  });
});

describe("effectiveView", () => {
  it("no choice and no session ever run: the brief, the contract one wants to read", () => {
    expect(
      effectiveView(undefined, { interview: false, hasReport: false, hasSession: false }),
    ).toBe("brief");
    expect(effectiveView(undefined, { interview: true, hasReport: false, hasSession: false })).toBe(
      "brief",
    );
  });

  it("with a session: the thread on an interview, else the report, else the trace", () => {
    expect(effectiveView(undefined, { interview: true, hasReport: true, hasSession: true })).toBe(
      "interview",
    );
    expect(effectiveView(undefined, { interview: false, hasReport: true, hasSession: true })).toBe(
      "report",
    );
    expect(effectiveView(undefined, { interview: false, hasReport: false, hasSession: true })).toBe(
      "timeline",
    );
  });

  it("respects the operator's choice", () => {
    expect(effectiveView("pr", { interview: true, hasReport: true, hasSession: true })).toBe("pr");
    expect(effectiveView("notes", { interview: false, hasReport: false, hasSession: false })).toBe(
      "notes",
    );
  });

  it("NO requested view redirects elsewhere, even without content", () => {
    // The former fallback (missing report, interview no longer one) treated the view the operator
    // asked for and the one the resolution set alike; it could not tell them apart. `use-task-view.ts`
    // can, and handles that case now (its test checks both ways). Here `chosen` only means what was
    // ASKED for, and it never redirects: "Report" and "Interview" are permanent rail ranks, and a
    // rank doing nothing visible on click is a broken rank.
    expect(effectiveView("report", { interview: false, hasReport: false, hasSession: false })).toBe(
      "report",
    );
    expect(
      effectiveView("interview", { interview: false, hasReport: true, hasSession: true }),
    ).toBe("interview");
    expect(effectiveView("notes", { interview: false, hasReport: false, hasSession: true })).toBe(
      "notes",
    );
    expect(
      effectiveView("criteria", { interview: false, hasReport: false, hasSession: false }),
    ).toBe("criteria");
    expect(effectiveView("pr", { interview: false, hasReport: false, hasSession: true })).toBe(
      "pr",
    );
  });
});

describe("a view is a path segment", () => {
  it("each view has its path, and the segment IS its id", () => {
    // Identity is what makes a legacy `?vue=notes` lead to `/notes` without a mapping table, hence
    // without a table that can lie.
    for (const view of TASK_VIEWS) {
      expect(TASK_VIEW_PATH[view]).toBe(`/p/$projectId/tasks/$taskId/${view}`);
    }
  });

  it("reads the view from a real path", () => {
    expect(viewOfPath("/p/p1/tasks/tk42/pr", "tk42")).toEqual({ inside: true, view: "pr" });
    expect(viewOfPath("/p/p1/tasks/tk42/interview", "tk42")).toEqual({
      inside: true,
      view: "interview",
    });
  });

  it("a task's BARE address has no view: the page picks it", () => {
    expect(viewOfPath("/p/p1/tasks/tk42", "tk42")).toEqual({ inside: true, view: undefined });
    expect(viewOfPath("/p/p1/tasks/tk42/", "tk42")).toEqual({ inside: true, view: undefined });
  });

  it("an unknown segment does not become a view, but we are inside the task", () => {
    expect(viewOfPath("/p/p1/tasks/tk42/zzz", "tk42")).toEqual({ inside: true, view: undefined });
  });

  it("a path from elsewhere is NOT inside the task, which protects going back", () => {
    // The defect measured in Chrome: leaving the page publishes the new address before the page
    // unmounts. Without this distinction the resolution read "no view" there and sent back to the
    // task, so "back" never left.
    expect(viewOfPath("/p/p1/board", "tk42")).toEqual({ inside: false, view: undefined });
    expect(viewOfPath("/p/p1/project/coffre", "tk42")).toEqual({ inside: false, view: undefined });
    expect(viewOfPath("/p/p1/channels/tk42", "tk42")).toEqual({ inside: false, view: undefined });
    // ANOTHER task is not inside either: opening a task from another's lineage goes through the same
    // instant, with two pages crossing.
    expect(viewOfPath("/p/p1/tasks/other/pr", "tk42")).toEqual({ inside: false, view: undefined });
  });
});

describe("parseTaskView", () => {
  it("accepts the values the screen names, and nothing else", () => {
    for (const v of TASK_VIEWS) expect(parseTaskView(v)).toBe(v);
    for (const junk of [undefined, null, "", "Diff", " diff", 3, {}, ["diff"]]) {
      expect(parseTaskView(junk)).toBeUndefined();
    }
  });

  it("a RETIRED view leads to the one serving it today: `?vue=diff` is in bookmarks", () => {
    expect(parseTaskView("diff")).toBe("pr");
  });
});
