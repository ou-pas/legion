// The gestures an open PR asks for (resolve a conflict, fix a red job, or both) and THE SENTENCE
// saying what they cost. Extracted from the PR view on 14/09 so the channel panel offers them too;
// it lives in `review/`, which owns the PR.
//
// Two exports, one forge read (15/09): the buttons go up into the header bar, where a thirty-word
// sentence does not fit; the sentence stays in the body. One module and one react-query key feed
// both, or they would end up disagreeing on the state that shows them.
//
// Never a gesture outside its state: resolve only on `mergeState === "conflict"`, fix CI only on
// `checkState === "failing"`, neither without a PR number. The SERVER rechecks the same conditions;
// the screen does not offer what it knows will be refused, and never moves on uncertainty
// (`"unknown"`, `"pending"`, or an absent field).
import { useQuery } from "@tanstack/react-query";
import { Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { prMergeStatesQuery } from "../tasks/pr-merge-state-query.js";
import type { PrUrl } from "../tasks/pr-state.js";
import { FixCiButton } from "./fix-ci-button.js";
import { ResolveConflictButton } from "./resolve-conflict-button.js";
import { REVIEW_TEXT } from "./text.js";

/** What an open PR needs, per repository. `number` is known non-null: without it neither button nor
 *  sentence can name the request they act on. */
type Repair = { repo: string; number: number; conflict: boolean; failingCi: boolean };

function repairsOf(
  prUrls: readonly PrUrl[],
  states: ReturnType<typeof useMergeStates>["data"],
): Repair[] {
  const out: Repair[] = [];
  for (const p of prUrls) {
    const s = states?.find((m) => m.repo === p.repo && m.url === p.url);
    if (s?.prState !== "open" || s.number == null) continue;
    const repair = {
      repo: p.repo,
      number: s.number,
      conflict: s.mergeState === "conflict",
      failingCi: s.checkState === "failing",
    };
    if (repair.conflict || repair.failingCi) out.push(repair);
  }
  return out;
}

/** The SAME key as `PrActions`: react-query asks the forge once, even with buttons and sentence
 *  mounted on the same screen. */
function useMergeStates(taskId: string, prUrls: readonly PrUrl[]) {
  return useQuery(prMergeStatesQuery(taskId, prUrls.length > 0));
}

export function PrRepair({
  taskId,
  prUrls,
  /** Called when a repair is LAUNCHED; the forge state is already refreshed here. */
  onLaunched,
}: {
  taskId: string;
  prUrls: PrUrl[];
  onLaunched?: () => void;
}) {
  const mergeStates = useMergeStates(taskId, prUrls);
  const relaunched = () => {
    void mergeStates.refetch();
    onLaunched?.();
  };
  return (
    <>
      {repairsOf(prUrls, mergeStates.data).map((r) => (
        <Stack key={r.repo} gap={6}>
          {r.conflict && (
            <ResolveConflictButton
              taskId={taskId}
              repo={r.repo}
              number={r.number}
              onLaunched={relaunched}
            />
          )}
          {r.failingCi && (
            <FixCiButton taskId={taskId} repo={r.repo} number={r.number} onLaunched={relaunched} />
          )}
        </Stack>
      ))}
    </>
  );
}

/** What the button will do, in writing. A click relaunches a SESSION (time and money), which must not
 *  be discovered afterwards: the sentence renders in the body, where the reader is, while the button
 *  waits in the bar. Nothing when nothing needs repair. */
export function PrRepairNotice({ taskId, prUrls }: { taskId: string; prUrls: PrUrl[] }) {
  const mergeStates = useMergeStates(taskId, prUrls);
  const repairs = repairsOf(prUrls, mergeStates.data);
  if (repairs.length === 0) return null;
  return (
    <Stack gap={4}>
      {repairs.map((r) => (
        <Stack key={r.repo} gap={4}>
          {r.conflict && (
            <Text size="sm" tone="muted">
              {REVIEW_TEXT.conflict.explain(r.repo, r.number)}
            </Text>
          )}
          {r.failingCi && (
            <Text size="sm" tone="muted">
              {REVIEW_TEXT.fixCi.explain(r.repo, r.number)}
            </Text>
          )}
        </Stack>
      ))}
    </Stack>
  );
}
