// Chain library (v18), same pattern as the agent library (AgentsPage.TemplateLibrary): built-in
// catalogue (server/src/chains/catalog.ts) plus chains promoted by the operator, merged by the API.
// A built-in entry has no bin at all; the reason is in `text.ts`, next to the sentence saying it.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Library, Plus, Trash2 } from "lucide-react";
import { chainsApi, type ChainTemplate } from "../api/chains.js";
import { qk } from "../queries.js";
import { Button, IconBtn } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { StatusChip, Tag } from "../ui/chip.js";
import { Code } from "../ui/code.js";
import { Empty } from "../ui/empty.js";
import { FormError } from "../ui/form.js";
import { List, ListRow } from "../ui/list.js";
import { Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { ChainStepsModal } from "./ChainStepsModal.js";
import { CHAIN_TEXT } from "./text.js";

export function ChainLibrary({
  projectId,
  installedNames,
}: {
  projectId?: string;
  installedNames: string[];
}) {
  const qc = useQueryClient();
  const { data: library = [] } = useQuery({
    queryKey: ["chain-templates"] as const,
    queryFn: () => chainsApi.chainTemplates(),
  });
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<ChainTemplate | null>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["chain-templates"] }),
      qc.invalidateQueries({ queryKey: qk.bootstrap }),
    ]);

  return (
    <Card
      icon={<Library size={16} />}
      title={CHAIN_TEXT.library.title}
      desc={CHAIN_TEXT.library.desc}
    >
      <Stack gap={8}>
        {library.length === 0 ? (
          <Empty variant="inline" title={CHAIN_TEXT.library.emptyTitle} />
        ) : (
          <List density="compact" label={CHAIN_TEXT.library.listLabel}>
            {library.map((t) => (
              <ListRow
                key={t.id}
                leading={<Library size={14} />}
                meta={
                  <Tag title={CHAIN_TEXT.stepCountTitle}>
                    {CHAIN_TEXT.stepCount(t.steps.length)}
                  </Tag>
                }
                actions={
                  <>
                    <IconBtn
                      title={CHAIN_TEXT.viewSteps(t.steps.length, t.name)}
                      onClick={() => setViewing(t)}
                    >
                      <Eye size={13} />
                    </IconBtn>
                    {installedNames.includes(t.name) ? (
                      <StatusChip state="ok" dot={false} size="sm">
                        {CHAIN_TEXT.library.alreadyInstalled}
                      </StatusChip>
                    ) : (
                      <Button
                        variant="primary"
                        leading={<Plus size={11} />}
                        disabled={!projectId}
                        onClick={() =>
                          projectId &&
                          chainsApi
                            .installChainTemplate(t.id, projectId)
                            .then(refresh)
                            .catch((e: Error) => setError(e.message))
                        }
                      >
                        {CHAIN_TEXT.library.install}
                      </Button>
                    )}
                    {!t.builtin && (
                      <IconBtn
                        title={CHAIN_TEXT.library.remove}
                        danger
                        onClick={() =>
                          chainsApi
                            .deleteChainTemplate(t.id)
                            .then(refresh)
                            .catch((e: Error) => setError(e.message))
                        }
                      >
                        <Trash2 size={13} />
                      </IconBtn>
                    )}
                  </>
                }
              >
                <Code variant="bare">{t.name}</Code>
                <Text tone="muted" size="sm">
                  {t.description}
                </Text>
                {t.builtin && (
                  <Text tone="muted" size="sm">
                    {CHAIN_TEXT.library.builtin}
                  </Text>
                )}
              </ListRow>
            ))}
          </List>
        )}
        {error && <FormError>{error}</FormError>}
      </Stack>
      {viewing && (
        <ChainStepsModal
          name={viewing.name}
          description={viewing.description}
          steps={viewing.steps}
          onClose={() => setViewing(null)}
        />
      )}
    </Card>
  );
}
