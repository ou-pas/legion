// The shell's invariant: the rail and its reopen pill never coexist, and never are both absent. Both
// read the same boolean, which guarantees it; a pill conditioned at the call site would have been
// forgotten some day.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Rail, RailReopen, ShellBody, TopBarTools } from "./shell.js";

function renderShell(collapsed: boolean) {
  return render(
    <ShellBody>
      <RailReopen collapsed={collapsed} name="Legion" onOpen={vi.fn()} />
      <Rail collapsed={collapsed} onCollapse={vi.fn()}>
        <a href="/board">Board</a>
      </Rail>
    </ShellBody>,
  );
}

// `globals: false` in the config: no global `afterEach`, so testing-library's automatic cleanup is
// not installed and the previous test's DOM stays (seen right here: the "collapsed" rail found the
// previous test's nav).
afterEach(cleanup);

describe("shell", () => {
  it("expanded: the rail is there, the reopen button does not exist", () => {
    renderShell(false);
    expect(screen.getByRole("navigation")).toBeDefined();
    // The accessible name also carries the shortcut ("Collapse ⌘B"), hence the regex.
    expect(screen.getByRole("button", { name: /Collapse/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Open the rail/ })).toBeNull();
  });

  it("collapsed: the rail does not exist, the reopen button is there", () => {
    renderShell(true);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("button", { name: "Open the rail — Legion" })).toBeDefined();
  });
});

describe("phone tools panel", () => {
  // 15/09: the tool acts, then the band closes. It used to close on `pointerdown`, before `click`,
  // and since the closed panel is `display: none` none of the six tools was reachable on a phone.
  // The order is the fact to hold, not just closing.
  it("lets the tool act, then closes", () => {
    const actions: string[] = [];
    render(
      <TopBarTools>
        <button type="button" onClick={() => actions.push("wiki")}>
          Wiki
        </button>
      </TopBarTools>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show the bar tools" }));
    const panel = document.querySelector(".ui-topbar-tools");
    expect(panel?.getAttribute("data-open")).toBe("true");

    // The finger lands: the band stays, otherwise the button vanishes under it.
    fireEvent.pointerDown(screen.getByText("Wiki"));
    expect(panel?.getAttribute("data-open")).toBe("true");

    fireEvent.click(screen.getByText("Wiki"));
    expect(actions).toEqual(["wiki"]);
    expect(panel?.getAttribute("data-open")).toBeNull();
  });

  it("closes when the finger lands elsewhere", () => {
    render(
      <TopBarTools>
        <button type="button">Wiki</button>
      </TopBarTools>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show the bar tools" }));
    const panel = document.querySelector(".ui-topbar-tools");
    expect(panel?.getAttribute("data-open")).toBe("true");

    fireEvent.pointerDown(document.body);
    expect(panel?.getAttribute("data-open")).toBeNull();
  });

  it("does not reopen when the closing press is on the trigger", () => {
    render(
      <TopBarTools>
        <button type="button">Wiki</button>
      </TopBarTools>,
    );
    const toggle = screen.getByRole("button", { name: "Show the bar tools" });
    fireEvent.click(toggle);
    const panel = document.querySelector(".ui-topbar-tools");
    expect(panel?.getAttribute("data-open")).toBe("true");

    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(panel?.getAttribute("data-open")).toBeNull();
  });
});
