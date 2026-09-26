// The channels view: a SECOND reading of the same data. It replaces neither the board nor the task
// page: it reads a task as the conversation it already is. No server route was added for it (bootstrap,
// /api/tasks, /api/inbox, the session SSE stream, artifacts and lineage).
//
// Layout (direction `docs/directions/direction-canaux-panel.html`): list, conversation and state panes,
// without collapsing the app rail, which would lose the open project's name. The page keeps viewport
// height as its own: the thread scrolls by itself, the composer sticks to the bottom.
import { useMemo, useState, type ReactNode } from "react";
import { Link as RouterLink, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, GitCompareArrows } from "lucide-react";
import { Banner } from "../ui/banner.js";
import { Button, IconButton } from "../ui/button.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Heading } from "../ui/heading.js";
import { Link } from "../ui/link.js";
import { Select } from "../ui/select.js";
import { useToast } from "../ui/toast.js";
import {
  artifactsQuery,
  bootstrapQuery,
  environmentsQuery,
  inboxQuery,
  taskLinksQuery,
  taskQuery,
  tasksQuery,
  useInvalidateLive,
} from "../queries.js";
import { SESSION_STATUS, sessionsApi } from "../api/sessions.js";
import { tasksApi } from "../api/tasks.js";
import { InboxCard } from "../inbox/inbox-card.js";
import { InterviewExit } from "../interviews/interview-exit.js";
import { countRounds, isInterviewTask } from "../interviews/interview.js";
import { SteerField } from "../sessions/steer-field.js";
import { inboxApi, type InboxItem } from "../api/inbox.js";
import { useReplyInbox } from "../queries.js";
import { useTaskEvents } from "../sessions/use-task-events.js";
import { hasPrTab, pendingPr, prUrlsOf, type PrUrl } from "../tasks/pr-state.js";
import { pushedRepos } from "../tasks/session-facts.js";
import { TASK_VIEW_PATH } from "../tasks/task-views.js";
import { ChannelDecision } from "./channel-decision.js";
import { ChannelDetails } from "./channel-details.js";
import { ChannelPreview } from "./channel-preview.js";
import { COMPACT_QUERY, useMediaQuery } from "../ui/use-media-query.js";
import { Disclosure } from "../ui/disclosure.js";
import { ChannelList } from "./channel-list.js";
import { ChannelThread } from "./channel-thread.js";
import { channelDecision } from "./decision.js";
import { liveChannels, offstage, OPERATOR, type Channel } from "./channel.js";
import { CHANNELS_TEXT } from "./text.js";
import { transcript } from "./transcript.js";
import "./channels-page.css";
import { TASK_STATUS } from "../api/tasks.js";

/** Event types changing STATE (not just the thread): only they justify invalidating lists. Same list as
 *  the task page, since it is the same stream. */
const REFRESHES = [
  "status",
  "task_status",
  "result",
  "inbox_ask",
  "inbox_answer",
  "fs_op",
  "dependency_wait",
  "dependency_resolved",
];

/** The conversation's last turn: a CARD, no longer a form (07/09). A round questionnaire is two
 *  thousand pixels: in a channel column it made a second scrollbar, fixed above the thread it crushed
 *  it. The card fits ten lines and its answer button leads to the page that has room. A text or choice
 *  question is still answered HERE: sending it to a page would be a navigation for one click. */
function ChannelQuestion({
  question,
  projectId,
  now,
  interview,
}: {
  question: InboxItem;
  projectId: string;
  now: number;
  interview: boolean;
}) {
  const reply = useReplyInbox();
  return (
    <Stack gap={8}>
      <InboxCard
        item={question}
        now={now}
        pending={reply.isPending}
        hideTaskName
        onReply={(body) => reply.mutate({ id: question.id, body })}
        render={(p) => (
          <RouterLink
            to="/p/$projectId/inbox/$inboxId"
            params={{ projectId, inboxId: question.id }}
            {...p}
          />
        )}
      />
      {/* D10: leave the interview before the agent proposes it, NEXT TO the question. Only for an
          interview task: elsewhere concluding means nothing. */}
      {interview && <InterviewExit questionId={question.id} />}
    </Stack>
  );
}

