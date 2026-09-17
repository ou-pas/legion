// Phone navigation (13/09, `compact` breakpoint of DESIGN.md).
//
// Above 640px the rail navigates and this bar does not exist, handled by CSS rather than a TSX
// condition: one mechanism at a time.
//
// Why a bottom bar and not the rail as a drawer: the rail holds eleven entries in a 403px column; at
// 375 wide it ate 683 of the screen's 812 pixels. A drawer would give the height back, but costs two
// taps per switch and opens from the top-left corner, the hardest point to reach one-handed.
//
// It carries the whole level, and scrolls (13/09, second version, operator request). The first put
// three fixed destinations and hid everything else behind "More": each jump between two neighbours
// cost two taps. The hierarchy already existed: `railRowsFor(pathname)` returns THE list of where you
// are, with a "back" row first. So the bar has no list of its own: it renders the rail's, laid flat.
//
// The back row is pinned outside the scroll: it is the one target whose absence traps you, and an
// exit that slides away is not an exit.
//
// The current entry is scrolled into view on every navigation. Otherwise entering a section through
// a page link leaves the bar on its first row, and where you are is nowhere on screen.
//
// It does not know the router (same rule as `ui/nav.tsx` and `projects/project-rail.tsx`): `render`
// gets the class and content, the page supplies the link. That makes the workshop possible: the
// preview router has only a root route, so a `<Link to="/p/$projectId/…">` would match nothing.
import { Fragment, useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { SHELL_TEXT } from "./text/shell.js";
import "./tab-bar.css";

/** A rail row's shape (`projects/rail-sections.ts`) reduced to what the bar draws, so existing lists
 *  fit without translation. `group`, a COLUMN subheading, makes no sense laid flat. */
export type TabDef<T extends string = string> = {
  to: T;
  label: string;
  Icon: ComponentType<{ "aria-hidden"?: boolean }>;
  /** Goes up one level. Pinned left instead of scrolling with the others. */
  back?: boolean;
};

/** Outside a project, one destination: back to work (13/09).
 *
 *  System, wiki and concierge have no triage to offer the thumb, but they must offer an EXIT.
 *  Measured at 393px before the fix: `/system` rendered zero navigation elements (rail hidden by the
 *  compact breakpoint, tab bar reserved for projects). A browser has back; an installed app has no
 *  address bar, so the screen was a dead end.
 *
 *  `/` rather than a project URL: the root already knows which project to reopen (last visited,
 *  else the first). Redoing that here would be a second version of it. */
export const HOME_TAB: TabDef<"/"> = {
  to: "/",
  label: SHELL_TEXT.tabBar.home,
  Icon: LayoutGrid,
  back: true,
};

export function TabBar<T extends string>({
  rows,
  render,
  here,
}: {
  /** The list of where you are. A `back` row is pinned; the others scroll. */
  rows: readonly TabDef<T>[];
  render: (to: T, props: { className: string; children: ReactNode }) => ReactNode;
  /** The current URL. Only used to bring the lit entry into view after a navigation: the component
   *  does not know the router, so it cannot notice by itself. */
  here: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // `block: "nearest"` keeps the gesture HORIZONTAL: otherwise the browser also scrolls the page
    // to bring the bar into view, where it already is.
    // Optional call because jsdom does not implement `scrollIntoView`: the stories gate and screen
    // tests mount this bar for real, and a plain call made them fail with a `TypeError`.
    scroller.current
      ?.querySelector("[aria-current='page']")
      ?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [here]);

  const back = rows.find((r) => r.back);
  const rest = rows.filter((r) => !r.back);
  return (
    <nav className="app-tabbar" aria-label={SHELL_TEXT.tabBar.label}>
      {back &&
        render(back.to, {
          className: "app-tabbar-item app-tabbar-back",
          children: (
            <>
              <back.Icon aria-hidden={true} />
              <span className="app-tabbar-label">{back.label}</span>
            </>
          ),
        })}
      <div className="app-tabbar-scroll" ref={scroller}>
        {rest.map(({ to, label, Icon }) => (
          // A Fragment carries the key without adding a box: the caller's element must be the
          // scroller's DIRECT flex child, or the wrapper gets the width.
          <Fragment key={to}>
            {render(to, {
              className: "app-tabbar-item",
              children: (
                <>
                  <Icon aria-hidden={true} />
                  <span className="app-tabbar-label">{label}</span>
                </>
              ),
            })}
          </Fragment>
        ))}
      </div>
    </nav>
  );
}
