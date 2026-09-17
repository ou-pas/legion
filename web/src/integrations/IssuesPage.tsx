// Issues: the workspace's Linear issues turned into Legion tasks (v9). "Create task" opens a
// prefilled popup (agent, gate, run now). The issue moves to In Progress when run; "Closes ABC-123"
// in the PR body closes it.
import { useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw, Target } from "lucide-react";
import { goalsApi } from "../api/goals.js";
import {
  integrationsApi,
  type LinearIssue,
  type LinearIssueFilter,
  type LinearOptions,
} from "../api/integrations.js";
import { tasksApi } from "../api/tasks.js";
import { qk } from "../queries.js";
import { toQuery, type IssueFilters } from "./issue-filters.js";
import { IssueRow } from "./issue-row.js";
import { ISSUES_TEXT } from "./text.js";
import { useIssueFilters } from "./use-issue-filters.js";
import { Button, IconBtn } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Code } from "../ui/code.js";
import { Combobox, type ComboboxOption } from "../ui/combobox.js";
import { Empty } from "../ui/empty.js";
import { ErrorState } from "../ui/error-state.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Field } from "../ui/form.js";
import { useToast } from "../ui/toast.js";
import { List } from "../ui/list.js";
import { Page } from "../ui/page.js";
import { Panel, PanelHeader } from "../ui/panel.js";
import { SkeletonText } from "../ui/skeleton.js";
import { useProject } from "../projects/project.js";
import { QuickTaskModal } from "../tasks/quick-task-modal.js";

/** The server query cap (`first: 50`). Only used to say the displayed count may be truncated: full
 *  pagination is out of scope, and filtering at Linear makes it much less pressing. */
const PAGE_SIZE = 50;

// The filters are in the key (01/09): they travel to Linear, so changing one is another question,
// not a sort of the previous answer. `keepPreviousData` keeps the list on screen meanwhile; without
// it every filter change would go back through the skeleton.
const issuesQuery = (projectId: string, filter: LinearIssueFilter) =>
  queryOptions({
    queryKey: [
      "linear-issues",
      projectId,
      filter.assigneeId ?? "",
      filter.teamId ?? "",
      filter.state ?? "",
    ] as const,
    queryFn: () => integrationsApi.linearIssues(projectId, filter),
    enabled: projectId.length > 0,
    staleTime: 30_000,
    retry: false, // a missing key must not loop
    placeholderData: keepPreviousData,
  });

// The menus do not depend on the current filter, which keeps them from shrinking as you use them.
// A workspace changes slowly: five minutes of freshness is enough.
const optionsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["linear-options", projectId] as const,
    queryFn: () => integrationsApi.linearOptions(projectId),
    enabled: projectId.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

// The status filter is on `state` (the displayed Linear label, e.g. "Backlog", "Todo"), not on
// `stateType`: operator's decision of 21/08 (D3). `state` is free text per Linear team, so the
// options cannot be hardcoded. They come from the workspace (`optionsQuery`) since 01/09, and a
// saved value no longer there becomes a "ghost filter" (`ISSUES_TEXT.filters.unavailable`).

