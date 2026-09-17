// A channel's state, grouped by moment rather than column. What it holds is not read DURING the
// conversation (status, agent, model, cost, rounds, branch, deliverables, lineage, grants): it is
// checked before opening a channel or after reading it, like the wiki's backlinks under the page.
//
// Status, agent and model are here and not in the channel header (13/09, operator feedback), same
// choice as the task page since 04/09: this always-visible pane is the one place that says them.
//
// ALWAYS VISIBLE (operator feedback, 26/08): it was first a disclosure, and its title was one more
// thing to read to reach three numbers. A disclosure is justified when what it hides is long or rare.
import type { ReactNode } from "react";
import type { Agent } from "../api/agents.js";
import type { Environment } from "../api/environments.js";
import type { Artifact, TaskLink, TaskLinks } from "../api/tasks.js";
import { Chip, StatusChip, Tag } from "../ui/chip.js";
import { Disclosure } from "../ui/disclosure.js";
import { Ellipsis } from "../ui/ellipsis.js";
import { Row, Stack } from "../ui/flex.js";
import { KeyValue, KeyValueList } from "../ui/key-value.js";
import { Caption, Label, Text } from "../ui/text.js";
import { CostValue } from "../sessions/cost.js";
import { ArtifactChip } from "../tasks/artifact-chip.js";
import { taskBranch } from "../tasks/task-branch.js";
import { PrActions } from "../review/pr-actions.js";
import { PrRepairNotice } from "../review/pr-repair.js";
import type { PrUrl } from "../tasks/pr-state.js";
import { TASK_CHIP } from "../tasks/task-status.js";
import { TASK_TEXT } from "../tasks/text/vocabulary.js";
import { TASK_LINKS_TEXT } from "../tasks/text/task-links.js";
import type { Channel } from "./channel.js";
import { CHANNELS_TEXT } from "./text.js";
import "./channel-details.css";
import { NETWORKING } from "../api/environments.js";

const T = CHANNELS_TEXT.state;

/** A footer column: its name, then its content. The same gesture four times makes the footer read as
 *  one row rather than four boxes. */
function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ch-details-col">
      <Label as="div" className="ch-details-col-head">
        {title}
      </Label>
      {children}
    </section>
  );
}

/** Deposits shown before the disclosure. Four fits without the column outgrowing its neighbours;
 *  beyond, lineage becomes the tallest and pushes the more often checked grants out of view. */
const LINEAGE_SHOWN = 4;

/** A lineage task (13/09). `TaskLink` carries STATUS and BLOCKING prerequisite, and the rail kept only
 *  the name in an underlined link: you could not tell whether a deposit still slept in Later or was
 *  done, the only question one asks here.
 *
 *  TWO lines, not one. The column goes down to 190px (`auto-fit minmax`), about thirty characters per
 *  line: titles only stay distinguishable while they start differently. Two lines keep them
 *  identifiable.
 *
 *  The `Ellipsis` tooltip is a COMFORT, never the only way to read: it opens only on real overflow,
 *  and touch has no hover. */
function LineageRow({
  link,
  lineageLink,
}: {
  link: TaskLink;
  lineageLink?: (taskId: string, label: ReactNode) => ReactNode;
}) {
  return (
    <div className="ch-lineage-row">
      {lineageLink?.(link.id, <Ellipsis lines={2}>{link.name}</Ellipsis>) ?? (
        <Ellipsis lines={2}>{link.name}</Ellipsis>
      )}
      <Row gap={4} wrap className="ch-lineage-marks">
        {/* Prerequisite BEFORE status, same order as the wide panel: it changes what one does with
            the row, status only describes it. */}
        {link.blocksParent && (
          <Chip size="sm" kind="st-wait" title={TASK_LINKS_TEXT.prerequisiteWhy}>
            {TASK_LINKS_TEXT.prerequisite}
          </Chip>
        )}
        <StatusChip state={TASK_CHIP[link.status]} size="sm">
          {TASK_TEXT.status[link.status]}
        </StatusChip>
      </Row>
    </div>
  );
}

