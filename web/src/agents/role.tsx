// The role: what the agent is, composed into its system prompt under "## Role" (buildSpec, after the
// base and the description of its grants). Editable since #24, same pattern as TaskPage's brief:
// Edit → textarea → Save/Cancel. Never a greyed button: while an agent session is alive, the reason
// is written out, its spec has already left. The 23/08 steering came from this gap: the server
// agent had to ask for a scope extension through the inbox because its too-narrow role could not be
// changed without recreating it.
//
// Job description layout (proposal C, 23/08): the role is read in full, in comfort (Markdownish md
// size, Prose measure), with no truncation or folding.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { agentsApi, type Agent } from "../api/agents.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Textarea } from "../ui/input.js";
import { Markdownish } from "../ui/markdownish.js";
import { Caption } from "../ui/text.js";
import { AGENT_TEXT } from "./text.js";

export function AgentRole({
  agent,
  live,
}: {
  agent: Agent;
  /** An agent session is running: the server will refuse the edit (409, purge.ts →
   *  agentLiveSessions). The two guards cannot drift apart. */
  live: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(agent.rolePrompt);
  const save = useMutation({
    mutationFn: () => agentsApi.patchAgent(agent.id, { rolePrompt: draft }),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: qk.bootstrap });
    },
  });

  if (editing) {
    return (
      <Stack gap={8}>
        <Field label={AGENT_TEXT.role.label(agent.name)} hint={AGENT_TEXT.role.hint}>
          <Textarea rows={10} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
        </Field>
        {save.isError && <FormError>{String((save.error as Error).message)}</FormError>}
        <Row gap={6}>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {AGENT_TEXT.role.save}
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setDraft(agent.rolePrompt);
              setEditing(false);
            }}
          >
            {AGENT_TEXT.role.cancel}
          </Button>
        </Row>
      </Stack>
    );
  }

  return (
    <Stack gap={10}>
      <Row gap={6}>
        <Spacer />
        {live ? (
          <Caption tone="muted">{AGENT_TEXT.role.locked}</Caption>
        ) : (
          <Button
            size="sm"
            variant="quiet"
            leading={<Pencil size={12} />}
            onClick={() => {
              setDraft(agent.rolePrompt);
              setEditing(true);
            }}
          >
            {AGENT_TEXT.role.edit}
          </Button>
        )}
      </Row>
      {/* Full width, like the edit field: both views show the same shape. `Prose`'s default since
          26/08. */}
      <Markdownish text={agent.rolePrompt} size="md" />
    </Stack>
  );
}
