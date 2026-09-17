// The panel opens compact, and the count only counts what is stopped. Since 02/09 the panel appears
// on hover: compact first (per-project counts, oldest decisions), "See all" expands the grouped
// surface. Notices live in the logs (`notices-journal.tsx`). These tests pin both decisions: hover
// stays light, and "a counter that never goes down stops being looked at".
//
// Since 07/09 the gesture is WRITTEN on the row (Resume, Answer, Approve) and an entry says where it
// leads (`question`): resuming a round is not opening one.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PendingButton, PendingPanel } from "./pending-panel.js";
import type { PendingGroup } from "./pending-entries.js";

const NOW = Date.parse("2026-08-29T12:00:00Z");
const min = (n: number) => NOW - n * 60_000;
const GROUPS: PendingGroup[] = [
  {
    project: { id: "prj-ag", name: "Legion" },
    entries: [
      {
        id: "q-1",
        kind: "question",
        taskId: "t1",
        projectId: "prj-ag",
        text: "The probe asks for four edges",
        meta: "Probe · 8 min",
        since: min(8),
        question: { projectId: "prj-ag", inboxId: "i-1" },
        action: "Resume",
      },
      {
        id: "q-3",
        kind: "question",
        taskId: "t3",
        projectId: "prj-ag",
        text: "Which icon is affected?",
        meta: "Icons · 41 min",
        since: min(41),
        question: null,
        action: "Answer",
      },
      {
        id: "g-2",
        kind: "gate",
        taskId: "t4",
        projectId: "prj-ag",
        text: "“Breakdown” is waiting for your approval",
        meta: "Breakdown · gate · 1 min",
        since: min(1),
        question: null,
        action: "Approve",
      },
    ],
  },
  {
    project: { id: "prj-kp", name: "Kopee.me" },
    entries: [
      {
        id: "g-1",
        kind: "gate",
        taskId: "t2",
        projectId: "prj-kp",
        text: "“Webhook” is waiting for your approval",
        meta: "Webhook · gate · 22 min",
        since: min(22),
        question: null,
        action: "Approve",
      },
    ],
  },
];

// `globals: false` in the config: without this cleanup the previous test's DOM stays.
afterEach(cleanup);

describe("the waiting panel", () => {
  it("opens COMPACT: per-project counts, the 3 oldest, no groups", () => {
    render(<PendingPanel groups={GROUPS} />);
    // Per-project counts are there…
    expect(screen.getByText("Legion")).toBeDefined();
    expect(screen.getByText("Kopee.me")).toBeDefined();
    // …the 3 oldest across piles (41, 22, 8 min), not the 1 min gate…
    expect(screen.getByText("Which icon is affected?")).toBeDefined();
    expect(screen.getByText(/Webhook” is waiting/)).toBeDefined();
    expect(screen.getByText("The probe asks for four edges")).toBeDefined();
    expect(screen.queryByText(/Breakdown” is waiting/)).toBeNull();
    // …and no group subheading: the expanded view carries them.
    expect(screen.queryByRole("heading", { name: /Legion/ })).toBeNull();
  });

  it("See all expands the full surface, grouped by project", () => {
    render(<PendingPanel groups={GROUPS} />);
    fireEvent.click(screen.getByRole("button", { name: /See all — 4 decisions/ }));
    expect(screen.getByRole("heading", { name: /Legion/ })).toBeDefined();
    expect(screen.getByRole("heading", { name: /Kopee\.me/ })).toBeDefined();
    expect(screen.getByText(/Breakdown” is waiting/)).toBeDefined();
  });

  it("at 3 decisions or fewer the compact view already shows all: no button", () => {
    render(<PendingPanel groups={GROUPS.slice(1)} />);
    expect(screen.queryByRole("button", { name: /See all/ })).toBeNull();
  });

  it("leads each entry to its task", () => {
    render(
      <PendingPanel
        groups={GROUPS.slice(1)}
        render={(e, p) => <a href={`/tasks/${e.taskId}`} {...p} />}
      />,
    );
    const lien = screen.getByRole("link", { name: /Webhook” is waiting/ });
    expect(lien.getAttribute("href")).toBe("/tasks/t2");
  });

  it("the subtitle counts the stops", () => {
    render(<PendingPanel groups={GROUPS} />);
    expect(screen.getByText("4 decisions · all projects")).toBeDefined();
  });

  it("nothing stopped: the count is zero and the panel says so", () => {
    render(<PendingPanel groups={[]} />);
    expect(screen.getByText("0 decisions · all projects")).toBeDefined();
    expect(screen.getByText("Nothing is stopped")).toBeDefined();
  });

  it("the button carries the cross total, and stays at zero", () => {
    render(
      <PendingButton count={3}>
        <PendingPanel groups={GROUPS} />
      </PendingButton>,
    );
    expect(
      screen.getByRole("button", {
        name: "3 decisions waiting for an answer, across all projects",
      }),
    ).toBeDefined();
    cleanup();
    render(
      <PendingButton count={0}>
        <PendingPanel groups={[]} />
      </PendingButton>,
    );
    expect(screen.getByRole("button", { name: /^0 decision/ })).toBeDefined();
  });
});
