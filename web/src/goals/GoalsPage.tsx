import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { goalsQuery } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Empty } from "../ui/empty.js";
import { List } from "../ui/list.js";
import { Page } from "../ui/page.js";
import { Tab, TabList, TabPanel, Tabs } from "../ui/tabs.js";
import { Toolbar } from "../ui/toolbar.js";
import { useProject } from "../projects/project.js";
import { GoalComposerModal } from "./GoalComposer.js";
import { GoalRow } from "./goal-row.js";
import { goalViewCounts, goalsInView, type GoalView } from "./goal-list-view.js";
import { GOAL_TEXT } from "./text.js";

export function GoalsPage() {
  const { project } = useProject();
  const { data: goals = [] } = useQuery(goalsQuery(project?.id ?? ""));
  const [creating, setCreating] = useState(false);
  // The default shows WHAT IS AT STAKE. Finished goals are neither hidden nor archived (D1): they are
  // one tab away, with their count on it.
  const [view, setView] = useState<GoalView>("live");
  const counts = goalViewCounts(goals);
  const shown = goalsInView(goals, view);

  const create = (
    <Button variant="primary" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
      {GOAL_TEXT.list.create}
    </Button>
  );

  return (
    <Page title={GOAL_TEXT.list.title} sub={GOAL_TEXT.list.sub}>
      {goals.length === 0 ? (
        <Empty variant="page" title={GOAL_TEXT.list.empty} action={create}>
          {GOAL_TEXT.list.emptyWhy}
        </Empty>
      ) : (
        // One panel: the three tabs filter THE SAME list, they do not open three contents.
        <Tabs variant="segmented" value={view} onValueChange={(v) => setView(v as GoalView)}>
          {/* The create gesture on the SAME line as the tabs (04/09): with no page title, an action
              alone on its line left an empty row above. */}
          <Toolbar label={GOAL_TEXT.list.filterLabel} end={create}>
            <TabList label={GOAL_TEXT.list.filterLabel}>
              <Tab value="live" count={counts.live}>
                {GOAL_TEXT.list.filterLive}
              </Tab>
              <Tab value="done" count={counts.done}>
                {GOAL_TEXT.list.filterDone}
              </Tab>
              <Tab value="all" count={counts.all}>
                {GOAL_TEXT.list.filterAll}
              </Tab>
            </TabList>
          </Toolbar>
          <TabPanel value={view}>
            {shown.length === 0 ? (
              <Empty
                variant="page"
                art="filtered"
                title={view === "done" ? GOAL_TEXT.list.emptyDone : GOAL_TEXT.list.emptyLive}
                action={
                  view === "live" ? (
                    <Button onClick={() => setView("all")}>{GOAL_TEXT.list.showAll}</Button>
                  ) : undefined
                }
              >
                {view === "done" ? GOAL_TEXT.list.emptyDoneWhy : GOAL_TEXT.list.emptyLiveWhy}
              </Empty>
            ) : (
              <Card pad={false}>
                <List label={GOAL_TEXT.list.label}>
                  {shown.map((g) => (
                    <GoalRow key={g.id} goal={g} />
                  ))}
                </List>
              </Card>
            )}
          </TabPanel>
        </Tabs>
      )}
      {creating && <GoalComposerModal onClose={() => setCreating(false)} />}
    </Page>
  );
}
