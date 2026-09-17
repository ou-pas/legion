// A rule suggested by memory (v10): extracted from an inbox answer, it is not applied until you
// approve it. It waits for a decision, hence the hatched "gate" block.
import { Lightbulb } from "lucide-react";
import { capabilitiesApi, type Rule } from "../api/capabilities.js";
import { Button } from "../ui/button.js";
import { StatusChip } from "../ui/chip.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Hatch } from "../ui/hatch.js";
import { Markdownish } from "../ui/markdownish.js";
import { Text } from "../ui/text.js";
import { RULES_TEXT } from "./text/rules.js";
import { RULE_STATUS } from "../api/agents.js";

export function SuggestedRule({
  rule,
  onChange,
  onError,
}: {
  rule: Rule;
  onChange: () => void;
  /** An approve/reject failing silently would leave a suggestion "that does not go" unexplained
   *  (toast audit 24/08). */
  onError: (message: string) => void;
}) {
  return (
    <Hatch tone="gate" icon={<Lightbulb size={14} />}>
      <Stack gap={6}>
        <Row gap={8} wrap>
          <StatusChip state="gate" dot={false} size="sm">
            {RULES_TEXT.suggested.badge}
          </StatusChip>
          <Text weight="semi">{rule.name}</Text>
          <Spacer />
          <Button
            variant="primary"
            onClick={() =>
              capabilitiesApi
                .patchRule(rule.id, { status: RULE_STATUS.active })
                .then(onChange)
                .catch((e: Error) => onError(e.message))
            }
          >
            {RULES_TEXT.suggested.approve}
          </Button>
          <Button
            onClick={() =>
              capabilitiesApi
                .deleteRule(rule.id)
                .then(onChange)
                .catch((e: Error) => onError(e.message))
            }
          >
            {RULES_TEXT.suggested.reject}
          </Button>
        </Row>
        {/* Markdownish, not <p>s split on double newlines (24/08): a rule is markdown, and imported
            OBEY rules have headings and lists that read as raw asterisks and hashes. */}
        <Markdownish text={rule.content} />
        <Text tone="subtle" size="xs" as="p">
          {RULES_TEXT.suggested.origin}
        </Text>
      </Stack>
    </Hatch>
  );
}
