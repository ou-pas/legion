// Knows neither the router nor the data: it lays out the geometry, nothing else.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Kbd } from "./kbd.js";
import { UI_TEXT } from "./vocabulary.js";
import { BrandMark } from "./brand-mark.js";
import "./shell.css";

/** The skip link is the page's first focusable element: without it, reaching the content by
 *  keyboard costs a full traversal of the rail on every navigation. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="ui-shell">
      <a className="ui-skip" href="#content">
        {UI_TEXT.skipToContent}
      </a>
      {children}
    </div>
  );
}

/** Where you are, global status, toggles. */
export function TopBar({ children }: { children: ReactNode }) {
  return <header className="ui-topbar">{children}</header>;
}

/** Bar tools, collapsed on phones (14/09, operator request).
 *
 *  The bar carries five families: where you are, what is waiting, the version, workstation
 *  gestures, toggles. At 393px they do not fit on one line: the bar wrapped from 44 to 95px with a
 *  lone bell on the second row. What says where you are stays visible; the rest opens with a tap.
 *
 *  A collapsible group, not a menu: the hidden tools are buttons each opening their own surface
 *  (palette, waiting panel, concierge). Nested in a menu they would stack two floating surfaces
 *  and break both focus traps.
 *
 *  It floats rather than pushing (second version, operator feedback): the first gave the group its
 *  own row and the whole screen moved down 54px to tap an icon.
 *
 *  Above the breakpoint it is `display: contents`: its children stay the bar's children, so nothing
 *  changes on a wide screen. */