/** Lineage: the task that produced this channel, those it produced. The link comes from the page (no
 *  router here). Without parent or child, SAY so.
 *
 *  The verb is a subheading since 13/09: it was repeated on each row, eight times for eight deposits.
 *  The room goes to the name and its marks. */
function Lineage({
  links,
  lineageLink,
}: {
  links?: TaskLinks;
  lineageLink?: (taskId: string, label: ReactNode) => ReactNode;
}) {
  const children = links?.children ?? [];
  if (!links?.parent && children.length === 0)
    return (
      <Text size="sm" tone="muted" as="p">
        {T.noLineage}
      </Text>
    );

  const shown = children.slice(0, LINEAGE_SHOWN);
  const rest = children.slice(LINEAGE_SHOWN);

  return (
    <Stack gap={8}>
      {links?.parent && (
        <div className="ch-lineage-group">
          <Label as="div">{T.parent}</Label>
          <LineageRow link={links.parent} lineageLink={lineageLink} />
        </div>
      )}

      {children.length > 0 && (
        <div className="ch-lineage-group">
          <Row gap={4} className="ch-lineage-head">
            <Label as="div">{T.child}</Label>
            {/* The count ONLY when there is something to count: "1" next to a single row answers
                no question. */}
            {children.length > 1 && <Caption tone="subtle">{children.length}</Caption>}
          </Row>
          {shown.map((c) => (
            <LineageRow key={c.id} link={c} lineageLink={lineageLink} />
          ))}
          {rest.length > 0 && (
            <Disclosure flush summary={<Caption>{T.lineageMore(rest.length)}</Caption>}>
              {rest.map((c) => (
                <LineageRow key={c.id} link={c} lineageLink={lineageLink} />
              ))}
            </Disclosure>
          )}
        </div>
      )}
    </Stack>
  );
}

/** Channel grants: what the agent can read, reach and decrypt. Without an agent none of it is decided,
 *  and the column says so. */
function Rights({ agent, environment }: { agent?: Agent; environment?: Environment }) {
  const secrets = JSON.parse(agent?.envSecretNames ?? "[]") as string[];
  const repos = JSON.parse(agent?.repoNames ?? "[]") as string[];
  return (
    <KeyValueList variant="aligned" density="compact">
      <KeyValue label={T.keys.repos}>
        {agent
          ? `${T.repoAccess[agent.repoAccess]}${repos.length ? ` · ${repos.length}` : ""}`
          : T.noAgent}
      </KeyValue>
      <KeyValue label={T.keys.network}>
        {environment === undefined
          ? T.networkNone
          : environment.networking === NETWORKING.open
            ? T.networkOpen
            : T.networkLimited(environment.allowedHosts.length)}
      </KeyValue>
      <KeyValue label={T.keys.secrets}>
        {secrets.length === 0 ? (
          <Text size="sm" tone="muted">
            {T.noSecrets}
          </Text>
        ) : (
          <Row gap={4} wrap>
            {secrets.map((s) => (
              <Chip key={s} size="sm" mono>
                {s}
              </Chip>
            ))}
          </Row>
        )}
      </KeyValue>
    </KeyValueList>
  );
}

