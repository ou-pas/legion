// The preflight names the gesture, and the button says why it waits (nav project 04, AC#1 and #2).
//
// This prevents the screen's costliest defect: letting a project be created while the session
// image is missing. The project is created fine; the first task dies half an hour later in a
// container that does not exist, blaming something else.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthIdentity } from "../api/auth.js";
import type { Infra, InfraRunner } from "../api/infra.js";
import { NoProjectScreen, preflight } from "./no-project.js";

afterEach(cleanup);

const runner = (over: Partial<InfraRunner> = {}): InfraRunner => ({
  runnerId: "r1",
  runnerName: "local",
  dockerHost: null,
  available: true,
  error: null,
  containers: [],
  networks: [],
  volumes: [],
  zombieSessions: [],
  image: { present: true, builtHash: null, currentHash: null, stale: false, rebuilding: false },
  sharedImages: [],
  projectImages: [],
  maxConcurrentSessions: 2,
  running: 0,
  memoryMb: 4096,
  cpus: 2,
  hostMemoryMb: 8192,
  lastSeenAt: null,
  metrics: {
    vm: null,
    vmReason: "not measured yet",
    vmHistory: [],
    host: null,
    hostReason: "not measured yet",
    hostHistory: [],
    disk: null,
    diskReason: "not measured yet",
  },
  ...over,
});
const infra = (runners: InfraRunner[]): Infra => ({
  runners,
  disabledRunners: [],
  stale: false,
  orphanCount: 0,
  blocker: null,
});
const identity = (kind: AuthIdentity["kind"]): AuthIdentity => ({
  kind,
  masked: kind === "none" ? null : "sk-ant-oat-a… (72 chars)",
  warnings: [],
});

describe("preflight — the three conditions, read from routes the server already serves", () => {
  it("holds when the credential, a healthy runner and the image are there", () => {
    const checks = preflight(identity("oauth"), infra([runner()]));
    expect(checks.map((c) => c.met)).toEqual([true, true, true]);
    expect(checks.every((c) => c.command === undefined)).toBe(true);
  });

  it("names the image command when it is missing", () => {
    const checks = preflight(
      identity("oauth"),
      infra([
        runner({
          image: {
            present: false,
            builtHash: null,
            currentHash: null,
            stale: false,
            rebuilding: false,
          },
        }),
      ]),
    );
    const image = checks.find((c) => c.id === "image")!;
    expect(image.met).toBe(false);
    expect(image.command).toBe("make image-session");
  });

  // A stopped daemon can say nothing about its images: reading its silence as "image missing"
  // would name two gestures where only one is possible.
  it("does not claim to know whether the image is there when no runner answers", () => {
    const checks = preflight(identity("oauth"), infra([runner({ available: false })]));
    expect(checks.find((c) => c.id === "docker")!.met).toBe(false);
    expect(checks.find((c) => c.id === "image")!.met).toBe(false);
  });

  it("sees the missing credential, and does not confuse it with an API key", () => {
    expect(preflight(identity("none"), infra([runner()]))[0]!.met).toBe(false);
    expect(preflight(identity("api-key"), infra([runner()]))[0]!.met).toBe(true);
  });
});

describe("the no-project screen", () => {
  const CHECKS_OK = () => preflight(identity("oauth"), infra([runner()]));
  const CHECKS_NO_IMAGE = () =>
    preflight(
      identity("oauth"),
      infra([
        runner({
          image: {
            present: false,
            builtHash: null,
            currentHash: null,
            stale: false,
            rebuilding: false,
          },
        }),
      ]),
    );

  function monter(
    checks: ReturnType<typeof CHECKS_OK> | null,
    over: { onCreate?: (u: string) => void; onOpenDemo?: () => void } = {},
  ) {
    render(
      <NoProjectScreen
        checks={checks}
        onCreate={over.onCreate ?? (() => {})}
        onOpenDemo={over.onOpenDemo ?? (() => {})}
      />,
    );
  }

  it("shows the command in full for the unmet condition", () => {
    monter(CHECKS_NO_IMAGE());
    expect(screen.getByText("make image-session")).toBeDefined();
  });

  it("the button waits for the conditions, and says which", () => {
    monter(CHECKS_NO_IMAGE());
    const bouton = screen.getByRole("button", { name: "Create" });
    expect(bouton.hasAttribute("disabled")).toBe(true);
    // "Says why": the sentence names the condition, not an "invalid form".
    expect(screen.getByText(/The button is waiting for the session image/)).toBeDefined();
  });

  it("also waits while the ground is not read: not knowing is not holding", () => {
    monter(null);
    expect(screen.getByRole("button", { name: "Create" }).hasAttribute("disabled")).toBe(true);
  });

  it("derives the project name and forge from the URL alone, and creates with it", () => {
    const cree = vi.fn();
    monter(CHECKS_OK(), { onCreate: cree });
    fireEvent.change(screen.getByLabelText(/repository the agents/), {
      target: { value: "git@github.com:ou-pas/legion.git" },
    });
    // The derived line shows what will be set, before saving.
    expect(screen.getByText(/project legion · forge GitHub/)).toBeDefined();
    const bouton = screen.getByRole("button", { name: "Create" });
    expect(bouton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(bouton);
    expect(cree).toHaveBeenCalledWith("git@github.com:ou-pas/legion.git");
  });

  it("the side door opens the demo, ground held or not", () => {
    const ouvre = vi.fn();
    monter(CHECKS_NO_IMAGE(), { onOpenDemo: ouvre });
    const porte = screen.getByRole("button", { name: "Open the demo" });
    expect(porte.hasAttribute("disabled")).toBe(false);
    fireEvent.click(porte);
    expect(ouvre).toHaveBeenCalledOnce();
  });
});
