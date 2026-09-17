// An agent question, IN the thread. Three faces. An ALREADY answered question collapses by itself with
// its answers summarised (25/08: rereading a three-round interview no longer takes two screens). An
// open question RAISED into the action band is a one-line pointer: the thread keeps the trace that
// something happened there, without offering a second place to answer. An open question not raised
// keeps its panel and text.
import { MessageCircleQuestionMark } from "lucide-react";
import { Chip, StatusChip } from "../ui/chip.js";
import { Disclosure } from "../ui/disclosure.js";
import { Row, Stack } from "../ui/flex.js";
import { Panel, PanelHeader } from "../ui/panel.js";
import { Prose } from "../ui/prose.js";
import { Caption, Text } from "../ui/text.js";
import type { InboxHistoryEntry } from "../api/inbox.js";
import { readAnswer } from "./answer.js";
import { ChannelRoundArchive } from "./channel-round-archive.js";
import { CHANNELS_TEXT } from "./text.js";
import "./channel-round.css";

/** A form value, reread as a word. A boolean is an answer, not a `true`. */
const word = (v: unknown): string =>
  typeof v === "boolean" ? (v ? CHANNELS_TEXT.round.yes : CHANNELS_TEXT.round.no) : String(v);

export function ChannelRound({
  question,
  answer,
  answeredTime,
  promoted = false,
  archive,
}: {
  question: string;
  /** `null` = the question is still open. */
  answer: string | null;
  /** The OPEN question is raised into the action band. Its chronological place stays marked but
   *  shrinks to a pointer: one question, one place to answer. Asking it twice on screen was exactly
   *  what made the page unreadable. */
  promoted?: boolean;
  /** The matching archive entry when available: offered choices, evidence, impact (thread events only
   *  carry two texts). Optional: a round must stay readable before the archive loads. */
  archive?: InboxHistoryEntry;
  /** Answer time, already formatted. */
  answeredTime?: string;
}) {
  if (answer === null && promoted) {
    // A muted `Caption` and nothing more: a pointer, not a thread object. A frame would compete with
    // the band.
    return <Caption as="p">{CHANNELS_TEXT.round.promoted}</Caption>;
  }
  if (answer === null) {
    return (
      <Panel className="ch-round">
        <PanelHeader
          icon={<MessageCircleQuestionMark />}
          title={CHANNELS_TEXT.round.title}
          actions={<StatusChip state="wait">{CHANNELS_TEXT.round.pending}</StatusChip>}
        />
        <div className="ch-round-body">
          <Prose>{question}</Prose>
        </div>
      </Panel>
    );
  }

  const read = readAnswer(answer);
  const count = read.free ? 1 : read.fields.length;
  return (
    <Disclosure
      className="ch-round-answered"
      flush
      summary={
        <Caption as="span">
          <b>{CHANNELS_TEXT.round.title}</b>
          {" · "}
          {CHANNELS_TEXT.round.answered(count, answeredTime ?? "")}
        </Caption>
      }
    >
      <Stack gap={8} className="ch-round-body">
        <Prose>{question}</Prose>
        <Row gap={6} wrap>
          {read.free !== null ? (
            <Chip>{read.free}</Chip>
          ) : (
            read.fields.map((v, i) => <Chip key={i}>{word(v)}</Chip>)
          )}
        </Row>
        {archive && <ChannelRoundArchive entry={archive} />}
        {read.notes.map((n, i) => (
          <Text key={i} size="sm" tone="muted" as="p">
            <b>{CHANNELS_TEXT.round.note}</b>
            {" — "}
            {n}
          </Text>
        ))}
      </Stack>
    </Disclosure>
  );
}
