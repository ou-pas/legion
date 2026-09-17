// The PR and its gestures in one reusable block (14/09). PR state, the repairs it needs, and opening
// one when none exists used to live only in the task page's PR view: from a channel you had to leave
// the conversation for a one-button gesture (operator request). It lives in `review/`, which owns
// the PR; the task page and the channel only display it.
//
// It owns the forge state (`prMergeStatesQuery`): two callers passing it in would end up reading it
// two ways, and it is exactly the data deciding whether a button shows.
//
// Repairs are in `PrRepair`, next door: the PR view wants ONLY them (its header already carries the
// mark). Two modules rather than a `marks={false}` flag: a flag removing half a component means there
// were two.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitPullRequestArrow } from "lucide-react";
import { reviewApi } from "../api/review.js";
import { prMergeStatesQuery } from "../tasks/pr-merge-state-query.js";
import { canOpenPr, type PrUrl } from "../tasks/pr-state.js";
import { Button } from "../ui/button.js";
import { FormError } from "../ui/form.js";
import { Row, Stack } from "../ui/flex.js";
import { PrMark } from "./pr-mark.js";
import { PrRepair } from "./pr-repair.js";
import { REVIEW_TEXT } from "./text.js";

export function PrActions({
  taskId,
  prUrls,
  /** Was code pushed by a session of the task? Without it the open button never arms (`canOpenPr`):
   *  a `pr.md` without a commit cannot land at the forge (rule of 14/09). */
  pushedCode,
  /** What the caller refreshes once a PR is created (the task page its task, the channel its
   *  channel). The block does not know its surroundings. */
  onCreated,
  /** Whether the block carries its own open button. The PR view already has one under the draft,
   *  labelled from that draft. A prop rather than two components: the SAME thing minus a button. */
  create = true,
  /** Rendered after the marks, before the repairs: the channel puts its diff link there. */
  children,
}: {
  taskId: string;
  prUrls: PrUrl[];
  pushedCode: boolean;
  onCreated: () => void;
  create?: boolean;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mergeStates = useQuery(prMergeStatesQuery(taskId, prUrls.length > 0));
  const stateOf = (repo: string, url: string) =>
    mergeStates.data?.find((m) => m.repo === repo && m.url === url);
  const single = prUrls.length <= 1;
  // The gesture follows the PUSH, not the forge state (see `canOpenPr`): a half-failed opening
  // leaves an `open` PR on one side and nothing on the other, exactly when clicking again is
  // needed. The forge state only changes the label, below.
  const showCreate = create && canOpenPr(pushedCode);

  const open = () => {
    setBusy(true);
    setError(null);
    reviewApi
      .createPr(taskId)
      .then((r) => {
        // The server returns refusals PER REPOSITORY: one PR opened and another refused is normal,
        // and hiding the second would suggest full success.
        if (r.errors.length) setError(r.errors.join(" · "));
        onCreated();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <Stack gap={6}>
      {/* ONE row of gestures (15/09, operator request), in the PR view header and the channel
          panel. State marks come first because they say WHAT the buttons act on. */}
      <Row gap={6} wrap align="center">
        {showCreate && (
          <Button
            size="sm"
            leading={<GitPullRequestArrow size={13} />}
            loading={busy}
            onClick={open}
          >
            {prUrls.length ? REVIEW_TEXT.pr.recreate : REVIEW_TEXT.pr.create}
          </Button>
        )}
        {prUrls.map((p) => {
          const s = stateOf(p.repo, p.url);
          return (
            <PrMark
              key={p.url}
              url={p.url}
              number={s?.number}
              state={s?.prState}
              mergeState={s?.mergeState}
              repo={single ? undefined : p.repo}
            />
          );
        })}
        {children}
        <PrRepair taskId={taskId} prUrls={prUrls} />
      </Row>
      {error && <FormError>{error}</FormError>}
    </Stack>
  );
}
