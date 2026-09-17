// The return banner (02/09): "the return shows from everywhere".
//
// Mounted at the root (`router.tsx`), like `useControlEvents` (#69), for the same reason: a signal
// that must survive a page change cannot live in a page's component. `VersionPanel` keeps its own
// banner (the detailed account, `startedLogPath` included); this one is the short signal, read from
// anywhere.
//
// It does not compare `current` with the last `current` seen. A repository staying on the same
// version all session must never show it twice, and a poll seeing `current` pass several times
// through the same word must not reopen the banner. The comparison is against `version-boot.ts`:
// the version known when the page loaded, set once.
//
// No automatic reload (decision in #57): the button reloads, nothing else does it for you.
//
// Two components, same split as `StatusGroup` / `TopBarStatus`: `ReturnedBanner` is the pure form
// (a string, two gestures) Storybook shows; `UpdateReturnBanner` wires it to `/api/version` and the
// boot memory.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { versionQueryOptions } from "./version-query.js";
import { isNewerThanBoot, noteBootVersion } from "./version-boot.js";
import { VERSION_TEXT } from "./text-version.js";
import "./update-return-banner.css";

export function ReturnedBanner({
  tag,
  onReload,
  onClose,
}: {
  tag: string;
  onReload: () => void;
  onClose: () => void;
}) {
  return (
    <Banner
      tone="ok"
      title={VERSION_TEXT.returnedTitle(tag)}
      onClose={onClose}
      actions={
        <Button size="sm" variant="primary" onClick={onReload}>
          {VERSION_TEXT.returnedReload}
        </Button>
      }
    />
  );
}

export function UpdateReturnBanner() {
  const { data } = useQuery(versionQueryOptions);
  // `dismissed`: the close button hides the banner without reloading; an operator who saw it and
  // keeps working must not see it again on every re-render.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (data) noteBootVersion(data.current);
  }, [data]);

  if (dismissed || !data || !isNewerThanBoot(data.current)) return null;

  return (
    // The gutter is here, in the shown branch: an always-mounted `<div>` would leave a permanent
    // gap under the bar, even with nothing to announce.
    <div className="update-return-banner-slot">
      <ReturnedBanner
        tag={data.current!}
        onReload={() => location.reload()}
        onClose={() => setDismissed(true)}
      />
    </div>
  );
}