// oxlint-disable-next-line complexity -- a remote-data page: each on-screen block is a state of the response (loading, missing key, failure, empty, filtered empty, list), and the rest is a `?? default` per value not yet arrived
export function IssuesPage() {
  const { project, projectId } = useProject();
  const navigate = useNavigate();
  const { push } = useToast();
  // Assignee/status/team filters (v24): combinable (AND), persisted in localStorage per project.
  // Read before the query: they are part of it.
  const { filters, setDimension, reset, active } = useIssueFilters(projectId ?? "");
  const query = toQuery(filters);
  const {
    data: issues,
    error,
    isLoading,
    refetch,
    isFetching,
  } = useQuery(issuesQuery(project?.id ?? "", query));
  const { data: options, isLoading: optionsLoading } = useQuery(optionsQuery(project?.id ?? ""));
  const { data } = useQuery({ queryKey: qk.tasks, queryFn: tasksApi.tasks });
  const [creating, setCreating] = useState<LinearIssue | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // What Linear answered is the displayed list: no second filtering here.
  const shown = issues ?? [];
  // The answer is here and good: neither loading nor failed. Written once: the same condition in
  // three pieces guarded four blocks of the screen, and had already drifted.
  const answered = !isLoading && !error ? issues : undefined;

  // Prevented regression (B6): "Create a goal (N issues)" builds its payload from the full
  // selection. Without this resync, checking 3 issues then filtering 2 out would leave the button
  // announcing "3 issues" and create a goal with issues invisible on screen. Adjusted during render
  // (the React-documented pattern) rather than in an effect, which would cascade a second render
  // (oxlint react/set-state-in-effect).
  const shownKey = shown.map((i) => i.id).join(",");
  const [seenShownKey, setSeenShownKey] = useState(shownKey);
  if (shownKey !== seenShownKey) {
    setSeenShownKey(shownKey);
    const shownIds = new Set(shown.map((i) => i.id));
    const next = new Set([...selected].filter((id) => shownIds.has(id)));
    if (next.size !== selected.size) setSelected(next);
  }

  // Issues already linked to a task, so they are not recreated unknowingly.
  const linked = new Map(
    (data?.tasks ?? [])
      .filter((t) => t.externalRef)
      .map((t) => [(JSON.parse(t.externalRef!) as { issueId: string }).issueId, t.id] as const),
  );

  // The server names the missing secret: an empty state with an exit, not a failure.
  //
  // Coupled by string, and nothing checks it for us: the name tested here is the one
  // `server/src/integrations/linear.ts` puts in `NO_LINEAR_TOKEN`. The two halves share no type. If
  // the server message stops naming the secret, this screen silently falls back to the generic
  // error and the empty state loses its door.
  const message = error instanceof Error ? error.message : error ? String(error) : "";
  const missingKey = message.includes("LINEAR_TOKEN");
  // The exit moved (15/09): Linear is no longer pasted, it is connected, with one click in
  // Settings › Integrations.
  const openIntegrations = () =>
    projectId && void navigate({ to: "/p/$projectId/project/integrations", params: { projectId } });

  /** Create a goal from the selection, and refresh: on the filter row when it is there, at the top
   *  of the page otherwise (loading, error, missing key). */
  const pageActions = (
    <>
      {selected.size >= 2 && project && (
        <Button
          variant="primary"
          leading={<Target size={13} />}
          onClick={() => {
            const chosen = (issues ?? [])
              .filter((i) => selected.has(i.id))
              .map((i) => ({ identifier: i.identifier, title: i.title, url: i.url }));
            return (
              goalsApi
                .goalFromIssues({ projectId: project.id, issues: chosen })
                .then((r) =>
                  navigate({
                    to: "/p/$projectId/goals/$goalId",
                    params: { projectId: project.id, goalId: r.id },
                  }),
                )
                // Not alert(): a design contract regression, found in the 24/08 toast audit.
                .catch((e: Error) =>
                  push({ tone: "bad", title: ISSUES_TEXT.page.goalFailed, body: e.message }),
                )
            );
          }}
        >
          {ISSUES_TEXT.page.createGoal(selected.size)}
        </Button>
      )}
      <IconBtn title={ISSUES_TEXT.page.refresh} onClick={() => void refetch()} loading={isFetching}>
        <RefreshCw size={14} />
      </IconBtn>
    </>
  );

  return (
    <Page
      title={ISSUES_TEXT.page.title}
      sub={ISSUES_TEXT.page.sub}
      // The page gestures live on the filter row (04/09): since the page lost its title, a lone
      // action left an empty row.
      actions={answered === undefined ? pageActions : undefined}
    >
      <Stack gap={14}>
        {isLoading && (
          <Card>
            <SkeletonText lines={5} label={ISSUES_TEXT.page.loading} />
          </Card>
        )}

        {!isLoading && missingKey && (
          <Card>
            <Empty
              variant="panel"
              title={ISSUES_TEXT.page.noKeyTitle}
              action={
                <Button variant="primary" onClick={openIntegrations}>
                  {ISSUES_TEXT.page.noKeyAction}
                </Button>
              }
            >
              {ISSUES_TEXT.page.noKeyBefore}
              <Code>LINEAR_TOKEN</Code>
              {ISSUES_TEXT.page.noKeyAfter}
            </Empty>
          </Card>
        )}

        {!isLoading && error && !missingKey && (
          <ErrorState
            title={ISSUES_TEXT.page.failedTitle}
            detail={message}
            actions={
              <>
                <Button
                  variant="primary"
                  leading={<RefreshCw size={13} />}
                  onClick={() => refetch()}
                >
                  {ISSUES_TEXT.page.retry}
                </Button>
                <Button onClick={openIntegrations}>{ISSUES_TEXT.page.checkSecret}</Button>
              </>
            }
          >
            {ISSUES_TEXT.page.failedWhy}
          </ErrorState>
        )}

        {/* The bar stays mounted even when the answer is empty: otherwise a filter returning
            nothing would lock the screen, with no way to change or reset it. */}
        {answered && (
          <IssueFiltersBar
            filters={filters}
            options={options}
            optionsLoading={optionsLoading}
            active={active}
            onPick={setDimension}
            onReset={reset}
            actions={pageActions}
          />
        )}

        {/* Two empties, two exits: the workspace has nothing open, or the question asked of
            Linear found nothing. The second can be reset, the first cannot. */}
        {answered && answered.length === 0 && !active && (
          <Card>
            <Empty variant="panel" art="cleared" title={ISSUES_TEXT.page.emptyTitle}>
              {ISSUES_TEXT.page.emptyWhy}
            </Empty>
          </Card>
        )}

        {answered && answered.length === 0 && active && (
          <Card>
            <Empty
              variant="panel"
              art="filtered"
              title={ISSUES_TEXT.filters.emptyTitle}
              action={<Button onClick={reset}>{ISSUES_TEXT.filters.reset}</Button>}
            >
              {ISSUES_TEXT.filters.emptyWhy}
            </Empty>
          </Card>
        )}

        {shown.length > 0 && (
          // Panel, not Card: the registry clips its corners, so a row hover stays inside the radius.
          <Panel>
            <PanelHeader title={ISSUES_TEXT.list.count(shown.length, shown.length >= PAGE_SIZE)} />
            <List label={ISSUES_TEXT.list.label}>
              {shown.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  isSelected={selected.has(issue.id)}
                  onToggleSel={() => toggleSel(issue.id)}
                  isLinked={linked.get(issue.id) ?? false}
                  onCreateTask={() => setCreating(issue)}
                  projectId={projectId ?? ""}
                />
              ))}
            </List>
          </Panel>
        )}
      </Stack>
      {/* The popup belongs to the tasks domain (`tasks/quick-task-modal.tsx`) since 06/09: it was
          written here and in the Reviews screen, four labels apart. What stays here speaks of
          Linear: title, proposed name, excerpt, brief, reference, and what running will do there. */}
      {creating && (
        <QuickTaskModal
          project={project}
          title={ISSUES_TEXT.create.title(creating.identifier)}
          defaultName={ISSUES_TEXT.create.defaultName(creating.identifier, creating.title)}
          defaultGate
          preview={{
            label: ISSUES_TEXT.create.descriptionBlock(creating.identifier),
            body: creating.description || ISSUES_TEXT.create.noDescription,
          }}
          description={ISSUES_TEXT.create.brief(creating.description, creating.url).trim()}
          externalRef={{
            provider: "linear",
            issueId: creating.id,
            identifier: creating.identifier,
            url: creating.url,
          }}
          hint={ISSUES_TEXT.create.hint(creating.identifier)}
          onClose={() => setCreating(null)}
        />
      )}
    </Page>
  );
}

