// Sibling of `ResolveConflictButton` on the other probe (`checkState`). Relaunches a session on THE
// SAME task (its branch is fixed in the database, `runTask` never re-derives it) on the red job found
// at the forge. Its callers (`PrRepair`) only render it on `"failing"`.
//
// The button alone since 15/09: paired in a `Row` with its sentence it did not fit a header bar. The
// sentence moved to `PrRepairNotice`, in the view BODY, always visible text, never a `title`
// discovered after the click (rule of 14/09).
//
// `fixCi` is injectable so stories show the wait and the three refusals (CI no longer red, live
// session, silent forge) without reaching the network, where there is no server.
import { useState } from "react";
import { Hammer } from "lucide-react";
import { reviewApi } from "../api/review.js";
import { Button } from "../ui/button.js";
import { ErrorState } from "../ui/error-state.js";
import { Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { REVIEW_TEXT } from "./text.js";

export function FixCiButton({
  taskId,
  repo,
  number,
  onLaunched,
  fixCi,
}: {
  taskId: string;
  repo: string;
  number: number;
  /** Called once the session is relaunched; the caller decides whether to refresh or let the local
   *  success message suffice. */
  onLaunched?: () => void;
  /** Injectable for stories and tests; the default talks to the server. */
  fixCi?: (target: { repoName: string; number: number }) => Promise<{ launched: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);

  const launch =
    fixCi ?? ((target: { repoName: string; number: number }) => reviewApi.fixCi(taskId, target));

  const fix = () => {
    setBusy(true);
    setError(null);
    launch({ repoName: repo, number })
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
        {REVIEW_TEXT.fixCi.launched(repo, number)}
      </Text>
    );

  return (
    <Stack gap={6}>
      <Button variant="primary" leading={<Hammer size={13} />} loading={busy} onClick={fix}>
        {REVIEW_TEXT.fixCi.resolve}
      </Button>
      {error && <ErrorState title={REVIEW_TEXT.fixCi.failed} detail={error} />}
    </Stack>
  );
}
