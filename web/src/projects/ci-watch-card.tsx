// The red-CI watch switch (29/09): per project, on by default. Same PATCH mechanics as the rest of
// project settings — this one has no draft/dirty state to hold, a switch commits the moment it
// moves, like `webhooks-card.tsx`'s enabled toggle.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { projectsApi, type Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { Card } from "../ui/card.js";
import { Switch } from "../ui/choice.js";
import { Stack } from "../ui/flex.js";
import { FormError } from "../ui/form.js";
import { CI_WATCH_CARD_TEXT as T } from "./text/ci-watch.js";

export function CiWatchCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [err, setErr] = useState("");

  const toggle = useMutation({
    mutationFn: (next: boolean) => projectsApi.patchProject(project.id, { ciWatch: next }),
    onSuccess: () => {
      setErr("");
      void qc.invalidateQueries({ queryKey: qk.bootstrap });
    },
    onError: (e: Error) => setErr(e.message),
  });
  // While the request is in flight the switch already shows where it is headed, not the stale
  // server value: without this a slow PATCH would look like the click did nothing.
  const checked = toggle.isPending ? (toggle.variables as boolean) : project.ciWatch;

  return (
    <Card icon={<RefreshCw size={16} />} title={T.title} desc={T.why}>
      <Stack gap={8}>
        {err && <FormError>{err}</FormError>}
        <Switch
          checked={checked}
          disabled={toggle.isPending}
          onChange={(next) => toggle.mutate(next)}
        >
          {T.switchLabel}
        </Switch>
      </Stack>
    </Card>
  );
}
