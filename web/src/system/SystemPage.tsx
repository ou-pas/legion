// System (nav work, behaviour 6): runners and infrastructure, logs, statistics, models. Visited to
// change or diagnose, never to work. These screens used to be reachable from the project rail, which
// was the defect: the rail carried two axes at once, the machine and the work.
//
// Sections are routes, not tabs: a tab is not a URL, so no link to the logs and no back button.
// They live in the rail (`system/system-rail.tsx`), and this page is only a branch point; each
// section carries its own `<Page>`. One route per section also keeps a single screen mounted, as
// `<Tabs>` did (infra refreshes every 10 s, the logs open a stream).
//
// The old routes (`/infra`, `/logs`, `/analytics`) still redirect here: links to them exist in error
// messages, and breaking them would drop paths that asked for nothing.
import { Outlet } from "@tanstack/react-router";

/** No title here: each section has its own, and "System" is written at the head of the rail. */
export function SystemPage() {
  return <Outlet />;
}
