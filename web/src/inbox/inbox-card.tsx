// A question card (07/09): the ONLY rendering of a question outside its page. A multi-field form has no
// room in a channel column nor under a scrolling thread: the dedicated page asks, every other surface
// LEADS there (operator decision, 07/09).
//
// One fixed grammar across four frames (channel thread, task page, inbox list, waiting panel). Header:
// who asks, which round, since when; body: the title and what is decided; footer: the gesture. States
// change BODY and FOOTER, never the shape, so a question is recognised before being read.
//
// The threshold lives in `round-shape.ts`: a `form` of at least two fields → the page; `text`, `choice`
// and a one-field `form` → answered in place.
//
// It does not know the ROUTER: the main gesture arrives through `render`, as in `pending-panel.tsx` and
// `projects/project-rail.tsx`, so stories need no router.
import { useState, type ReactElement, type ReactNode } from "react";
import { AlarmClock, Hourglass, MessageCircleQuestionMark } from "lucide-react";
import { INBOX_KIND, type InboxItem } from "../api/inbox.js";
import { usePickedAttachments } from "../tasks/use-picked-attachments.js";
import { Button } from "../ui/button.js";
import { StatusChip, Tag } from "../ui/chip.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { humanDuration } from "../ui/duration.js";
import { LOCALE } from "../ui/locale.js";
import { ProgressBar } from "../ui/meter.js";
import { OptionList } from "../ui/option-list.js";
import { Caption, Text } from "../ui/text.js";
import { choiceLayout } from "./choice-layout.js";
import { InboxQuestionnaire } from "./inbox-questionnaire.js";
import { InboxReplyField } from "./inbox-reply-field.js";
import { answerRows, type AnswerRow, type RoundValues } from "./inbox-round-answers.js";
import { formFieldsOf, isRoundForm } from "./round-shape.js";
import { INBOX_TEXT } from "./text.js";
import "./inbox-card.css";

const T = INBOX_TEXT.card;

/** "19:00": a planned wake-up time, or an answer's time. */
const AT_TIME = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });

/** The main gesture, provided by the frame. Same contract as `pending-panel.tsx`: the card computes
 *  label and accessible name, the caller decides where it leads. Without `render` the gesture does not
 *  render: a story card is not a fake button. */
export interface CardActionRender {
  (props: { className: string; children: ReactNode; "aria-label": string }): ReactElement;
}

/** The SENT answer, when the frame has it (the channel thread reads it from its archive). Absent
 *  elsewhere: `/api/inbox` is a queue of open items. */
export type InboxCardAnswer = {
  rows: AnswerRow[];
  comment: string | null;
  answeredAt: number | null;
};

/** The first three answers, then a count. Beyond that one opens rather than rereads. */
const PREVIEW = 3;

/** What the right pill says, the TRIAGE information deciding answer order. A function rather than JSX
 *  ternaries, so each case narrows `wakeAt` itself instead of needing a non-null assertion. */
function CardStatus({
  item,
  answer,
  now,
}: {
  item: InboxItem;
  answer: InboxCardAnswer | null;
  now: number;
}) {
  if (answer) {
    const when = answer.answeredAt;
    return (
      <StatusChip state="ok">
        {when === null ? T.answeredNow : T.answeredAt(AT_TIME.format(new Date(when)))}
      </StatusChip>
    );
  }
  if (item.waitForTaskId !== null) {
    return (
      <StatusChip state="idle" dot={false}>
        {T.sleeping(humanDuration(now - item.createdAt))}
      </StatusChip>
    );
  }
  if (item.wakeAt !== null) {
    return (
      <StatusChip state="idle" dot={false}>
        {T.resumesAt(AT_TIME.format(new Date(item.wakeAt)))}
      </StatusChip>
    );
  }
  return (
    <StatusChip state="wait">
      {INBOX_TEXT.item.waiting(humanDuration(now - item.createdAt))}
    </StatusChip>
  );
}

