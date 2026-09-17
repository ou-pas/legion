// What the rail shows, and what it does not. Two properties, and the second is the one broken
// without noticing:
//
//  1. the rail carries the navigation of where you are (project, system, wiki), and where there is
//     no sub-navigation, neither rail nor reopen pill. A pill with no rail behind it is the worst of
//     both: it promises a return that does not exist.
//  2. the COLLAPSE state survives a context change, both ways. It says how you look, not what at;
//     resetting it when leaving a project would be the easy, wrong fix.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRail } from "../ui/use-rail.js";
import { ShellBody } from "../ui/shell.js";
import { RailSlot, railSectionOf, type RailSection } from "./rail-slot.js";

afterEach(cleanup);

describe("railSectionOf", () => {
  it("returns the section of each path family", () => {
    const cases: [string, RailSection][] = [
      ["/p/ag7Kx2Lm01", "project"],
      ["/p/ag7Kx2Lm01/board", "project"],
      ["/p/ag7Kx2Lm01/channels/t1", "project"],
      // A task page lives under its project since slice nav/13, and the rail follows without the
      // function changing: the path starts with `/p/`. That keeps it PURE; a rail waiting for the
      // task's project would flicker.
      ["/p/ag7Kx2Lm01/tasks/tk42", "project"],
      ["/system", "system"],
      ["/system/logs", "system"],
      // `/systeme` and the three old URLs below redirect to `/system` (12/09) but EXIST for the
      // duration of the `beforeLoad`: without them here the rail would flicker on each click on the
      // version chip.
      ["/systeme", "system"],
      ["/systeme/journal", "system"],
      ["/systeme/modeles", "system"],
      ["/infra", "system"],
      ["/logs", "system"],
      ["/analytics", "system"],
      ["/wiki", "wiki"],
      ["/wiki/concepts/agent", "wiki"],
      // No sub-navigation: the root switch, the inbox, a goal. Nothing to put in the rail, so no
      // rail. `/tasks/<id>` stays here because it REDIRECTS to the canonical URL (nav/13): one only
      // lingers there when the id designates nothing, and an absence page has no project to show.
      ["/", null],
      ["/tasks/tk42", null],
      ["/inbox", null],
      ["/goals/g1", null],
      // The concierge has no sub-navigation (`railNavOf` returns `null` for it), but its section stays
      // DISTINCT from `null` (16/09) so the bottom bar can offer an exit. The two old
      // `conversations` URLs remain for the duration of the `beforeLoad`.
      ["/concierge", "concierge"],
      ["/concierge/aB3x9Zqw01", "concierge"],
      ["/concierge/conversations", "concierge"],
      ["/concierge/conversations/aB3x9Zqw01", "concierge"],
    ];
    for (const [path, expected] of cases) expect(railSectionOf(path), path).toBe(expected);
  });

  it("does not confuse a path that STARTS like another", () => {
    // A plain prefix comparison would take all of these.
    expect(railSectionOf("/wikipedia")).toBe(null);
    expect(railSectionOf("/systemes")).toBe(null);
    expect(railSectionOf("/projects")).toBe(null);
    expect(railSectionOf("/conciergerie")).toBe(null);
  });
});

function Nav() {
  return <a href="/board">Board</a>;
}

/** The shell, the real collapse state, and a section changed as a navigation would. */
function Harness({ section }: { section: RailSection }) {
  const { collapsed, toggle } = useRail();
  return (
    <ShellBody>
      <RailSlot
        nav={section === null ? null : <Nav />}
        collapsed={collapsed}
        name="Legion"
        onToggle={toggle}
      />
    </ShellBody>
  );
}

const rail = () => screen.queryByRole("navigation");
const reopen = () => screen.queryByRole("button", { name: /Open the rail/ });
const collapse = () => screen.getByRole("button", { name: /Collapse/ });

describe("the rail on a global page", () => {
  it("without sub-navigation: no rail, no reopen pill", () => {
    render(<Harness section={null} />);
    expect(rail()).toBeNull();
    // The case that would make the rest pointless: hiding the rail but leaving the pill.
    expect(reopen()).toBeNull();
  });

  it("in system and in the wiki, the rail carries the page navigation", () => {
    for (const section of ["system", "wiki"] as const) {
      render(<Harness section={section} />);
      expect(rail(), section).not.toBeNull();
      cleanup();
    }
  });
});

describe("the collapse state crosses context changes", () => {
  it("collapsed in a project, it is found collapsed on return", () => {
    window.localStorage.clear();
    const view = render(<Harness section="project" />);
    fireEvent.click(collapse());
    expect(rail()).toBeNull();
    expect(reopen()).not.toBeNull();

    // Off to a global page without sub-navigation: nothing shows, and above all nothing resets the
    // collapse on the way.
    view.rerender(<Harness section={null} />);
    expect(rail()).toBeNull();
    expect(reopen()).toBeNull();

    view.rerender(<Harness section="project" />);
    expect(rail()).toBeNull();
    expect(reopen()).not.toBeNull();
  });

  it("collapsed in system, found collapsed in a project, and the reverse", () => {
    window.localStorage.clear();
    const view = render(<Harness section="system" />);
    fireEvent.click(collapse());
    view.rerender(<Harness section="project" />);
    expect(reopen()).not.toBeNull();

    // And the other way: expanded in the project, expanded back in system.
    fireEvent.click(reopen()!);
    expect(rail()).not.toBeNull();
    view.rerender(<Harness section="system" />);
    expect(rail()).not.toBeNull();
    expect(reopen()).toBeNull();
  });
});
