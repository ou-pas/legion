// The same page, frozen: the history (07/09). An answered question changes neither URL nor shape: the
// form disappears, questions and answers stay, and a pasted link still leads to the same place.
//
// What was RULED OUT is said plainly, the only thing this module adds to the pre-send recap: a
// decision rereads by what it refused, as in the channel thread for choices.
//
// No extra column: `answer_text` holds the answers JSON, `answered_at` and `answered_by` the rest.
import type { ReactNode } from "react";
import type { FormField } from "../api/inbox.js";
import { Stack } from "../ui/flex.js";
import { Caption, Text } from "../ui/text.js";
import { RecommendedChip } from "./inbox-question-step.js";
import { answerRows, type RoundValues } from "./inbox-round-answers.js";
import { FORM_COMMENT_KEY } from "../api/inbox.js";
import { INBOX_TEXT } from "./text.js";
import "./inbox-question-read.css";

const T = INBOX_TEXT.question;

export function InboxQuestionRead({
  fields,
  values,
  footer,
}: {
  fields: readonly FormField[];
  /** Answers as sent, `__comment` included, read separately as the last row. */
  values: RoundValues;
  /** What the session did next: the deposited task, a link. Absent when it deposited nothing, rather
   *  than a useless "nothing" row. */
  footer?: ReactNode;
}) {
  const rows = answerRows(fields, values);
  const comment = typeof values[FORM_COMMENT_KEY] === "string" ? values[FORM_COMMENT_KEY] : null;
  return (
    <Stack gap={12}>
      <Text as="p" size="sm" tone="muted">
        {T.readLead}
      </Text>
      <dl className="inbox-read">
        {rows.map((row) => (
          <div key={row.index} className="inbox-read-row">
            <dt>
              <span className="inbox-read-n">{row.index}</span>
              {row.label}
            </dt>
            <dd>
              <Text as="span" size="sm">
                {row.value ?? INBOX_TEXT.questionnaire.toDecide}
              </Text>
              {row.recommended && <RecommendedChip />}
              {row.discarded !== null && (
                <Caption className="inbox-read-why">{T.discarded(row.discarded)}</Caption>
              )}
              {row.note !== null && (
                <Caption className="inbox-read-why">
                  {INBOX_TEXT.questionnaire.noteRead(row.note)}
                </Caption>
              )}
            </dd>
          </div>
        ))}
        {comment && (
          <div className="inbox-read-row">
            {/* The comment has no number: it answers no question, it covers the whole round. */}
            <dt>
              <span className="inbox-read-n" aria-hidden="true">
                ·
              </span>
              {T.readComment}
            </dt>
            <dd>
              <Text as="span" size="sm">{`“${comment}”`}</Text>
            </dd>
          </div>
        )}
      </dl>
      {footer}
    </Stack>
  );
}