function AnswerPreview({ rows }: { rows: AnswerRow[] }) {
  const given = rows.filter((r) => r.value !== null);
  if (given.length === 0) return null;
  const rest = given.length - PREVIEW;
  return (
    <dl className="inbox-card-answers">
      {given.slice(0, PREVIEW).map((r) => (
        <div key={r.index} className="inbox-card-answer">
          <dt>{`${r.index} · ${r.label}`}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
      {rest > 0 && (
        <div className="inbox-card-answer" data-more="true">
          <dt>{T.more(rest)}</dt>
          <dd />
        </div>
      )}
    </dl>
  );
}

/** The gauge and its count, the same in all four frames. */
function Progress({ answered, total }: { answered: number; total: number }) {
  return (
    <span className="inbox-card-count">
      <ProgressBar
        bare
        name={T.progressLabel}
        value={answered}
        max={total}
        valueText={T.progress(answered, total)}
        className="inbox-card-gauge"
      />
      {T.progress(answered, total)}
    </span>
  );
}

/** What holds the session when it awaits no answer: another task, or quota return. `null` = a real
 *  question with something to answer. */
function pauseOf(item: InboxItem): "wait" | "quota" | null {
  if (item.waitForTaskId !== null) return "wait";
  return item.wakeAt !== null ? "quota" : null;
}

/** Who asks, about what, since when. The icon follows the pause cause, in `pauseOf`'s order. The task
 *  name is omitted in a channel, whose header already carries it. */
function CardHead({
  item,
  answer,
  now,
  pause,
  round,
  hideTaskName,
}: {
  item: InboxItem;
  answer: InboxCardAnswer | null;
  now: number;
  pause: "wait" | "quota" | null;
  round: boolean;
  hideTaskName: boolean;
}) {
  return (
    <header className="inbox-card-top">
      <span className="inbox-card-icon" aria-hidden="true">
        {pause === "wait" ? (
          <Hourglass />
        ) : pause === "quota" ? (
          <AlarmClock />
        ) : (
          <MessageCircleQuestionMark />
        )}
      </span>
      <Text weight="semi">{item.agentName}</Text>
      {!hideTaskName && <Caption className="inbox-card-task">{item.taskName}</Caption>}
      {round && item.roundIndex !== null && <Caption>{T.round(item.roundIndex)}</Caption>}
      <Spacer />
      <CardStatus item={item} answer={answer} now={now} />
    </header>
  );
}

/** The means to answer, when there is something to answer. A WAIT awaits nothing from you and says so
 *  rather than offering a misleading field. An out-of-quota pause keeps its field: sending wakes the
 *  session early, a safety valve. A round leads to its page and is not answered here. */
function ReplyArea({
  item,
  pause,
  answered,
  round,
  pending,
  pickedId,
  onPick,
  onReply,
}: {
  item: InboxItem;
  pause: "wait" | "quota" | null;
  answered: boolean;
  round: boolean;
  pending: boolean;
  pickedId: string | null;
  onPick: (id: string) => void;
  onReply?: (body: { choiceId?: string; text?: string; formData?: RoundValues }) => void;
}) {
  if (pause === "wait") return <Caption>{T.nothingToAnswer}</Caption>;
  if (!onReply) return null;
  if (pause === "quota")
    return (
      <InboxReplyField
        item={item}
        pending={pending}
        hint={false}
        placeholder={T.wakePlaceholder}
        sendLabel={T.wake}
        onSend={(text) => onReply({ text })}
      />
    );
  if (answered) return null;
  // A ONE-FIELD form is answered HERE: options, comment, send on one screen.
  if (item.form) {
    if (round) return null;
    return (
      <InboxQuestionnaire
        spec={item.form}
        pending={pending}
        onSubmit={(formData) => onReply({ formData })}
      />
    );
  }
  // TEXT and CHOICE: already a gesture.
  return (
    <InlineReply
      item={item}
      pending={pending}
      pickedId={pickedId}
      onPick={onPick}
      onSend={(text) => onReply({ text })}
    />
  );
}

/** The footer only exists with a gesture (a round leads to its page, an answer is reread). An
 *  informative card has none: an empty ruled region would read as a missing button. */
function CardFoot({
  item,
  now,
  round,
  answered,
  render,
}: {
  item: InboxItem;
  now: number;
  round: boolean;
  answered: boolean;
  render?: CardActionRender;
}) {
  if (!round && !answered) return null;
  const started = item.answered > 0;
  const label = answered ? T.review : started ? T.resume : T.answer;
  const aria = answered
    ? T.reviewLabel(item.body)
    : started
      ? T.resumeLabel(item.body)
      : T.answerLabel(item.body);
  return (
    <Row gap={10} wrap className="inbox-card-foot">
      {round && !answered && (
        <>
          <Progress answered={item.answered} total={item.total} />
          {/* The question count is already in the gauge ("0 / N"): only the draft, which the gauge
              does not say, renders here (D6, 15/09). */}
          {item.draftAt !== null && (
            <Caption>{T.draftAge(humanDuration(now - item.draftAt))}</Caption>
          )}
        </>
      )}
      <Spacer />
      {render?.({ className: "inbox-card-action", children: label, "aria-label": aria })}
    </Row>
  );
}

export function InboxCard({
  item,
  answer = null,
  render,
  now,
  onReply,
  pending = false,
  hideTaskName = false,
}: {
  /** The channel IS the task: repeating its name atop the card would say it twice. Everywhere else
   *  (board, inbox, panel) the card names its task, or one does not know which task it is (operator,
   *  08/09). */
  hideTaskName?: boolean;
  /** The round number is ON the item (`roundIndex`), not a prop: it comes from the server, the only one
   *  with the rule excluding notices. A prop would let it diverge between frames. */
  item: InboxItem;
  answer?: InboxCardAnswer | null;
  render?: CardActionRender;
  /** Frozen by the caller: `Date.now()` during render is impure (oxlint react/purity). */
  now: number;
  /** Answer IN PLACE (text, choice, one-field form, waking a pause). Absent when the frame only leads
   *  (the waiting panel). */
  onReply?: (body: { choiceId?: string; text?: string; formData?: RoundValues }) => void;
  pending?: boolean;
}) {
  /** The clicked choice between click and server response, not a lasting selection. */
  const [pickedId, setPickedId] = useState<string | null>(null);

  const pause = pauseOf(item);
  const informative = pause !== null;
  const round = isRoundForm(item.form);
  const answered = answer !== null;
  const rows = answer?.rows ?? (item.draft ? answerRows(formFieldsOf(item.form), item.draft) : []);

  return (
    <article
      className="inbox-card"
      data-state={answered ? "answered" : informative ? "wait" : "open"}
    >
      <CardHead
        item={item}
        answer={answer}
        now={now}
        pause={pause}
        round={round}
        hideTaskName={hideTaskName}
      />

      <Stack gap={10} className="inbox-card-body">
        {/* A round's title names the round; a question's title IS the question. */}
        <Text as="p" weight="semi" className="inbox-card-title">
          {item.body}
        </Text>
        {!informative && item.impact && (
          <Caption>
            {INBOX_TEXT.item.impact}
            {INBOX_TEXT.item.impactValue(item.impact)}
          </Caption>
        )}

        {rows.length > 0 && <AnswerPreview rows={rows} />}
        {answered && answer.comment && <Caption>{T.comment(answer.comment)}</Caption>}

        <ReplyArea
          item={item}
          pause={pause}
          answered={answered}
          round={round}
          pending={pending}
          pickedId={pickedId}
          onPick={(id) => {
            setPickedId(id);
            onReply?.({ choiceId: id });
          }}
          onReply={onReply}
        />
      </Stack>

      <CardFoot item={item} now={now} round={round} answered={answered} render={render} />
    </article>
  );
}

/** In-place answer of a text or choice question, apart from the card: layout choice (pills or list) is
 *  a separate rule (`choice-layout.ts`). */
function InlineReply({
  item,
  pending,
  pickedId,
  onPick,
  onSend,
}: {
  item: InboxItem;
  pending: boolean;
  pickedId: string | null;
  onPick: (id: string) => void;
  onSend: (text: string) => void;
}) {
  const choices = item.choices ?? [];
  const stacked = choiceLayout(choices.map((c) => c.label)) === "stacked";
  // Files upload BEFORE the answer, never after (16/09): the session reads attachments while building
  // its resume prompt (`sessions/runner/manager.ts`), so a later screenshot would be announced to
  // nobody. A failure NAMES its file (`files.refusal`) and the answer does not leave, so retrying is
  // safe.
  const files = usePickedAttachments();
  const field = (
    <InboxReplyField
      item={item}
      pending={pending || files.busy}
      hint={item.kind === INBOX_KIND.text}
      attachments={files}
      onSend={(text) => void files.uploadThen(item.taskId, () => onSend(text))}
    />
  );
  if (choices.length === 0) return field;
  return (
    <Stack gap={8}>
      {stacked ? (
        <OptionList
          options={choices}
          disabled={pending}
          selectedId={pending ? pickedId : null}
          onSelect={onPick}
        />
      ) : (
        <Row gap={8} wrap>
          {choices.map((c) => (
            <Button key={c.id} size="md" disabled={pending} onClick={() => onPick(c.id)}>
              {c.label}
            </Button>
          ))}
        </Row>
      )}
      {field}
    </Stack>
  );
}

/** The densest frame, a list row (mockup, Inbox section). Same header and gesture as the card, without
 *  its body: in a list one sorts, one does not reread. */
export function InboxCardRow({
  item,
  render,
  now,
}: {
  item: InboxItem;
  render?: CardActionRender;
  now: number;
}) {
  const isWait = item.waitForTaskId !== null || item.wakeAt !== null;
  const started = item.answered > 0;
  return (
    <div className="inbox-row" data-state={isWait ? "wait" : "open"}>
      <span className="inbox-card-icon" aria-hidden="true">
        {isWait ? <Hourglass /> : <MessageCircleQuestionMark />}
      </span>
      <span className="inbox-row-title">
        {item.body}
        <em>{`${item.taskName} · ${item.agentName}`}</em>
      </span>
      <span className="inbox-row-state">
        {isRoundForm(item.form) ? (
          <Progress answered={item.answered} total={item.total} />
        ) : (
          <Tag>{isWait ? T.waitState : T.choices(item.choices?.length ?? 0)}</Tag>
        )}
      </span>
      <Caption className="inbox-row-age">{humanDuration(now - item.createdAt)}</Caption>
      {isWait ? (
        <span />
      ) : (
        render?.({
          className: "inbox-card-action",
          children: started ? T.resume : T.answer,
          "aria-label": started ? T.resumeLabel(item.body) : T.answerLabel(item.body),
        })
      )}
    </div>
  );
}