export function ChannelsPage() {
  // `strict: false`: two routes, `/channels` and `/channels/$taskId`. The open channel lives in the URL
  // (26/08), not local state: otherwise no link led back to a conversation, and a reload always
  // reopened the first one.
  const { projectId = "", taskId: routeTaskId } = useParams({ strict: false }) as {
    projectId?: string;
    taskId?: string;
  };
  const navigate = useNavigate();
  const { data } = useQuery(tasksQuery);
  const { data: inbox = [] } = useQuery(inboxQuery);
  // Frozen at mount: Date.now() during render is impure (oxlint react/purity).
  const [now] = useState(() => Date.now());

  /** Choosing a channel NAVIGATES: the URL carries the state, it does not follow it. */
  const select = (id: string) =>
    void navigate({ to: "/p/$projectId/channels/$taskId", params: { projectId, taskId: id } });

  const channels = useMemo(
    () => liveChannels(data?.tasks ?? [], data?.sessions ?? [], inbox, projectId),
    [data, inbox, projectId],
  );
  // Without a channel in the URL, open the list's first (the one waiting for you, since the list is
  // sorted by section). An unknown id (closed channel, stale link) falls back the same way instead of an
  // empty page.
  const selected = channels.find((c) => c.task.id === routeTaskId) ?? channels[0];
  const taskId = selected?.task.id;
  const counts = offstage(data?.tasks ?? [], projectId, now);

  const boardLink = (
    <Link render={(p) => <RouterLink to="/p/$projectId/board" params={{ projectId }} {...p} />}>
      {CHANNELS_TEXT.list.closedLink}
    </Link>
  );

  return (
    <div className="ch-page">
      {/* No page header (04/09): the top bar already names the screen. */}

      {/* Below 1000px the list gives way to this selector: the conversation needs the full width, but
          switching channels must stay possible. Never visible with the list: CSS decides. */}
      {channels.length > 0 && (
        <div className="ch-switch">
          <Select
            aria-label={CHANNELS_TEXT.list.label}
            value={taskId ?? ""}
            onChange={(e) => select(e.target.value)}
          >
            {channels.map((c) => (
              <option key={c.task.id} value={c.task.id}>
                {`${CHANNELS_TEXT.list.sections[c.state]} · ${c.task.name}`}
              </option>
            ))}
          </Select>
          {/* Absent without an open channel (never a disabled button explained by a `title`, project
              convention): the select's own placeholder already says there is nothing to open. */}
          {selected !== undefined && (
            <IconButton
              title={CHANNELS_TEXT.head.openTask}
              render={(p) => (
                <RouterLink
                  to="/p/$projectId/tasks/$taskId"
                  params={{ projectId, taskId: selected.task.id }}
                  {...p}
                />
              )}
            >
              <ExternalLink aria-hidden="true" />
            </IconButton>
          )}
        </div>
      )}

      <div className="ch-panel">
        <aside className="ch-aside">
          <ChannelList
            channels={channels}
            selectedId={taskId ?? null}
            onSelect={select}
            closedToday={counts.closedToday}
            later={counts.later}
            boardLink={boardLink}
          />
        </aside>

        {/* The open channel is a fragment: conversation and state are two children of `.ch-panel`
            for the grid, and everything below knows a channel is open (no `selected?.` guards). */}
        {selected === undefined ? (
          /* Without a channel this pane shows what it will become (15/09, operator request). It
             repeated the list's empty state word for word; the list keeps the message, since it is the
             empty one, and this pane draws a channel's shape. */
          <div className="ch-conv">
            <ChannelPreview />
          </div>
        ) : (
          <OpenChannel channel={selected} projectId={projectId} now={now} />
        )}
      </div>
    </div>
  );
}

/** The open channel's record: brief, artifacts, lineage, inbox archive. Nothing is fetched for the
 *  other channels (the 02/09 cut, when `tasksQuery` stopped carrying each brief).
 *
 *  The ARCHIVE (`inbox-history`) is what surrounded each past question: choices, evidence, impact.
 *  Rereading a decision needs what it RULED OUT, which thread events do not carry. */
function useChannelDossier(taskId: string) {
  // Only the BRIEF from the task record: the only text the thread shows, and the list no longer
  // carries it since 02/09.
  const { data: detail } = useQuery(taskQuery(taskId));
  const { data: artifacts = [] } = useQuery(artifactsQuery(taskId));
  const { data: links } = useQuery(taskLinksQuery(taskId));
  const { data: archive = [] } = useQuery({
    queryKey: ["inbox-history", taskId] as const,
    queryFn: () => inboxApi.taskHistory(taskId),
    staleTime: 30_000,
  });
  return { brief: detail?.description ?? "", artifacts, links, archive };
}

