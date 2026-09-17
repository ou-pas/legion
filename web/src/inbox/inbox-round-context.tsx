// An inbox item's action receipt, what the agent read (`evidence`) and what the answer will touch
// (`impact`), in two forms. Without them deciding meant opening the session; with them the queue is
// handled on the go, from a phone too.
//
// OPEN (`InboxReceipt`) for a question, a choice, a wait: impact in normal ink (it decides), evidence
// in a capped code block.
//
// COLLAPSED (`InboxRoundContext`) for a multi-question ROUND (07/09, direction A): twenty lines of
// evidence expanded BEFORE the first question took the screen. It never opens by default.
import { Quote, Radius } from "lucide-react";
import { CodeBlock } from "../ui/code.js";
import { Disclosure } from "../ui/disclosure.js";
import { Row, Stack } from "../ui/flex.js";
import { Caption, Text } from "../ui/text.js";
import { INBOX_TEXT } from "./text.js";

type Receipt = { evidence: string | null; impact: string | null; agentName: string };

export function InboxReceipt({
  evidence,
  impact,
  agentName,
  evidenceCaption = INBOX_TEXT.item.evidence,
}: Receipt & {
  /** On a wait, the evidence is not a reading but the object of the wait. */
  evidenceCaption?: string;
}) {
  return (
    <>
      {impact && (
        <Row gap={6} align="flex-start">
          <Radius size={14} aria-hidden="true" />
          <Text size="sm">
            <b>{INBOX_TEXT.item.impact}</b>
            {INBOX_TEXT.item.impactValue(impact)}
          </Text>
        </Row>
      )}
      {evidence && (
        <Stack gap={4}>
          <Row gap={6}>
            <Quote size={13} aria-hidden="true" />
            <Caption>{evidenceCaption}</Caption>
          </Row>
          {/* `preview` caps the height and scrolls: a 1200-character excerpt must not push the next
              questions off screen. */}
          <CodeBlock variant="preview" label={INBOX_TEXT.item.evidenceLabel(agentName)}>
            {evidence}
          </CodeBlock>
        </Stack>
      )}
    </>
  );
}

const lineCount = (s: string | null) => (s ? s.trim().split("\n").length : 0);

export function InboxRoundContext({ evidence, impact, agentName }: Receipt) {
  if (!evidence && !impact) return null;
  return (
    <Disclosure
      flush
      className="inbox-qz-ctx"
      summary={
        <Caption>
          {INBOX_TEXT.questionnaire.context(lineCount(evidence) + lineCount(impact))}
        </Caption>
      }
    >
      <Stack gap={8}>
        <InboxReceipt evidence={evidence} impact={impact} agentName={agentName} />
      </Stack>
    </Disclosure>
  );
}
