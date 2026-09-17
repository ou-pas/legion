// Reachable repositories: the second half of a single list, not a separate list.
//
// A fact is fetched, a choice is asked. A repository URL is a fact the forge knows, and so is its
// short name (the last path segment): making people type them was the defect. A project's name or
// default model are choices, and those get asked.
//
// There is only one list since 16/09. This component renders children of the list
// `repos-section.tsx` opens, after the declared repositories. No heading separates them: the
// right-hand button tells them apart ("Remove" in the project, "Add" for reachable), and a declared
// row also carries its test command. An already declared repository does not reappear here.
//
// This component cannot load. Everything is given (list, wait, failure), which makes its states
// exercisable in stories. The network is in `repos-section.tsx`, which composes.
//
// The states a reader cannot guess each have a story: no connection (the only one with an exit),
// loading, empty list, truncated list, failure.
import { Link as RouterLink } from "@tanstack/react-router";
import { FolderGit2, Plus, RefreshCw } from "lucide-react";
import type { AvailableRepos } from "../api/projects.js";
import { Banner } from "../ui/banner.js";
import { Button, IconBtn } from "../ui/button.js";
import { Tag } from "../ui/chip.js";
import { Divider } from "../ui/divider.js";
import { Empty } from "../ui/empty.js";
import { Link as UiLink } from "../ui/link.js";
import { ListItem, ListRow } from "../ui/list.js";
import { Spinner } from "../ui/spinner.js";
import { Caption } from "../ui/text.js";
import { forgeText } from "./forge.js";
import { PROJECT_PAGE_TEXT } from "./text/project-page.js";

const T = PROJECT_PAGE_TEXT.repoPicker;

/** Discovery cap, copied from the server (`integrations/forge.ts`) like the secret names in
 *  `forge.ts`: the screen does not query a route to show a number in a sentence. The server holds
 *  the value, where it decides. */
export const REPO_DISCOVERY_CAP = 300;

/** The short name derived from the full path: `ou-pas/front` gives `front`, and the second input
 *  disappears. The short name is the clone folder (`./repos/<name>`): the last path segment is what
 *  anyone would have typed, and the server refuses what it does not accept (letters, digits, `.`,
 *  `-`, `_`) rather than silently fix it. */
export function shortNameOf(fullName: string): string {
  return fullName.split("/").filter(Boolean).at(-1) ?? fullName;
}

/** What is left to offer. An already declared repository leaves the list rather than carry an
 *  "already declared" note: its row exists above, with its test command and webhook. Matching stays
 *  the server's (`declared`) and is written only here; the card needs it too, to know whether the
 *  whole list is empty. */
export function offeredRepos(data: AvailableRepos): AvailableRepos["repos"] {
  return data.repos.filter((r) => !r.declared);
}

export function RepoPicker({
  data,
  loading,
  error,
  projectId,
  declaredCount,
  adding,
  onAdd,
  onRetry,
}: {
  /** `undefined` until something comes back; waiting is carried by `loading`. */
  data: AvailableRepos | undefined;
  loading: boolean;
  /** The request's own failure. Per-forge refusals are in `data.errors`. */
  error: string | null;
  projectId: string;
  /** How many declared repositories the list carries above. Only used for the empty state: without
   *  them the whole list is empty, and the card says so in one sentence. */
  declaredCount: number;
  /** The URL of the repository being added, so the row says so and does not send twice. */
  adding: string | null;
  onAdd: (repo: AvailableRepos["repos"][number]) => void;
  onRetry: () => void;
}) {
  if (loading)
    return (
      <ListRow>
        <Spinner size="sm" label={T.loading} />
      </ListRow>
    );

  // Failure does not empty the card. Declared repositories above come from the database and stay
  // readable; this banner says discovery failed, not that the project has nothing.
  if (error !== null)
    return (
      <Banner
        tone="bad"
        title={T.failed}
        actions={
          <Button leading={<RefreshCw size={12} />} onClick={onRetry}>
            {T.retry}
          </Button>
        }
      >
        {error}
      </Banner>
    );

  if (!data) return null;

  if (data.connected.length === 0)
    return (
      <Empty
        art="frame"
        variant="inline"
        title={T.noConnection}
        action={
          // An anchor, not `navigate()`: an empty state's exit must keep middle-click and
          // open-in-tab, like every link in the app.
          <UiLink
            render={(p) => (
              <RouterLink to="/p/$projectId/project/integrations" params={{ projectId }} {...p} />
            )}
          >
            {T.goToIntegrations}
          </UiLink>
        }
      >
        {T.noConnectionHint}
      </Empty>
    );

  const offered = offeredRepos(data);

  return (
    <>
      {offered.map((r) => (
        <ListItem
          key={r.url}
          leading={<FolderGit2 size={15} />}
          title={r.fullName}
          sub={r.url}
          meta={
            // What informs is flat, what clicks is framed: forge and visibility are data, the frame
            // is reserved for what clicks. The vertical rule separates the two families.
            <>
              <Tag variant="flat" title={`Forge : ${forgeText(r.forge).label}`}>
                {forgeText(r.forge).label}
              </Tag>
              {r.private && <Tag variant="flat">{T.private}</Tag>}
              <Divider orientation="vertical" space="none" />
            </>
          }
          actions={
            // `IconBtn`, not `Button`: ten rows each labelled "Add" give ten buttons nothing tells
            // apart on keyboard or screen reader. Its `title` names the repository.
            <IconBtn
              variant="primary"
              title={T.addAria(r.fullName)}
              loading={adding === r.url}
              onClick={() => onAdd(r)}
            >
              <Plus size={13} />
            </IconBtn>
          }
        />
      ))}

      {/* The empty state without a sentence: the cause is in the banners below, and repeating it
          would read twice (empty state rule D5). Only rendered when declared repositories sit
          above: without them the whole list is empty, and the card says so once. */}
      {offered.length === 0 && declaredCount > 0 && (
        <Empty art="filtered" variant="inline" title={T.empty} />
      )}

      {data.truncated && (
        <ListRow>
          <Caption>{T.truncated(REPO_DISCOVERY_CAP)}</Caption>
        </ListRow>
      )}

      {/* Per-forge refusals show next to the list, never instead of it: an expired GitLab token
          must not hide the GitHub repositories. */}
      {data.errors.map((e) => (
        <Banner key={e.forge} tone="wait" title={`${forgeText(e.forge).label} — ${e.error}`} />
      ))}
    </>
  );
}