/** The channel header: what it is about, nothing else. Card-title scale: the h1 belongs to the page,
 *  and a 24 px title would crush the link on the same line.
 *
 *  Status, agent, model and branch are no longer here (13/09, operator feedback): the state pane
 *  (`channel-details.tsx`) always shows them, same rule as the task page (`task-header.tsx`). */
function ConvHead({ channel, projectId }: { channel: Channel; projectId: string }) {
  return (
    <header className="ch-conv-head">
      <Heading level={3} as="h2">
        {channel.task.name}
      </Heading>
      <Spacer />
      <Link
        variant="plain"
        render={(p) => (
          <RouterLink
            to="/p/$projectId/tasks/$taskId"
            params={{ projectId, taskId: channel.task.id }}
            {...p}
          />
        )}
      >
        {CHANNELS_TEXT.head.openTask}
        <ExternalLink aria-hidden="true" size={12} />
      </Link>
    </header>
  );
}

/** The composer always exists (03/09, operator request: a finished task should still take a message).
 *  The DESTINATION changes, not the presence:
 *
 *  · `running` session → steering: the runtime listens and does not restart;
 *  · otherwise → a message that amends the brief and RELAUNCHES the task.
 *
 *  It used to disappear outside `running`, leaving no recourse: an agent answering "out of scope"
 *  could neither be questioned nor asked to file the task. A channel you cannot talk in is not a
 *  conversation.
 *
 *  SECONDARY while a question waits in the band: it looked like the answer field without being one,
 *  the page's costliest confusion. */
function ChannelComposer({
  taskId,
  agentName,
  aside,
  live,
}: {
  taskId: string;
  agentName: string | undefined;
  aside: boolean;
  /** The LISTENING session's id, or `undefined`: it decides where the message goes; a runtime only
   *  listens while `running`. */
  live: string | undefined;
}) {
  const t = CHANNELS_TEXT.composer;
  return (
    <div className="ch-conv-composer">
      <SteerField
        agentName={agentName}
        className={aside ? "ch-composer-secondary" : undefined}
        placeholder={aside ? t.asidePlaceholder : live ? undefined : t.messagePlaceholder}
        onSend={(text) =>
          live ? sessionsApi.steerSession(live, text) : tasksApi.sendMessage(taskId, text)
        }
      />
    </div>
  );
}

/** The gesture where the work was read, not just the announcement of the wait. The PR link appears only
 *  on a `pr.md` draft or pushed code without an open PR: SAME rule as the task page (`pendingPr`), since
 *  duplicating it here already made it drift once. */
function DecisionFoot({
  channel,
  projectId,
  prPending,
  busy,
  onApprove,
  onRetry,
}: {
  channel: Channel;
  projectId: string;
  prPending: boolean;
  busy: boolean;
  onApprove: () => void;
  onRetry: () => void;
}) {
  return (
    <ChannelDecision
      status={channel.task.status}
      approvalGate={channel.task.approvalGate}
      failure={channel.failure}
      busy={busy}
      onApprove={onApprove}
      onRetry={onRetry}
      taskLink={
        <Link
          render={(p) => (
            <RouterLink
              to="/p/$projectId/tasks/$taskId"
              params={{ projectId, taskId: channel.task.id }}
              {...p}
            />
          )}
        >
          {CHANNELS_TEXT.head.openTask}
        </Link>
      }
      prLink={
        prPending ? (
          <Link
            render={(p) => (
              <RouterLink
                to={TASK_VIEW_PATH.pr}
                params={{ projectId, taskId: channel.task.id }}
                {...p}
              />
            )}
          >
            {CHANNELS_TEXT.decision.prDraft}
          </Link>
        ) : undefined
      }
    />
  );
}

/** The state panel's diff and PR draft link, ABSENT when `hasPrTab` finds nothing (no push, draft or
 *  PR): it would lead to an empty PR view (rule of 14/09). Out of `OpenChannel` to keep its complexity
 *  under oxlint's `complexity` gate. */
