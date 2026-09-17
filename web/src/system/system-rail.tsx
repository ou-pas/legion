// System sections, in the rail rather than tabs. A tab is not a URL: no link to the logs, no back
// button. Each entry is a route, and only one screen is mounted because only one is there.
import { Link } from "@tanstack/react-router";
import { BarChart3, Cpu, ScrollText, Settings, SlidersHorizontal } from "lucide-react";
import { NavItem } from "../ui/nav.js";
import { RailHead, RailHeadMark } from "../ui/rail-head.js";
import { SYSTEM_TEXT } from "./text.js";

/** Same convention as the project rail: the router sets the active class. */
const ACTIVE = { className: "is-active" };

export const SECTIONS = [
  // First and default (02/09): General is what one checks on arriving (version, identity,
  // notifications). `SlidersHorizontal`, not `Settings`: the gear already means the PROJECT settings
  // in the bar and heads this rail, so it would draw two different things one click apart.
  //
  // `/system/general`, not `/system`: bare `/system` REDIRECTS here, so only one route renders
  // General. Two URLs for one screen is what this rail cannot follow: it lights only one.
  { to: "/system/general", label: SYSTEM_TEXT.tab.general, Icon: SlidersHorizontal },
  { to: "/system/runners", label: SYSTEM_TEXT.tab.infra, Icon: Cpu },
  { to: "/system/logs", label: SYSTEM_TEXT.tab.logs, Icon: ScrollText },
  { to: "/system/analytics", label: SYSTEM_TEXT.tab.analytics, Icon: BarChart3 },
  // No Models entry (02/09): the read-only catalog folded into General. `/systeme/modeles` redirects.
] as const;

export function SystemRailNav() {
  return (
    <>
      {/* The same head as a project rail (slice nav/06). It was a small-caps label, a SECTION
          treatment where the project had a PLACE treatment, implying system was less a place. The
          icon is the top bar's, which leads here. */}
      <RailHead
        size="lg"
        mark={
          <RailHeadMark>
            <Settings size={15} />
          </RailHeadMark>
        }
        name={SYSTEM_TEXT.title}
      />
      {SECTIONS.map((s) => (
        <NavItem
          key={s.to}
          icon={<s.Icon size={15} />}
          render={(props) => (
            // `activeOptions.exact` would be needed if an entry became the `/system` root again:
            // without it, it would also light its child sections. None is today, but `s` can carry
            // the flag.
            <Link
              to={s.to}
              activeProps={ACTIVE}
              activeOptions={{ exact: "exact" in s }}
              {...props}
            />
          )}
        >
          {s.label}
        </NavItem>
      ))}
    </>
  );
}