/** The filter bar: three combinable dimensions (AND), and the button that resets them.
 *
 *  The ghost filter (B4) is why it is a component: a saved value no longer in the workspace
 *  (someone gone, team archived, state renamed) must not read as "all", or the bar looks neutral
 *  while the list is filtered, often to zero. Until the menus answer, no value is declared a ghost:
 *  `options === undefined` would mean "everything unknown" and all three filters would show as
 *  unavailable. */
/** A filter dimension's menu, in the shape `Combobox` knows: `{ id, label }` and nothing else.
 *  "No constraint" is an option with an empty id, not a component state, so the component can
 *  ignore what a filter is.
 *
 *  The ghost entry: when the chosen value is no longer listed, the menu says so instead of showing
 *  empty. It does not appear until the workspace answers; `entries` is `undefined` until then. */
function filterMenu(
  all: string,
  entries: { id: string; name: string }[] | undefined,
  value: string,
): ComboboxOption[] {
  const known = entries ?? [];
  const ghost = value.length > 0 && entries !== undefined && !known.some((e) => e.id === value);
  return [
    { id: "", label: all },
    ...known.map((e) => ({ id: e.id, label: e.name })),
    ...(ghost ? [{ id: value, label: ISSUES_TEXT.filters.unavailable }] : []),
  ];
}

function IssueFiltersBar({
  filters,
  options,
  optionsLoading,
  active,
  onPick,
  onReset,
  actions,
}: {
  filters: IssueFilters;
  /** `undefined` until the workspace answers: a state, not an empty list. */
  options: LinearOptions | undefined;
  optionsLoading: boolean;
  active: boolean;
  onPick: (dimension: keyof IssueFilters, value: string) => void;
  onReset: () => void;
  /** The page gestures live on this row (04/09): since the page lost its title, a lone action left
   *  an empty row above. */
  actions: ReactNode;
}) {
  const assigneeValue = filters.assigneeIds[0] ?? "";
  const teamValue = filters.teamIds[0] ?? "";
  const statusValue = filters.statuses[0] ?? "";
  const assigneeMenu = filterMenu(ISSUES_TEXT.filters.all, options?.members, assigneeValue);
  const teamMenu = filterMenu(ISSUES_TEXT.filters.all, options?.teams, teamValue);
  const statusMenu = filterMenu(
    ISSUES_TEXT.filters.all,
    options?.states?.map((s) => ({ id: s, name: s })),
    statusValue,
  );

  return (
    <Row gap={10} wrap align="flex-end">
      <Field label={ISSUES_TEXT.filters.assignee}>
        <Combobox
          label={ISSUES_TEXT.filters.assignee}
          options={assigneeMenu}
          loading={optionsLoading}
          value={assigneeValue}
          onChange={(id) => onPick("assigneeIds", id)}
        />
      </Field>
      <Field label={ISSUES_TEXT.filters.status}>
        <Combobox
          label={ISSUES_TEXT.filters.status}
          options={statusMenu}
          loading={optionsLoading}
          value={statusValue}
          onChange={(id) => onPick("statuses", id)}
        />
      </Field>
      <Field label={ISSUES_TEXT.filters.team}>
        <Combobox
          label={ISSUES_TEXT.filters.team}
          options={teamMenu}
          loading={optionsLoading}
          value={teamValue}
          onChange={(id) => onPick("teamIds", id)}
        />
      </Field>
      <Spacer />
      <Button onClick={onReset} disabled={!active}>
        {ISSUES_TEXT.filters.reset}
      </Button>
      {actions}
    </Row>
  );
}
