// What the rail shows, and whether it shows.
//
// The rule: the rail carries the navigation of WHERE YOU ARE. In a project, its menu; in system, its
// sections; in the wiki, its pages; nowhere in particular (the no-project screen), nothing, and no
// reopen pill either, since there is nothing to reopen.
//
// A first version merely HID the rail on global pages. That gave the width back but left two
// navigation mechanisms for the same job: tabs INSIDE pages and a rail AROUND them. Filling the rail
// kills one, and each entry becomes a real route, so a link you can send and a back button that
// means something.
//
// Collapse state does not belong here: it says how a context is viewed, not which one. Collapsing it
// in system and finding it collapsed back in a project is expected (`ui/use-rail.ts`).
import type { ReactNode } from "react";
import { Rail, RailReopen } from "../ui/shell.js";

/** The five cases, `null` included: it removes the rail AND its pill. `"concierge"` shows NOTHING
 *  more in the rail than `null` (the concierge has no sub-navigation), but on phones it carries an
 *  exit `null` does not: telling them apart lets `TabBarSlot` (router.tsx) know without rereading
 *  the path. */
export type RailSection = "project" | "system" | "wiki" | "concierge" | null;

/** The path decides, nothing else. A PURE function rather than a `useMatchRoute` per case: a
 *  five-line table reads and tests at once, a chain of route matches does not.
 *
 *  `/infra`, `/logs`, `/analytics` and `/systeme` redirect to `/system` (nav work, batch 5, 12/09),
 *  but the redirect runs in a `beforeLoad`, so these paths exist for an instant, and a flickering
 *  rail costs more than a table row. */
export function railSectionOf(pathname: string): RailSection {
  if (pathname.startsWith("/p/")) return "project";
  if (
    ["/system", "/systeme", "/infra", "/logs", "/analytics"].some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  )
    return "system";
  if (pathname === "/wiki" || pathname.startsWith("/wiki/")) return "wiki";
  // The concierge is a page without sub-navigation (brief and conversation list share one screen):
  // same rail as `null`. But on phones, where the rail disappears, the page became a dead end
  // (16/09: no rail, no tab bar, no back button in an installed app). `"concierge"` stays distinct
  // from `null` so the bottom bar offers the exit the rail does not need to show.
  if (pathname === "/concierge" || pathname.startsWith("/concierge/")) return "concierge";
  return null;
}

/** The rail and its pill, or neither. `nav` at `null` is the "nowhere" case: both disappear together
 *  because they read the same absence, which makes reopening a rail with nothing to show impossible. */
export function RailSlot({
  nav,
  collapsed,
  name,
  onToggle,
}: {
  nav: ReactNode | null;
  collapsed: boolean;
  /** What the pill shows: the open context's name, not the product's. */
  name: string;
  onToggle: () => void;
}) {
  if (nav === null) return null;
  return (
    <>
      {/* Before the rail in the DOM: below 900px the shell stacks, and the pill must read where the
          rail was, not after the content. */}
      <RailReopen collapsed={collapsed} name={name} onOpen={onToggle} />
      <Rail collapsed={collapsed} onCollapse={onToggle}>
        {nav}
      </Rail>
    </>
  );
}
