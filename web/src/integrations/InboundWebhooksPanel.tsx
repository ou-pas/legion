// Inbound webhooks, wired. Split from their presentation for the same reason as `WebhooksPanel`
// (outbound): the card renders in stories without a backend, states included.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { integrationsApi } from "../api/integrations.js";
import { InboundWebhooksCard } from "./inbound-webhooks-card.js";

export const inboundWebhooksKey = ["inbound-webhooks"] as const;

export function InboundWebhooksPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: inboundWebhooksKey,
    queryFn: integrationsApi.inboundWebhooks,
  });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (baseUrl: string) => integrationsApi.setInboundBaseUrl(baseUrl),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inboundWebhooksKey });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
  });

  return (
    <InboundWebhooksCard
      state={data}
      onSaveBaseUrl={(baseUrl) => save.mutateAsync(baseUrl).then(() => {})}
      saving={save.isPending}
      saved={saved}
      saveError={save.isError ? (save.error as Error).message : undefined}
    />
  );
}
