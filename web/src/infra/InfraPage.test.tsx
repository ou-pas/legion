// The "Declare a machine" form left the grid for a panel, opened by the `+` next to refresh (04/09,
// operator's request). These tests cover what the move could lose: the trigger, closing on success
// (with a list refresh), a refusal that stays readable without clearing the fields, and Escape.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { infraApi, type Infra } from "../api/infra.js";
import { ToastProvider } from "../ui/toast.js";
import { INFRA_TEXT } from "./text.js";
import { InfraPage } from "./InfraPage.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE: Infra = {
  runners: [],
  disabledRunners: [],
  stale: false,
  orphanCount: 0,
  blocker: null,
};

/** `sequence`: each `GET /api/infra` call serves the next value, the last one repeating, so the
 *  test does not depend on the exact number of refetches (mount + invalidation) before reading. */
function mount(...sequence: Infra[]) {
  const spy = vi.spyOn(infraApi, "infra");
  sequence.slice(0, -1).forEach((v) => spy.mockResolvedValueOnce(v));
  spy.mockResolvedValue(sequence.at(-1) ?? BASE);
  const declareRunner = vi.spyOn(infraApi, "declareRunner");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <InfraPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { declareRunner };
}

// jsdom does not focus a button on click like a real browser: done here so the initial focus
// captured by the panel (see useDialogA11y) is the trigger, exactly what a real click gives.
const openPanel = async () => {
  const trigger = await screen.findByRole("button", { name: INFRA_TEXT.declare.title });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole("dialog", { name: INFRA_TEXT.declare.title });
  return trigger;
};

describe("InfraPage — a stale image is shown on the machine, with the gesture (07/09)", () => {
  const stale = (name: string, rebuilding = false) => ({
    runnerId: `r-${name}`,
    runnerName: name,
    dockerHost: `ssh://x@${name}`,
    available: true,
    error: null,
    containers: [],
    networks: [],
    volumes: [],
    zombieSessions: [],
    image: { present: true, builtHash: "old", currentHash: "new", stale: true, rebuilding },
    sharedImages: [],
    projectImages: [],
    maxConcurrentSessions: 3,
    running: 0,
    memoryMb: 2048,
    cpus: 2,
    hostMemoryMb: null,
    lastSeenAt: 1,
    metrics: {
      vm: null,
      vmReason: null,
      vmHistory: [],
      host: null,
      hostReason: null,
      hostHistory: [],
      disk: null,
      diskReason: null,
    },
  });

  it("the note names the stale machine, and the button rebuilds on that machine only", async () => {
    mount({ ...BASE, stale: true, runners: [stale("portable-atelier")] });
    const rebuildImage = vi.spyOn(infraApi, "rebuildImage").mockResolvedValue({
      runnerId: "r-portable-atelier",
      runnerName: "portable-atelier",
      targets: ["session"],
      logPath: "/x/rebuild.log",
    });
    expect(
      await screen.findByText(INFRA_TEXT.rebuild.sessionStale("portable-atelier")),
    ).toBeDefined();
    // No global banner any more: the finding shows once, on the machine's card.
    expect(screen.getAllByText(INFRA_TEXT.rebuild.sessionStale("portable-atelier"))).toHaveLength(
      1,
    );
    fireEvent.click(screen.getByRole("button", { name: INFRA_TEXT.rebuild.button }));
    await waitFor(() => expect(rebuildImage).toHaveBeenCalledWith("r-portable-atelier", "session"));
    expect(await screen.findByText(INFRA_TEXT.rebuild.started("/x/rebuild.log"))).toBeDefined();
  });

  // 09/09: a task run on a machine without an image died on "No such image", and the card stated
  // the absence in a note without a button, pointing to a `make image`.
  it("a missing image carries the same button as a stale one", async () => {
    const absent = {
      ...stale("mini-vm"),
      image: {
        present: false,
        builtHash: null,
        currentHash: "new",
        stale: false,
        rebuilding: false,
      },
    };
    mount({ ...BASE, runners: [absent] });
    const rebuildImage = vi.spyOn(infraApi, "rebuildImage").mockResolvedValue({
      runnerId: "r-mini-vm",
      runnerName: "mini-vm",
      targets: ["session"],
      logPath: "/x/rebuild.log",
    });
    expect(await screen.findByText(INFRA_TEXT.rebuild.sessionAbsent("mini-vm"))).toBeDefined();
    // The old note pointed to a command to type elsewhere: it must no longer show.
    expect(screen.queryByText(/make image/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: INFRA_TEXT.rebuild.button }));
    await waitFor(() => expect(rebuildImage).toHaveBeenCalledWith("r-mini-vm", "session"));
  });

  it("a rebuild already under way replaces the button with the wait", async () => {
    mount({ ...BASE, stale: true, runners: [stale("mini-atelier", true)] });
    // Finding and wait are two texts of the same paragraph: read the paragraph.
    await screen.findByText("mini-atelier");
    await waitFor(() => expect(document.body.textContent).toContain(INFRA_TEXT.rebuild.running));
    expect(document.body.textContent).toContain(INFRA_TEXT.rebuild.sessionStale("mini-atelier"));
    expect(screen.queryByRole("button", { name: INFRA_TEXT.rebuild.button })).toBeNull();
  });
});

