// The inbound webhooks card, presentational. Wiring lives in `InboundWebhooksPanel`, the same split
// as `webhooks-card`/`WebhooksPanel` (outbound, in notifications/: this one talks to forges, the
// other to the operator).
//
// Dirty-form pattern (TaskSettings): `useState<string | null>(null)`, the server value shows
// through until something is typed, so the periodic refetch never overwrites input.
import { useState } from "react";
import { Check, Radio } from "lucide-react";
import type { InboundWebhooks } from "../api/integrations.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { StatusChip } from "../ui/chip.js";
import { Field, FormError } from "../ui/form.js";
import { Row, Stack } from "../ui/flex.js";
import { Input } from "../ui/input.js";
import { Caption, Text } from "../ui/text.js";
import { INBOUND_WEBHOOKS_TEXT as T } from "./webhooks-text.js";

/** The endpoint state: configured, and how many repositories reach it, or not yet. Nothing at all
 *  until the server answers: a "not configured" pill during a read would state an unknown fact. */
function ReadyChip({ state }: { state?: InboundWebhooks }) {
  if (state === undefined) return null;
  return (
    <StatusChip state={state.baseUrl ? "ok" : "idle"}>
      {state.baseUrl ? T.card.ready(state.connectedRepos) : T.card.notConfigured}
    </StatusChip>
  );
}

export function InboundWebhooksCard({
  state,
  onSaveBaseUrl,
  saving = false,
  saved = false,
  saveError,
}: {
  /** `undefined` = not read yet. */
  state?: InboundWebhooks;
  /** Resolves on a successful save; a rejection stays visible through `saveError`. */
  onSaveBaseUrl: (baseUrl: string) => Promise<void>;
  saving?: boolean;
  saved?: boolean;
  saveError?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? state?.baseUrl ?? "";
  const dirty = value !== (state?.baseUrl ?? "");

  return (
    <Card
      icon={<Radio size={16} />}
      title={
        <>
          {T.card.title}
          <ReadyChip state={state} />
        </>
      }
      desc={T.card.desc}
    >
      <Stack gap={12}>
        {saveError && <FormError>{saveError}</FormError>}
        <Field label={T.card.baseUrlLabel} hint={T.card.baseUrlHint}>
          <Row gap={8}>
            <Input
              placeholder="https://…"
              value={value}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              variant="primary"
              disabled={!dirty || saving}
              loading={saving}
              leading={saved ? <Check size={12} /> : undefined}
              onClick={() =>
                void onSaveBaseUrl(value.trim())
                  .then(() => setDraft(null))
                  .catch(() => {})
              }
            >
              {saved ? T.card.saved : T.card.save}
            </Button>
          </Row>
        </Field>
        <Text tone="muted" size="sm" as="p">
          {state?.secretReady ? T.card.secretReady : T.card.secretPending}
        </Text>
        <Caption tone="muted">{T.card.whereToConnect}</Caption>
      </Stack>
    </Card>
  );
}
