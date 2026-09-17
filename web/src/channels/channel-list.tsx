// The LIVE channel list, in the page, never in the app rail. Three sections in reading order: what
// waits for you, what works, what sleeps. Under the list, what it does NOT show (today's closed
// conversations and the backlog): without those numbers a short list looks like a failure.
//
// Pure presentation: no API, no navigation. The board link is a slot, selection a callback.
import { Fragment, type ReactNode } from "react";
import { Activity, MessageCircleQuestionMark, PauseCircle, Stamp } from "lucide-react";
import { Badge, Chip } from "../ui/chip.js";
import { Empty } from "../ui/empty.js";
import { Stack } from "../ui/flex.js";
import { List, ListItem } from "../ui/list.js";
import { Caption, Label } from "../ui/text.js";
import {
  groupWaitingByQuestion,
  SECTION_ORDER,
  type Channel,
  type ChannelState,
  type WaitingEntry,
} from "./channel.js";
import { CHANNELS_TEXT } from "./text.js";
import "./channel-list.css";

const ICON: Record<ChannelState, ReactNode> = {
  waiting: <MessageCircleQuestionMark />,
  running: <Activity />,
  idle: <PauseCircle />,
};

/** Two ways of waiting, two marks: a question is answered, a gate approved. The MARK distinguishes,
 *  never the row geometry (rule 15). */
const mark = (c: Channel): ReactNode =>
  c.state === "waiting" && !c.question ? <Stamp /> : ICON[c.state];

export function ChannelList({
  channels,
  selectedId,
  onSelect,
  closedToday,
  later,
  boardLink,
}: {
  channels: Channel[];
  selectedId: string | null;
  onSelect: (taskId: string) => void;
  closedToday: number;
  later: number;
  /** A slot: this list does not know the router. */
  boardLink?: ReactNode;
}) {
  return (
    <nav className="ch-list" aria-label={CHANNELS_TEXT.list.label}>
      {channels.length === 0 ? (
        <Empty variant="panel" art="cleared" title={CHANNELS_TEXT.list.empty.title}>
          {CHANNELS_TEXT.list.empty.body}
        </Empty>
      ) : (
        SECTION_ORDER.map((state) => {
          const group = channels.filter((c) => c.state === state);
          if (group.length === 0) return null;
          // Grouping only makes sense for what awaits an answer; the other sections stay flat.
          const entries: WaitingEntry[] =
            state === "waiting"
              ? groupWaitingByQuestion(group)
              : group.map((c) => ({ kind: "single", channel: c }));
          return (
            <section key={state} className="ch-list-section">
              <Label as="div" className="ch-list-section-head">
                {CHANNELS_TEXT.list.sections[state]}
                <span className="ch-list-section-count">{group.length}</span>
              </Label>
              <List density="compact">
                {entries.map((entry) =>
                  entry.kind === "single" ? (
                    row(entry.channel)
                  ) : (
                    <Fragment key={`g:${entry.channels.map((c) => c.task.id).join(",")}`}>
                      <Label as="div" className="ch-list-group-head" tone="wait">
                        {CHANNELS_TEXT.list.group(entry.channels.length)}
                      </Label>
                      {entry.channels.map((c) => row(c))}
                    </Fragment>
                  ),
                )}
              </List>
            </section>
          );

          /** A channel row, used alone and within a group. */
          function row(c: Channel) {
            return (
              <ListItem
                key={c.task.id}
                as="button"
                selected={c.task.id === selectedId}
                className="ch-list-item"
                onClick={() => onSelect(c.task.id)}
                leading={
                  <span className="ch-list-mark" data-state={c.state}>
                    {mark(c)}
                  </span>
                }
                meta={
                  c.question ? (
                    <Badge count={1} tone="wait" label={CHANNELS_TEXT.head.state.waiting} />
                  ) : c.gate ? (
                    <Chip size="sm" kind="st-gate">
                      {CHANNELS_TEXT.list.gate}
                    </Chip>
                  ) : undefined
                }
                title={c.task.name}
                // An excerpt of the question, not just "waiting". Truncated to one line by
                // `ListItem` CSS (.ui-list-sub), like the title.
                sub={c.question ? <Caption>{c.question.body}</Caption> : undefined}
              />
            );
          }
        })
      )}
      <Stack gap={4} className="ch-list-foot">
        {closedToday > 0 && (
          <Caption as="div">
            <b>{CHANNELS_TEXT.list.closed(closedToday)}</b> {CHANNELS_TEXT.list.closedWhy}
          </Caption>
        )}
        {/* Nothing to say when the backlog is empty: "0 tasks in Later" informs of nothing. */}
        {later > 0 && (
          <Caption as="div">
            {CHANNELS_TEXT.list.later(later)}
            {CHANNELS_TEXT.list.laterWhy}
          </Caption>
        )}
        {boardLink}
      </Stack>
    </nav>
  );
}
