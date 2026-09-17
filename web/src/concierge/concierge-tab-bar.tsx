// The phone bar on the concierge: one row, the exit to projects.
//
// The concierge has no sub-navigation (report and conversations share `ConciergePage`), which is
// why the rail shows nothing for it (`app/rail-slot.tsx`). But at the compact tier the rail
// disappears entirely, and without this bar the concierge was a dead end: no rail, no bar, no back
// button in an installed app (found on 16/09, the same defect System and the wiki had before their
// 13/09 fix). One target is enough to get out.
import { Link } from "@tanstack/react-router";
import { HOME_TAB, TabBar } from "../app/tab-bar.js";

export function ConciergeTabBar() {
  return (
    <TabBar
      here={HOME_TAB.to}
      rows={[HOME_TAB]}
      render={(to, props) => <Link to={to} {...props} />}
    />
  );
}
