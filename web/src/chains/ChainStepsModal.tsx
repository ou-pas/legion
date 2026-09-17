// A chain's steps (installed or from the library). Installing a 9-step chain blind makes no sense:
// this shows what each step reads, writes, and whether it stops for approval.
import { type TemplateStep } from "../api/chains.js";
import { ArtifactChip } from "../tasks/artifact-chip.js";
import { StatusChip, Tag } from "../ui/chip.js";
import { Modal } from "../ui/modal.js";
import { List, ListRow } from "../ui/list.js";
import { Num } from "../ui/num.js";
import { Row, Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { CHAIN_TEXT } from "./text.js";

export function ChainStepsModal({
  name,
  description,
  steps,
  onClose,
}: {
  name: string;
  description?: string;
  steps: TemplateStep[];
  onClose: () => void;
}) {
  return (
    <Modal title={CHAIN_TEXT.steps.title(name)} onClose={onClose} size="lg">
      <Stack gap={10}>
        {description && (
          <Text tone="muted" size="sm" as="p">
            {description}
          </Text>
        )}
        <List as="ol" label={CHAIN_TEXT.steps.listLabel(name)}>
          {steps.map((s, i) => (
            <ListRow
              key={i}
              as="li"
              leading={<Num value={i + 1} tone="subtle" />}
              meta={
                <Row gap={6}>
                  <Tag title={CHAIN_TEXT.steps.stepAgent}>{s.agentName}</Tag>
                  {s.approvalGate && (
                    <StatusChip state="gate" dot={false} size="sm" title={CHAIN_TEXT.steps.gateWhy}>
                      {CHAIN_TEXT.steps.gate}
                    </StatusChip>
                  )}
                </Row>
              }
            >
              <Stack gap={4}>
                <Text weight="medium">{s.name}</Text>
                {s.expectedArtifacts.length > 0 && (
                  <Row gap={4} wrap>
                    {s.expectedArtifacts.map((a) => (
                      <ArtifactChip key={a} name={a} present={false} />
                    ))}
                  </Row>
                )}
              </Stack>
            </ListRow>
          ))}
        </List>
      </Stack>
    </Modal>
  );
}
