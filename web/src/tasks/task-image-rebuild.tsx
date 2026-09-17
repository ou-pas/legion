// The gesture that recovers a missing image, on the task page (12/09).
//
// Here and not on the board chip: the card is a link, all its chips are mute, and slipping a
// privileged action in would make it reachable by a stray click. Here the cause is already written
// next to it, in the verdict.
//
// Same pattern as `infra/runner-image-notes.tsx`, not a second one: the button while there is
// something to do, the waiting sentence during the build. A disabled button with a tooltip would be
// mute where it matters, since a `title` does not show on `disabled`.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Hammer, TriangleAlert } from "lucide-react";
import { tasksApi, type TaskImageWait } from "../api/tasks.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { PanelNote } from "../ui/panel.js";
import { TASK_IMAGE_TEXT } from "./text/image-wait.js";

export function TaskImageRebuild({
  taskId,
  wait,
}: {
  taskId: string;
  /** The wait as the server returns it. `null` means nothing holds the task: render nothing rather
   *  than a dead button suggesting an available gesture. */
  wait: TaskImageWait | null;
}) {
  const qc = useQueryClient();
  // The server answers at once; `wait.rebuilding` takes over at the next task fetch, then the wait
  // clears when the probe sees the image back.
  const rebuild = useMutation({
    mutationFn: () => tasksApi.rebuildTaskImage(taskId),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.tasks }),
  });
  if (!wait) return null;
  const building = wait.rebuilding || rebuild.isPending;
  return (
    <>
      <PanelNote tone="wait" icon={<TriangleAlert size={14} />}>
        {TASK_IMAGE_TEXT.absent(wait.image, wait.runnerName)}{" "}
        {building ? (
          TASK_IMAGE_TEXT.running
        ) : (
          <Button
            size="sm"
            leading={<Hammer size={13} />}
            loading={rebuild.isPending}
            onClick={() => rebuild.mutate()}
          >
            {TASK_IMAGE_TEXT.button}
          </Button>
        )}
      </PanelNote>
      {rebuild.isError && (
        <PanelNote tone="bad" icon={<TriangleAlert size={14} />}>
          {TASK_IMAGE_TEXT.failed(String((rebuild.error as Error)?.message ?? rebuild.error))}
        </PanelNote>
      )}
    </>
  );
}