describe("InfraPage — declaring a machine, in a panel", () => {
  it("the header `+` opens the panel; the grid no longer carries it", async () => {
    mount();
    await screen.findByText(INFRA_TEXT.empty.title);
    expect(screen.queryByRole("dialog")).toBeNull();

    await openPanel();
    expect(screen.getByLabelText(new RegExp(`^${INFRA_TEXT.declare.name}`))).toBeDefined();
  });

  it("a valid declaration closes the panel and refreshes the runner list", async () => {
    // The second state (served after invalidation) shows the declared machine: proof the list was
    // refreshed, not just that the panel closed.
    const { declareRunner } = mount(BASE, {
      ...BASE,
      runners: [
        {
          runnerId: "r2",
          runnerName: "mac-mini",
          dockerHost: null,
          available: true,
          error: null,
          containers: [],
          networks: [],
          volumes: [],
          zombieSessions: [],
          image: {
            present: true,
            builtHash: null,
            currentHash: null,
            stale: false,
            rebuilding: false,
          },
          sharedImages: [],
          projectImages: [],
          maxConcurrentSessions: 3,
          running: 0,
          memoryMb: 2048,
          cpus: 2,
          hostMemoryMb: null,
          lastSeenAt: 1,
          metrics: {
            vm: null,
            vmReason: null,
            vmHistory: [],
            host: null,
            hostReason: null,
            hostHistory: [],
            disk: null,
            diskReason: null,
          },
        },
      ],
    });
    declareRunner.mockResolvedValue({
      id: "r2",
      name: "mac-mini",
      dockerHost: null,
      callbackUrl: null,
      maxConcurrentSessions: 3,
      reachable: true,
      error: null,
    });

    await openPanel();
    fireEvent.change(screen.getByLabelText(new RegExp(`^${INFRA_TEXT.declare.name}`)), {
      target: { value: "mac-mini" },
    });
    fireEvent.click(screen.getByRole("button", { name: INFRA_TEXT.declare.submit }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("mac-mini")).toBeDefined();
  });

  it("a server refusal stays shown inside the panel, fields kept", async () => {
    const { declareRunner } = mount();
    declareRunner.mockRejectedValue(new Error("a runner is already called « mac-mini »"));

    await openPanel();
    fireEvent.change(screen.getByLabelText(new RegExp(`^${INFRA_TEXT.declare.name}`)), {
      target: { value: "mac-mini" },
    });
    fireEvent.click(screen.getByRole("button", { name: INFRA_TEXT.declare.submit }));

    expect(await screen.findByText("a runner is already called « mac-mini »")).toBeDefined();
    // The panel is still there, with what was typed: nothing to retype.
    expect(screen.getByRole("dialog", { name: INFRA_TEXT.declare.title })).toBeDefined();
    const nameField = screen.getByLabelText(
      new RegExp(`^${INFRA_TEXT.declare.name}`),
    ) as HTMLInputElement;
    expect(nameField.value).toBe("mac-mini");
  });

  it("Escape closes the panel and returns focus to the `+` button", async () => {
    mount();
    const trigger = await openPanel();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

// 08/09: a clean disabled runner must show, without being accused.
//
// The disabled section only listed runners with residue. The "local" runner, off and clean, appeared
// nowhere, and its re-enable button lives on its card: it could only be turned back on with a manual
// PATCH. What accuses is the orphan count, not the list length; these two tests hold both halves.
describe("InfraPage — runners outside the active fleet", () => {
  const off = (name: string, orphan: boolean) => ({
    runnerId: `r-${name}`,
    runnerName: name,
    dockerHost: null,
    available: true,
    error: null,
    containers: [
      {
        name: orphan ? "legion-browser-r1" : "legion-control-plane-1",
        role: "browser" as const,
        sessionId: null,
        state: "running",
        status: "Up 2 days",
        image: "x",
        orphan,
        taskId: null,
        taskName: null,
        goalId: null,
        projectId: null,
        sessionStatus: null,
      },
    ],
    networks: [],
    volumes: [],
    zombieSessions: [],
    image: { present: true, builtHash: "h", currentHash: "h", stale: false, rebuilding: false },
    sharedImages: [],
    projectImages: [],
    maxConcurrentSessions: 3,
    running: 0,
    memoryMb: 1024,
    cpus: 1,
    hostMemoryMb: null,
    lastSeenAt: 1,
    metrics: {
      vm: null,
      vmReason: null,
      vmHistory: [],
      host: null,
      hostReason: null,
      hostHistory: [],
      disk: null,
      diskReason: null,
    },
  });

  it("a clean disabled runner is listed, and its banner is not an alert", async () => {
    mount({ ...BASE, disabledRunners: [off("local", false)] });
    // The card is there, so its re-enable button is too.
    expect(await screen.findByText("local")).toBeTruthy();
    expect(screen.getByText(INFRA_TEXT.disabled.idleTitle)).toBeTruthy();
    expect(screen.queryByText(INFRA_TEXT.disabled.residueTitle)).toBeNull();
    // `role="alert"` is what `Banner` gives the `bad` tone: the check is on what the machine
    // announces to a screen reader, not on a CSS class.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a disabled runner carrying an orphan keeps the red banner", async () => {
    mount({ ...BASE, orphanCount: 1, disabledRunners: [off("mini-atelier", true)] });
    expect(await screen.findByText(INFRA_TEXT.disabled.residueTitle)).toBeTruthy();
    expect(screen.queryByText(INFRA_TEXT.disabled.idleTitle)).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

// Batch F: the project travels with the task (and goal) on inventory containers. Without it, neither
// `TaskLink` nor `GoalLink` may build a dead link: plain text instead.
describe("InfraPage — the project travels with the task on inventory containers", () => {
  const runnerWith = (container: Infra["runners"][number]["containers"][number]) => ({
    runnerId: "r-fleet",
    runnerName: "fleet",
    dockerHost: null,
    available: true,
    error: null,
    containers: [container],
    networks: [],
    volumes: [],
    zombieSessions: [],
    image: { present: true, builtHash: "h", currentHash: "h", stale: false, rebuilding: false },
    sharedImages: [],
    projectImages: [],
    maxConcurrentSessions: 3,
    running: 1,
    memoryMb: 1024,
    cpus: 1,
    hostMemoryMb: null,
    lastSeenAt: 1,
    metrics: {
      vm: null,
      vmReason: null,
      vmHistory: [],
      host: null,
      hostReason: null,
      hostHistory: [],
      disk: null,
      diskReason: null,
    },
  });

  const openInventory = async () =>
    fireEvent.click(await screen.findByText("Inventory — 1 object"));

  it("a task with an unknown project shows as text, never a dead link", async () => {
    mount({
      ...BASE,
      runners: [
        runnerWith({
          name: "legion-t1",
          role: "session",
          sessionId: "s1",
          state: "running",
          status: "Up",
          image: "x",
          orphan: false,
          taskId: "t1",
          taskName: "Purge Docker",
          goalId: null,
          projectId: null,
          sessionStatus: "in_progress",
        }),
      ],
    });
    await openInventory();
    // "Purge Docker" appears twice (occupied place, inventory row): neither is a link, since the
    // project is unknown.
    expect((await screen.findAllByText("Purge Docker")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Purge Docker/ })).toBeNull();
  });

  it("a goal with an unknown project shows as text, never a dead link", async () => {
    mount({
      ...BASE,
      runners: [
        runnerWith({
          name: "legion-g1",
          role: "session",
          sessionId: "s2",
          state: "running",
          status: "Up",
          image: "x",
          orphan: false,
          taskId: null,
          taskName: null,
          goalId: "g1",
          projectId: null,
          sessionStatus: "in_progress",
        }),
      ],
    });
    await openInventory();
    expect(await screen.findByText("goal")).toBeDefined();
    expect(screen.queryByRole("link", { name: /goal/ })).toBeNull();
  });
});
