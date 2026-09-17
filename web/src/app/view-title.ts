// The document title on a task view: "Diff · The issues we are after".
//
// The defect it fixes: a task's nine tabs shared one title, "Task", and ten browser tabs open on
// three tasks could not be told apart.
//
// The name comes from the CACHE through the route's `queryClient`, not the parent route's
// `loaderData`. Same data (the route loader puts it there with `ensureQueryData`), but TYPED: the
// first version cast `loaderData as [unknown, { tasks: … }]`, and a reordered loader tuple would
// have silently dropped the title back to "Task". The `queryClient` comes from
// `ctx.match.context`, not a singleton, so a test mounting the real tree with its own cache checks
// what the app does.
//
// The "Task" fallback is not decorative: the list may not know this id yet (deleted task, stale
// link), and a truncated title is worth less than a generic one.
import type { QueryClient } from "@tanstack/react-query";
import { tasksQuery } from "../queries.js";
import { SHELL_TEXT } from "./text/shell.js";

/** What a route `head` returns: the document `<title>`. */
type Head = { meta: { title: string }[] };

/** Exported because the route tree also uses it for screens that carry no object. */
export const title = (page: string) => (): Head => ({ meta: [{ title: `${page} · Legion` }] });

export const viewTitle =
  (view: string) =>
  (ctx: { match: { context: { queryClient: QueryClient } }; params: { taskId: string } }): Head => {
    const name = ctx.match.context.queryClient
      .getQueryData(tasksQuery.queryKey)
      ?.tasks.find((t) => t.id === ctx.params.taskId)?.name;
    return title(`${view} · ${name ?? SHELL_TEXT.route.task}`)();
  };
