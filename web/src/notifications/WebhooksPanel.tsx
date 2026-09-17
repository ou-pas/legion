// Outbound webhooks, wired. Split from their presentation like `StandupPanel`: the form and the
// empty list render in stories without a backend, including create refusal and delete failure.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "../api/notifications.js";
import { WebhooksCard } from "./webhooks-card.js";

export const notificationsKey = ["notifications"] as const;

export function WebhooksPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: notificationsKey,
    queryFn: () => notificationsApi.notifications(),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: notificationsKey });

  const create = useMutation({
    mutationFn: ({ url, events }: { url: string; events: string[] }) =>
      notificationsApi.createWebhook({ url, events }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => notificationsApi.deleteWebhook(id),
    onSuccess: refresh,
  });

  return (
    <WebhooksCard
      enabled={data?.enabled}
      webhooks={data?.webhooks ?? []}
      allEvents={data?.events ?? []}
      onCreate={(url, events) => create.mutateAsync({ url, events }).then(() => {})}
      onDelete={(id) => remove.mutate(id)}
      creating={create.isPending}
      deletingId={remove.isPending ? remove.variables : undefined}
      createError={create.isError ? (create.error as Error).message : undefined}
      deleteError={remove.isError ? (remove.error as Error).message : undefined}
    />
  );
}
