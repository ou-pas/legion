// The phone bar in System: the rail's sections laid flat, preceded by the exit to projects. The exit
// is required: at the compact breakpoint the rail is hidden and an installed app has no back button,
// so System was a dead end (measured at 393px on 13/09: zero navigation elements).
import { Link, useRouterState } from "@tanstack/react-router";
import { HOME_TAB, TabBar } from "../app/tab-bar.js";
import { SECTIONS } from "./system-rail.js";

const ACTIVE = { className: "is-active" };

export function SystemTabBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <TabBar
      here={pathname}
      rows={[HOME_TAB, ...SECTIONS]}
      render={(to, props) => <Link to={to} activeProps={ACTIVE} {...props} />}
    />
  );
}
