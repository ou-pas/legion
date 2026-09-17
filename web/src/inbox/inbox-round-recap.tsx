// A round's recap (07/09, direction A): the n answers as question → answer rows, the recommended pill
// when the agent was followed, an edit link reopening the question, a missing answer in dotted amber.
// Then ONE comment for the agent, and sending.
//
// Sending lives HERE only (multi-question round): six decisions are not sent without rereading them at
// once, and the comment covers the whole.
import { type FormField } from "../api/inbox.js";
import { Button } from "../ui/button.js";
import { Stack } from "../ui/flex.js";
import { Heading } from "../ui/heading.js";
import { Textarea } from "../ui/input.js";
import { Field } from "../ui/form.js";
import { Caption, Text } from "../ui/text.js";
import { answerLabel, isDefaultAnswer, noteOf, type RoundValues } from "./inbox-round-answers.js";
import { RecommendedChip } from "./inbox-question-step.js";
import { INBOX_TEXT } from "./text.js";
import "./inbox-questionnaire.css";

const T = INBOX_TEXT.questionnaire;

/** The round comment: at the recap, or under the options of a one-question round. */
export function RoundComment({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label={T.comment}>
      <Textarea
        rows={3}
        size="sm"
        value={value}
        placeholder={T.commentPlaceholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function RecapRow({
  index,
  field,
  value,
  note,
  onEdit,
}: {
  index: number;
  field: FormField;
  value: unknown;
  note: string;
  onEdit: () => void;
}) {
  const label = answerLabel(field, value);
  return (
    <div className="inbox-recap-row">
      <dt className="inbox-recap-q">
        <span className="inbox-recap-n">{index}</span>
        {field.label}
      </dt>
      <dd className="inbox-recap-a">
        {label === null ? (
          <Text as="span" size="sm" tone="wait" className="inbox-recap-pending">
            {T.toDecide}
          </Text>
        ) : (
          <Text as="span" size="sm">
            {label}
          </Text>
        )}
        {label !== null && isDefaultAnswer(field, value) && <RecommendedChip />}
        <Button
          variant="quiet"
          size="sm"
          className="inbox-recap-edit"
          onClick={onEdit}
          aria-label={T.recap.editLabel(field.label)}
        >
          {T.recap.edit}
        </Button>
        {/* The note under the answer, full width: beside it, it would read as a second answer. It is
            edited by reopening the question, like the answer. */}
        {note.trim() && <Caption className="inbox-recap-note">{T.noteRead(note.trim())}</Caption>}
      </dd>
    </div>
  );
}

export function InboxRoundRecap({
  fields,
  values,
  comment,
  onComment,
  onEdit,
  children,
}: {
  fields: readonly FormField[];
  values: RoundValues;
  comment: string;
  onComment: (next: string) => void;
  /** Reopens question `i` (0-based). */
  onEdit: (i: number) => void;
  /** The footer: previous, missing answers, shortcut, send. */
  children: React.ReactNode;
}) {
  return (
    <Stack gap={18} className="inbox-qz-step">
      <Stack gap={8} className="inbox-qz-head">
        <Heading level={3} as="h3" focusable className="inbox-qz-title">
          {T.recap.title}
        </Heading>
        <Text as="p" size="sm" tone="muted">
          {T.recap.lead}
        </Text>
      </Stack>
      <dl className="inbox-recap">
        {fields.map((f, i) => (
          <RecapRow
            key={f.id}
            index={i + 1}
            field={f}
            value={values[f.id]}
            note={noteOf(values, f.id)}
            onEdit={() => onEdit(i)}
          />
        ))}
      </dl>
      <RoundComment value={comment} onChange={onComment} />
      {children}
    </Stack>
  );
}
