// Push notifications, wired. Split from their presentation like `WebhooksPanel`: the card's five
// states (unsupported, to install, denied, subscribed, not subscribed) render in stories without a
// capable browser or a backend.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi, pushApi } from "../api/notifications.js";
import { notificationsKey } from "./WebhooksPanel.js";
import { PushCard } from "./push-card.js";
import { usePush } from "./use-push.js";

export const pushKey = ["push", "subscriptions"] as const;

export function PushPanel() {
  const qc = useQueryClient();
  const { availability, permission, subscribed, busy, error, enable, disable } = usePush();
  const { data } = useQuery({ queryKey: pushKey, queryFn: () => pushApi.subscriptions() });
  // The global kill switch, read here so the card can say so. Same key as the webhooks panel: both
  // cards read the same switch, react-query asks once, and they cannot show two different states.
  const { data: notifs } = useQuery({
    queryKey: notificationsKey,
    queryFn: () => notificationsApi.notifications(),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: pushKey });

  const forget = useMutation({
    mutationFn: (id: string) => pushApi.unsubscribe(id),
    onSuccess: refresh,
  });

  return (
    <PushCard
      availability={availability}
      notificationsEnabled={notifs?.enabled}
      permission={permission}
      subscribed={subscribed}
      busy={busy}
      error={error}
      subscriptions={data?.subscriptions ?? []}
      // The list comes from the server and subscribing happens in the browser: without this refresh,
      // the device just subscribed only shows on the next load.
      onEnable={() => void enable().then(refresh)}
      onDisable={() => void disable().then(refresh)}
      onForget={(id) => forget.mutate(id)}
      forgettingId={forget.isPending ? forget.variables : undefined}
    />
  );
}
