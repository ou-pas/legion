// The bar: identity, machine state, what awaits a decision, search, wiki, system
// (direction-double-nav mockup, variant B, behaviours 4, 5 and 7).
//
// It received everything global the rail lost on 29/08: the rail carried two axes at once, and
// every glance meant sorting what belonged to the open project from what belonged to the
// workstation. The rail keeps only the project.
//
// It lives in `app/`, not a domain: it NAMES inbox, infra, sessions and wiki without belonging to
// any (CLAUDE.md arbitration rule: several domains → the screen composing them). `ui/shell.tsx` only
// provides the strip.
//
// It also carried the open project's quota window, removed on 30/08: the percentage was only
// readable with a credential from a normal login, while the control plane token comes from
// `claude setup-token` and is refused on every path. A gauge measuring only some accounts must be
// interpreted before being believed.
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, Container, RefreshCw } from "lucide-react";
import type { Infra } from "../api/infra.js";
import { ACTIVE_STATES } from "../sessions/session-status.js";
import { infraQuery, tasksQuery } from "../queries.js";
import { versionQueryOptions } from "../infra/version-query.js";
import { Popover } from "../ui/popover.js";
import { Tooltip } from "../ui/tooltip.js";
import { RunnersStatusCard } from "../infra/runners-status-card.js";
import { SHELL_TEXT } from "./text/shell.js";
import "./top-bar.css";

/** The status group, wired. The figures describe the MACHINE across projects: they never change
 *  with the project, and nothing here takes a `projectId`. `updating` (02/09) comes from the SAME
 *  `/api/version` query as the version chip and panel (`infra/version-query.ts`): one cache key,
 *  one polling rhythm. */
export function TopBarStatus({ pendingSlot }: { pendingSlot?: ReactNode }) {
  const { data: tasks } = useQuery(tasksQuery);
  const { data: infra } = useQuery(infraQuery);
  const { data: version } = useQuery(versionQueryOptions);
  const sessions = (tasks?.sessions ?? []).filter((s) => ACTIVE_STATES.includes(s.status)).length;
  return (
    <StatusGroup
      sessions={sessions}
      pendingSlot={pendingSlot}
      docker={infra?.blocker ?? null}
      runners={infra?.runners}
      updating={version?.updating ?? false}
    />
  );
}

/** The same group without network: the form stories show. */
export function StatusGroup({
  sessions,
  pendingSlot,
  docker,
  runners,
  updating = false,
}: {
  sessions: number;
  /** The pending inbox, second, right before Docker (operator request, 02/09). A SLOT, not a count:
   *  the inbox button belongs to the inbox domain (it opens the decisions panel), and the bar
   *  COMPOSES it without knowing it, same arbitration rule as the rest of `app/`. */
  pendingSlot?: ReactNode;
  /** `null` = nothing prevents a session from starting. */
  docker: Infra["blocker"];
  runners?: Infra["runners"];
  /** A control plane update is running NOW (02/09). True for the whole gesture, whether on the
   *  Version panel or anywhere else: the pill survives a page change, unlike the local probe it
   *  replaces for this use. */
  updating?: boolean;
}) {
  const navigate = useNavigate();
  const docked = dockerWords(docker);
  return (
    // A native `title` would be invisible for a second and absent from the keyboard: the bar says
    // things that must be QUERYABLE, hence the app's single tooltip (ui/tooltip.tsx).
    <div className="topbar-status" role="group" aria-label={SHELL_TEXT.topbar.status}>
      <Tooltip label={SHELL_TEXT.topbar.sessionsTitle}>
        <span className="topbar-status-item">
          <Activity className="topbar-status-icon" aria-hidden="true" />
          <span
            className="topbar-status-indicator"
            data-status={sessions > 0 ? "run" : "off"}
            aria-hidden="true"
          />
          <span className="topbar-status-count">{sessions}</span>
          <span className="ui-sr">{SHELL_TEXT.topbar.sessionsTitle}</span>
        </span>
      </Tooltip>
      {pendingSlot}
      <Popover
        label={docked.title}
        trigger={
          <span className="topbar-status-item" aria-label={docked.label}>
            <Container className="topbar-status-icon" aria-hidden="true" />
            <span
              className="topbar-status-indicator"
              data-status={docked.status}
              aria-hidden="true"
            />
            <span className="ui-sr">{docked.label}</span>
          </span>
        }
        openOn="hover"
        side="bottom"
        align="end"
        className="topbar-docker-popover"
        triggerClassName="topbar-docker-trigger"
      >
        {runners && runners.length > 0 && (
          <RunnersStatusCard
            runners={runners}
            onNavigate={() => navigate({ to: "/system/runners" })}
          />
        )}
      </Popover>
      {updating && (
        <Tooltip label={SHELL_TEXT.topbar.updatingTitle}>
          <span className="topbar-status-item">
            <RefreshCw className="topbar-status-icon" aria-hidden="true" />
            <span className="topbar-status-indicator" data-status="wait" aria-hidden="true" />
            <span className="ui-sr">{SHELL_TEXT.topbar.updating}</span>
          </span>
        </Tooltip>
      )}
    </div>
  );
}

function dockerWords(blocker: Infra["blocker"]) {
  if (blocker === "daemon")
    return {
      label: SHELL_TEXT.topbar.dockerDown,
      status: "bad",
      title: SHELL_TEXT.topbar.dockerDownTitle,
    };
  if (blocker === "image")
    return {
      label: SHELL_TEXT.topbar.dockerImage,
      status: "wait",
      title: SHELL_TEXT.topbar.dockerImageTitle,
    };
  return {
    label: SHELL_TEXT.topbar.dockerOk,
    status: "ok",
    title: SHELL_TEXT.topbar.dockerOkTitle,
  };
}
