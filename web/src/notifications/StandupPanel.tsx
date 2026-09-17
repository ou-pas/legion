// The standup card, wired. Split from its presentation like `VersionPanel` in infra: states you
// cannot trigger at will on a real server (empty time, long preview, send failure) still render in
// stories.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "../api/notifications.js";
import { StandupCard } from "./standup-card.js";

export const standupKey = ["standup"] as const;

export function StandupPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: standupKey,
    queryFn: () => notificationsApi.standup(),
    refetchInterval: 60_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: standupKey });

  const setHour = useMutation({
    mutationFn: (hour: number | null) => notificationsApi.setStandupHour(hour),
    onSuccess: refresh,
  });
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () => notificationsApi.sendStandup(),
    onSuccess: () => setSent(true),
  });

  return (
    <StandupCard
      hour={data?.hour}
      preview={data?.preview}
      onHourChange={(hour) => {
        setSent(false);
        setHour.mutate(hour);
      }}
      onSend={() => {
        setSent(false);
        send.mutate();
      }}
      sending={send.isPending}
      hourError={setHour.isError ? (setHour.error as Error).message : undefined}
      sendError={send.isError ? (send.error as Error).message : undefined}
      sent={sent}
    />
  );
}