function ChannelPrDiffLink({
  projectId,
  taskId,
  artifactNames,
  prUrls,
  pushedCode,
}: {
  projectId: string;
  taskId: string;
  artifactNames: readonly string[];
  prUrls: PrUrl[];
  pushedCode: boolean;
}): ReactNode {
  if (!hasPrTab(artifactNames, prUrls, pushedCode)) return undefined;
  return (
    <Row gap={4}>
      <GitCompareArrows aria-hidden="true" size={13} />
      <Link
        render={(p) => <RouterLink to={TASK_VIEW_PATH.pr} params={{ projectId, taskId }} {...p} />}
      >
        {CHANNELS_TEXT.state.diff}
      </Link>
    </Row>
  );
}

/** The open conversation and its state: two neighbouring grid panes, one subject. Everything derives
 *  from the channel, so nothing here is optional. */
function OpenChannel({
  channel,
  projectId,
  now,
}: {
  channel: Channel;
  projectId: string;
  /** Frozen by the page: `Date.now()` during render is impure. */
  now: number;
}) {
  const { push } = useToast();
  const invalidate = useInvalidateLive();
  const { data: boot } = useQuery(bootstrapQuery);
  const { data: environments = [] } = useQuery(environmentsQuery(projectId));
  /** Approval in flight: the button disarms for the round trip. */
  const [approving, setApproving] = useState(false);
  const taskId = channel.task.id;
  const { brief, artifacts, links, archive } = useChannelDossier(taskId);
  // The whole task's thread, not only its last session (26/08): a task relaunched after failure has
  // several, and the question explaining the stop belonged to the previous one.
  const { events, sessions, stream, reconnect } = useTaskEvents(
    taskId,
    channel.session?.id,
    (type) => {
      if (REFRESHES.includes(type)) invalidate(taskId);
    },
  );
  const segments = useMemo(() => transcript(events), [events]);

  const agent = boot?.agents.find((a) => a.id === channel.task.assigneeAgentId);
  const agentName = agent?.name;
  const environment = environments.find((e) => e.id === agent?.environmentId);
  const rounds = countRounds(segments);
  // State collapses on a phone (14/09). The grid gives it an `auto` row under the conversation, so it
  // takes its CONTENT height: at 393 pixels four state cards (six hundred pixels) left the thread with
  // only its header (seen on an iPhone 16). On desktop a disclosure cost more than it hid; on a phone
  // the trade-off flips: the chevron costs one line, expanded costs the whole screen.
  const compact = useMediaQuery(COMPACT_QUERY);
  const question = channel.question ?? null;
  /** An INTERVIEW task is recognised by its agent: same thread, but the exit gesture only makes sense
   *  there (D10). */
  const interview = isInterviewTask(channel.task, agent);
  // Steering exists ONLY while `running`, the one state where a runtime listens
  // (server/src/sessions/steering.ts). Otherwise the field changes destination: the message amends the
  // brief and relaunches the task (`tasks/task-message.ts`).
  const listening = channel.session?.status === SESSION_STATUS.running;
  const live = listening ? channel.session?.id : undefined;
  /** Secondary as soon as a question waits in the band. Both states exclude each other in practice (a
   *  listening session has no open question); writing it avoids depending on that. */
  const aside = !listening && question !== null;
  // The signal is the PUSH, not `pr.md` (14/09): an interview task that pushed nothing offers neither
  // button nor link, the forge would refuse ("No commits between main and legion/…"). Computed once,
  // read by the decision band, the state panel and its diff link.
  const pushedCode = pushedRepos(events).length > 0;
  const taskPrUrls = prUrlsOf(channel.task);
  const prPending = pendingPr(taskPrUrls, pushedCode);
  /** Is there anything to decide? The action band gets NODES and cannot see they will render `null`,
   *  so the question is asked here, once. */
  const decision = channelDecision({
    status: channel.task.status,
    approvalGate: channel.task.approvalGate,
    failure: channel.failure,
  });

  const approve = () => {
    setApproving(true);
    tasksApi
      .setTaskStatus(taskId, TASK_STATUS.done)
      .then(() => invalidate(taskId))
      .catch((e: Error) =>
        push({ tone: "bad", title: CHANNELS_TEXT.decision.refused, body: e.message }),
      )
      .finally(() => setApproving(false));
  };

  /** Relaunch after a dead session. `runTask` does exactly what the task page launch does: same
   *  preflight guards, same queue. */
  const retry = () => {
    setApproving(true);
    tasksApi
      .runTask(taskId)
      .then(() => invalidate(taskId))
      .catch((e: Error) =>
        push({ tone: "bad", title: CHANNELS_TEXT.decision.retryRefused, body: e.message }),
      )
      .finally(() => setApproving(false));
  };

  return (
    <>
      <section className="ch-conv">
        <ConvHead channel={channel} projectId={projectId} />

        {/* The thread follows the bottom, the same pane as a task timeline (operator feedback,
            26/08): it lands at the bottom even when the SSE replay is already there on mount, follows
            each message, and UNHOOKS as soon as you scroll up to read. What arrives meanwhile is
            counted in a pill, one click to resume following. The thread lives in
            `channel-thread.tsx` (D9ter), also rendered by the task page Interview tab. */}
        <ChannelThread
          className="ch-conv-scroll"
          brief={brief}
          briefAuthor={OPERATOR}
          briefAt={Date.parse(channel.task.createdAt)}
          segments={segments}
          sessions={sessions}
          archive={archive}
          agentName={agentName ?? OPERATOR}
          operatorName={OPERATOR}
          notice={
            /* The stream dropped while the session works: a still thread looks like an idle
               session. Say so, with the way out. */
            listening && stream !== "live" ? (
              <Banner
                tone="wait"
                title={CHANNELS_TEXT.stream.interrupted}
                actions={
                  <Button size="sm" onClick={reconnect}>
                    {CHANNELS_TEXT.stream.reconnect}
                  </Button>
                }
              >
                {CHANNELS_TEXT.stream.interruptedWhy}
              </Banner>
            ) : undefined
          }
          pending={
            question
              ? {
                  inboxId: question.id,
                  node: (
                    <ChannelQuestion
                      question={question}
                      projectId={projectId}
                      now={now}
                      interview={interview}
                    />
                  ),
                }
              : undefined
          }
          footer={
            /* Built ONLY when there is something to decide: the action band cannot see a node will
               render `null`, and would otherwise set its region atop every conversation. */
            decision === null ? undefined : (
              <DecisionFoot
                channel={channel}
                projectId={projectId}
                prPending={prPending}
                busy={approving}
                onApprove={approve}
                onRetry={retry}
              />
            )
          }
        />

        <ChannelComposer taskId={taskId} agentName={agentName} aside={aside} live={live} />
      </section>

      {/* What a conversation cannot carry, as a THIRD pane: it fits without collapsing the rail
          (26/08). Below 1280px the grid sends it under the conversation (CSS decides). On a phone it
          is COLLAPSED, the one thing this file decides, see `compact` above. */}
      <ChannelState compact={compact}>
        <ChannelDetails
          channel={channel}
          agent={agent}
          environment={environment}
          artifacts={artifacts}
          links={links}
          rounds={rounds}
          prUrls={taskPrUrls}
          pushedCode={pushedCode}
          // Opening a PR changes the TASK (its `prUrls`), not the conversation: the usual
          // invalidation, and the channel rereads with it.
          onPrCreated={() => invalidate(taskId)}
          diffLink={
            <ChannelPrDiffLink
              projectId={projectId}
              taskId={channel.task.id}
              artifactNames={artifacts.map((a) => a.name)}
              prUrls={taskPrUrls}
              pushedCode={pushedCode}
            />
          }
          lineageLink={(id, label) => (
            <Link
              render={(p) => (
                <RouterLink
                  to="/p/$projectId/tasks/$taskId"
                  params={{ projectId, taskId: id }}
                  {...p}
                />
              )}
            >
              {label}
            </Link>
          )}
        />
      </ChannelState>
    </>
  );
}

/** Channel state, collapsed or not (14/09). A component rather than a render ternary: both branches
 *  carry the SAME twenty-prop child.
 *
 *  Collapsed it renders a native `<details>` (keyboard and touch, no state). Expanded it renders
 *  NOTHING but its child: the grid already places this pane, and a wrapper would change the layout. */
function ChannelState({ compact, children }: { compact: boolean; children: ReactNode }) {
  if (!compact) return children;
  return (
    <Disclosure summary={CHANNELS_TEXT.state.label} className="ch-details-fold" flush>
      {children}
    </Disclosure>
  );
}
