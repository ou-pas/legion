// The page of a task that cannot be found. Its own module because two routes render it since slice
// nav/13: the page itself when the id names nothing, and the old `/tasks/<id>` address, whose
// redirect to the project then has nowhere to go. Redirecting anyway would build an address with an
// unknown project, a second error hiding the first.
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../ui/button.js";
import { Empty } from "../ui/empty.js";
import { Page } from "../ui/page.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";

export function TaskAbsent() {
  const navigate = useNavigate();
  return (
    <Page>
      <Empty
        variant="page"
        title={TASK_PAGE_TEXT.notFound.title}
        action={
          <Button onClick={() => navigate({ to: "/" })}>{TASK_PAGE_TEXT.notFound.back}</Button>
        }
      >
        {TASK_PAGE_TEXT.notFound.why}
      </Empty>
    </Page>
  );
}
