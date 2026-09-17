// The frame shared by the eight settings sections.
//
// They were eight tabs under one header; they are eight routes since nav slice 09, so each carries
// its own `<Page>`. This module holds what they share and nothing else: the section title, the
// project facts, and the one case with nothing to configure.
//
// The three chips stay. They showed on all eight tabs because the header sat outside them; losing
// them in the move to routes would remove the output folder from the whole app, the only place
// `fsRoot` is written once the project exists.
import type { ReactNode } from "react";
import type { Project } from "../api/projects.js";
import { Tag } from "../ui/chip.js";
import { Empty } from "../ui/empty.js";
import { Row } from "../ui/flex.js";
import { Page } from "../ui/page.js";
import { useProject } from "./project.js";
import { PROJECT_PAGE_TEXT as T } from "./text/project-page.js";

/** `children` is a function of the project: four of the eight sections need it (name, hue,
 *  execution, crate), and passing it after the guard avoids eight copied `if (!project)`, each a
 *  chance to forget one. */
export function SettingsPage({
  title,
  children,
}: {
  title: string;
  children: (project: Project) => ReactNode;
}) {
  const { project } = useProject();
  // The project comes from the URL and the parent route refuses an unknown id, so this empty state
  // only happens on the very first render, before bootstrap arrives. Say so anyway: a screen showing
  // empty cards without explanation is worse than one that waits.
  if (!project)
    return (
      <Page title={T.empty.title}>
        <Empty variant="page" title={T.empty.heading}>
          {T.empty.why}
        </Empty>
      </Page>
    );
  return (
    <Page
      title={title}
      sub={
        <Row gap={8} wrap>
          <Tag>{project.slug}</Tag>
          <Tag title={T.defaultModelWhy}>{T.defaultModel(project.defaultModel)}</Tag>
          {project.fsRoot && <Tag title={T.fsRootWhy}>{project.fsRoot}</Tag>}
        </Row>
      }
    >
      {children(project)}
    </Page>
  );
}
