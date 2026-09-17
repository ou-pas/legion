// Relaunches a session on THE SAME task (its branch is fixed in the database, `runTask` never
// re-derives it) with a resolution instruction. Its caller (`PrRepair`) only renders it on
// `"conflict"`. The button alone since 15/09 (see sibling `fix-ci-button.tsx`): its sentence moved to
// `PrRepairNotice`, in the view body, always visible, never a `title`.
import { useState } from "react";
import { Wrench } from "lucide-react";
import { reviewApi } from "../api/review.js";
import { Button } from "../ui/button.js";
import { ErrorState } from "../ui/error-state.js";
import { Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { REVIEW_TEXT } from "./text.js";

export function ResolveConflictButton({
  taskId,
  repo,
  number,
  onLaunched,
}: {
  taskId: string;
  repo: string;
  number: number;
  /** Called once the session is relaunched; the caller decides whether to refresh or let the local
   *  success message suffice. */
  onLaunched?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);

  const resolve = () => {
    setBusy(true);
    setError(null);
    reviewApi
      .resolveConflict(taskId, { repoName: repo, number })
      .then(() => {
        setLaunched(true);
        onLaunched?.();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (launched)
    return (
      <Text size="sm" tone="muted">
        {REVIEW_TEXT.conflict.launched(repo, number)}
      </Text>
    );

  return (
    <Stack gap={6}>
      <Button variant="primary" leading={<Wrench size={13} />} loading={busy} onClick={resolve}>
        {REVIEW_TEXT.conflict.resolve}
      </Button>
      {error && <ErrorState title={REVIEW_TEXT.conflict.failed} detail={error} />}
    </Stack>
  );
}
