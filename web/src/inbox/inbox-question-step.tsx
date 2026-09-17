// ONE question screen (07/09, direction A): locating label, title (the field `label`), the agent's
// argument below, options, footer. The argument is what the agent wrote BEFORE the field. Radios become
// cards (the field `hint`, carrying the recommendation, goes under the recommended option); other types
// keep `InboxFormField`, since a select or number has no per-option "why".
import type { ReactNode } from "react";
import { useId } from "react";
import { type FormField } from "../api/inbox.js";
import { Button } from "../ui/button.js";
import { StatusChip } from "../ui/chip.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Field } from "../ui/form.js";
import { Heading } from "../ui/heading.js";
import { Textarea } from "../ui/input.js";
import { Markdownish } from "../ui/markdownish.js";
import { OptionCards } from "../ui/option-card.js";
import { Caption } from "../ui/text.js";
import { InboxFormField } from "./inbox-form-field.js";
import { InboxFormSvg } from "./inbox-form-svg.js";
import type { ContentBlock, RoundQuestion } from "./inbox-round-split.js";
import { INBOX_TEXT } from "./text.js";
import "./inbox-questionnaire.css";

const T = INBOX_TEXT.questionnaire;

/** A round's content blocks: a question's argument, or the collapsed context. */
export function RoundBlocks({ blocks }: { blocks: readonly ContentBlock[] }) {
  return blocks.map((b, i) =>
    b.kind === "markdown" ? (
      <Markdownish key={i} text={b.text} />
    ) : (
      <InboxFormSvg key={i} svg={b.svg} caption={b.caption} />
    ),
  );
}

/** The recommended pill, the same in cards and recap. */
export const RecommendedChip = () => (
  <StatusChip state="ok" dot={false} size="sm">
    {T.recommended}
  </StatusChip>
);

function RadioCards({
  field,
  value,
  onChange,
  titleId,
}: {
  field: FormField;
  value: unknown;
  onChange: (next: unknown) => void;
  titleId: string;
}) {
  const hasDefault = field.default !== undefined;
  return (
    <Stack gap={6}>
      <OptionCards
        labelledBy={titleId}
        value={typeof value === "string" ? value : null}
        onChange={onChange}
        options={(field.options ?? []).map((o) => {
          const recommended = o.id === field.default;
          return {
            id: o.id,
            label: o.label,
            badge: recommended ? <RecommendedChip /> : undefined,
            why: recommended ? field.hint : undefined,
          };
        })}
      />
      {/* Without default the hint has no option to join: it stays under the group. */}
      {field.hint && !hasDefault && <Caption>{field.hint}</Caption>}
    </Stack>
  );
}

/** A screen footer: previous on the left, then the note, and the primary action carrying its own
 *  shortcut (`Button` `shortcut`, 12/09). */
export function RoundFoot({
  onPrev,
  note,
  action,
}: {
  onPrev?: () => void;
  note?: ReactNode;
  action: ReactNode;
}) {
  return (
    <Row gap={10} wrap className="inbox-qz-foot">
      {onPrev && (
        <Button size="md" onClick={onPrev}>
          {T.prev}
        </Button>
      )}
      <Spacer />
      {note && <Caption tone="wait">{note}</Caption>}
      {action}
    </Row>
  );
}

/** A question's NOTE (08/09, operator request for a comment field at each step). Two optional lines
 *  under the options: what to say ABOUT this question (a doubt, a condition), neither the answer nor
 *  the round comment. Sent under `<id>__note`, read by the agent next to the answer. */
function QuestionNote({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <Field label={T.note}>
      <Textarea
        rows={2}
        size="sm"
        value={value}
        placeholder={T.notePlaceholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function InboxQuestionStep({
  question,
  value,
  onChange,
  note,
  onNote,
  children,
}: {
  question: RoundQuestion;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Absent (no `onNote`) on a one-question round: the round comment is already under the options, and
   *  two free fields would contradict each other. */
  note?: string;
  onNote?: (next: string) => void;
  /** The footer: navigation, or, on a one-question round, comment and send. */
  children: ReactNode;
}) {
  const titleId = useId();
  const { field } = question;
  return (
    <Stack gap={18} className="inbox-qz-step">
      <Stack gap={8} className="inbox-qz-head">
        <Heading level={3} as="h3" id={titleId} focusable className="inbox-qz-title">
          {field.label}
        </Heading>
        <RoundBlocks blocks={question.argument} />
      </Stack>
      {field.type === "radio" ? (
        <RadioCards field={field} value={value} onChange={onChange} titleId={titleId} />
      ) : (
        <InboxFormField field={field} value={value} onChange={onChange} />
      )}
      {onNote && <QuestionNote value={note ?? ""} onChange={onNote} />}
      {children}
    </Stack>
  );
}