export function TopBarTools({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const slot = useRef<HTMLDivElement>(null);
  // A floating surface closes when you touch elsewhere. `pointerdown`, not `click`: close as the
  // finger lands, otherwise the first tap only closes.
  //
  // Outside only: the 15/09 fix. The 14/09 version also closed on a tap inside, but the closed
  // panel is `display: none` (shell.css), so the tool vanished between `pointerdown` and
  // `pointerup` and its `click` never fired: on a phone none of the six tools was reachable. The
  // band now closes after the action, on the `click` that bubbles up (see the panel's `onClick`).
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (slot.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    // The wrapper exists to anchor the panel, only below the breakpoint; above it is
    // `display: contents` like the group it holds.
    <div className="ui-topbar-tools-slot" ref={slot}>
      <button
        type="button"
        className="ui-topbar-tools-toggle"
        aria-expanded={open}
        aria-label={UI_TEXT.topbarMoreLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis aria-hidden="true" />
      </button>
      {/* Tapping a tool closes the band, toggles included (operator decision, 14/09), but after the
          tool acted: this `click` bubbles from the button, so the palette opens or the route
          changes, then the band closes. Doing it on `pointerdown` kept the tool from acting. */}
      <div
        className="ui-topbar-tools"
        data-open={open ? "true" : undefined}
        onClick={() => setOpen(false)}
      >
        {children}
      </div>
    </div>
  );
}

/** The screen name at the head of the bar (04/09, flat mockup), same place on every route, in the
 *  title voice. `crumb` is the second segment when the screen shows an object (a task id), in mono
 *  because it is one. */
export function TopBarTitle({ crumb, children }: { crumb?: string | null; children: ReactNode }) {
  return (
    <div className="ui-topbar-title">
      {/* The page's h1 (04/09): since `Page` no longer renders its title, the screen names itself
          here, one h1 in the same place on every route. */}
      <h1 className="ui-topbar-title-name">{children}</h1>
      {crumb && (
        <span className="ui-topbar-crumb">
          <span aria-hidden="true">/</span>
          {crumb}
        </span>
      )}
    </div>
  );
}

/** Rails and content share the remaining height. `position: relative` in CSS anchors the reopen
 *  button floating over the content; anchoring on the whole shell would require knowing the
 *  topbar's height, which is not fixed. */
export function ShellBody({ children }: { children: ReactNode }) {
  return <div className="ui-shell-body">{children}</div>;
}

/** The permanent band left of the project rail (direction-double-nav mockup, variant B). It does not
 *  collapse, and that is the point: it keeps the open project's identity when the rail disappears. */
export function IconRail({
  label,
  mark,
  foot,
  children,
}: {
  label: string;
  /** The product mark, which left the bar on 04/09 so the bar names the screen. A child, not a
   *  boolean: the caller makes it a link. */
  mark?: ReactNode;
  /** What configures the workstation (system, documentation), at the bottom, away from the
   *  projects it must not be confused with. */
  foot?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <nav className="ui-iconrail" aria-label={label}>
      {mark && <div className="ui-iconrail-mark">{mark}</div>}
      {children}
      {foot && <div className="ui-iconrail-foot">{foot}</div>}
    </nav>
  );
}

/** Project navigation rail. `label` names the navigation for screen readers. Collapsed, it renders
 *  nothing: the column disappears rather than shrinking.
 *
 *  It did not collapse on purpose (26/08): collapsed to a 52px band for a day, it lost the open
 *  project's name, and in an app whose every URL is `/p/$projectId/…` that is losing where you are.
 *  The rule: a project's sub-entries may be put away, never its name. Collapsing came back on 29/08
 *  because the project identity moved to `IconRail` (slice 02). */
export function Rail({
  label = UI_TEXT.mainNav,
  collapsed = false,
  onCollapse,
  children,
}: {
  label?: string;
  collapsed?: boolean;
  /** Rendered by the rail at the bottom of the column, so a caller cannot forget it. */
  onCollapse: () => void;
  children: ReactNode;
}) {
  if (collapsed) return null;
  return (
    <nav className="ui-rail" aria-label={label}>
      {children}
      <button type="button" className="ui-rail-collapse" onClick={onCollapse}>
        <PanelLeftClose aria-hidden="true" />
        {UI_TEXT.rail.collapse}
        <Kbd keys={UI_TEXT.rail.shortcut} className="ui-rail-collapse-keys" />
      </button>
    </nav>
  );
}

/** Rendered by the shell, not the rail: it only exists when the rail does not. Both read the same
 *  `collapsed`, so both-shown or neither-shown cannot happen. `name` is what the pill shows: the open
 *  project's name. */
export function RailReopen({
  collapsed,
  name,
  onOpen,
}: {
  collapsed: boolean;
  name: string;
  onOpen: () => void;
}) {
  if (!collapsed) return null;
  return (
    // aria-label rather than the visible name alone: "Legion" does not say what the button does. It
    // contains the visible label (WCAG 2.5.3) rather than replacing it.
    <button
      type="button"
      className="ui-rail-reopen"
      onClick={onOpen}
      aria-label={UI_TEXT.rail.reopen(name)}
    >
      <PanelLeftOpen aria-hidden="true" />
      {name}
    </button>
  );
}

/** This scrolls, not the window: topbar and rail stay. `bleed` removes padding and scrolling so the
 *  page fills the area edge to edge and manages its own panes. Ordinary pages never use it. */
export function MainArea({ bleed = false, children }: { bleed?: boolean; children: ReactNode }) {
  // tabIndex -1: a skip link's target must be able to receive focus.
  return (
    <main className="ui-main" data-bleed={bleed ? "true" : undefined} id="content" tabIndex={-1}>
      {children}
    </main>
  );
}

/** Square and word in a single clickable target. */
export function Logo({ children }: { children?: ReactNode }) {
  return (
    <span className="ui-logo">
      {/* Alone, the mark must still read, since it carries the word. Same drawing as the app icon
          since 14/09: two marks for one product was one too many. */}
      <span
        className="ui-logo-mark"
        role={children ? undefined : "img"}
        aria-hidden={children ? "true" : undefined}
        aria-label={children ? undefined : "Legion"}
      >
        <BrandMark />
      </span>
      {children}
    </span>
  );
}

/** An initial, not an image: there is only one user. */
export function Avatar({ initial, name }: { initial: string; name: string }) {
  return (
    <span className="ui-avatar" title={name} aria-label={name} role="img">
      {initial}
    </span>
  );
}