export function ChannelDetails({
  channel,
  agent,
  environment,
  artifacts,
  links,
  rounds,
  lineageLink,
  diffLink,
  prUrls = [],
  pushedCode = false,
  onPrCreated,
}: {
  channel: Channel;
  agent?: Agent;
  /** The agent's network environment; absent = none, so nothing open by contract. */
  environment?: Environment;
  artifacts: Artifact[];
  links?: TaskLinks;
  /** Questions the agent asked in this channel. */
  rounds: number;
  /** A lineage link; the router belongs to the composing page. */
  lineageLink?: (taskId: string, label: ReactNode) => ReactNode;
  diffLink?: ReactNode;
  /** The task's PRs as the page already knows them (`prUrlsOf`). Passed, not reread: two readings of
   *  one list would end up a render apart. */
  prUrls?: PrUrl[];
  /** Was code pushed by a session of the task? It arms the open button (`pendingPr`); `pr.md` alone is
   *  no longer enough since 14/09. */
  pushedCode?: boolean;
  /** What to refresh when a PR was just opened from this panel. */
  onPrCreated?: () => void;
}) {
  const { task, session } = channel;
  const branch = taskBranch(task);

  return (
    <section className="ch-details" aria-label={T.label}>
      <div className="ch-details-grid">
        {/* Status, agent and model are HERE (13/09, operator feedback), not in the channel header,
            which repeated what this pane always shows. Same rule as the task page. */}
        <Column title={T.cards.state}>
          <KeyValueList variant="aligned" density="compact">
            <KeyValue label={T.keys.status}>
              <StatusChip
                state={
                  channel.state === "running"
                    ? "run"
                    : channel.state === "waiting"
                      ? "wait"
                      : "idle"
                }
              >
                {CHANNELS_TEXT.head.state[channel.state]}
              </StatusChip>
            </KeyValue>
            <KeyValue label={T.keys.agent}>
              {agent ? (
                <Chip>{agent.name}</Chip>
              ) : (
                <Text size="sm" tone="muted">
                  {T.noAgent}
                </Text>
              )}
            </KeyValue>
            <KeyValue label={T.keys.model}>
              {session ? (
                <Tag>{session.model}</Tag>
              ) : (
                <Text size="sm" tone="muted">
                  {T.noModel}
                </Text>
              )}
            </KeyValue>
            <KeyValue label={T.keys.cost}>
              {typeof session?.costUsd === "number" ? (
                <CostValue usd={session.costUsd} tone="default" />
              ) : (
                <Text size="sm" tone="muted">
                  {T.noCost}
                </Text>
              )}
            </KeyValue>
            <KeyValue label={T.keys.rounds}>{rounds}</KeyValue>
            <KeyValue label={T.keys.branch}>
              {/* `null` = never set (slice nav/15). Like the unmeasured cost above: SAY it, no empty
                  chip. */}
              {branch ? (
                <Chip size="sm" mono>
                  {branch}
                </Chip>
              ) : (
                <Text size="sm" tone="muted">
                  {T.noBranch}
                </Text>
              )}
            </KeyValue>
          </KeyValueList>
        </Column>

        <Column title={T.cards.deliverables}>
          <Stack gap={6}>
            {/* The artifact chip belongs to the tasks domain; the channel reuses it. Without
                `onSelect` it stays inert: the preview is on the task page. */}
            {artifacts.length === 0 ? (
              <Text size="sm" tone="muted" as="p">
                {T.noArtifacts}
              </Text>
            ) : (
              <Row gap={6} wrap>
                {artifacts.map((a) => (
                  <ArtifactChip key={a.name} name={a.name} sizeBytes={a.size} kind={a.kind} />
                ))}
              </Row>
            )}
            {/* The PR and its gestures, HERE (14/09, operator request): from the channel it took
                three screens for one button. The block is shared with the PR view
                (`review/pr-actions.tsx`). The diff link is a child: it reads between the PR state and
                its gestures, not after. */}
            <PrActions
              taskId={task.id}
              prUrls={prUrls}
              pushedCode={pushedCode}
              onCreated={onPrCreated ?? (() => {})}
            >
              {diffLink}
            </PrActions>
            {/* The sentence saying what a repair costs left the button on 15/09 so the row fits a
                title bar. It follows the block here: a click relaunches a session, and that fact must
                not disappear from either screen. */}
            <PrRepairNotice taskId={task.id} prUrls={prUrls} />
          </Stack>
        </Column>

        <Column title={T.cards.lineage}>
          <Lineage links={links} lineageLink={lineageLink} />
        </Column>

        <Column title={T.cards.rights}>
          <Rights agent={agent} environment={environment} />
        </Column>
      </div>
    </section>
  );
}
