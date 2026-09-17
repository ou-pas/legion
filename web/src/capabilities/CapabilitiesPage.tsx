// Library: the project's five registries, skills (dropzone), rules (permanent instructions), chains
// (with the agent holding each role under each installed chain), external MCP servers, network
// environments. Per-agent grants stay on the Agents page; here the libraries are managed. Each
// registry lives in its own file next to this one.
//
// "Capabilities" until 12/09: the word named both this screen and, in the wiki, what is granted to
// an agent. It keeps its single wiki meaning (`docs/wiki/guides/capacites.md`); the URL path stays
// `capabilities`.
//
// Five routes, not five tabs (nav slice 09): a tab is not an address, so no link to a project's MCP
// servers and no back button. The rail lists them (`projects/rail-sections.ts`) and this page is a
// branch; each registry carries its own `<Page>`. Only one registry is mounted at a time, and
// leaving a route is a real departure: there is no draft to preserve behind it.
import type { ReactNode } from "react";
import { Outlet } from "@tanstack/react-router";
import { Banner } from "../ui/banner.js";
import { Page } from "../ui/page.js";
import { ChainsSection } from "../chains/ChainsSection.js";
import { EnvironmentsSection } from "./EnvironmentsSection.js";
import { McpSection } from "./McpSection.js";
import { RulesSection } from "./RulesSection.js";
import { SkillsSection } from "./SkillsSection.js";
import { CAPABILITIES_PAGE_TEXT as T } from "./text/page.js";
import { useProject } from "../projects/project.js";

/** The branch. "Library" is written at the top of the rail, next to the project name; the screen
 *  title names the open registry. */
export function CapabilitiesPage() {
  return <Outlet />;
}

/** The four registries belonging to a project. The banner stays: the project comes from the URL,
 *  but it is read from bootstrap, which may not have arrived on first render, and four registries
 *  out of five then have nothing to show. */
function ProjectRegistry({
  title,
  children,
}: {
  title: string;
  children: (projectId: string) => ReactNode;
}) {
  const { project } = useProject();
  return (
    <Page title={title} sub={T.sub}>
      {project ? (
        children(project.id)
      ) : (
        <Banner tone="info" title={T.noProjectTitle}>
          {T.noProjectBody}
        </Banner>
      )}
    </Page>
  );
}

/** Skills are the only global registry: a library on disk, shared by the whole installation. They
 *  need no project to show, only to tick the project default; `SkillsSection` handles that half-case. */
export function SkillsScreen() {
  const { project } = useProject();
  return (
    <Page title={T.tabs.skills} sub={T.sub}>
      <SkillsSection project={project} />
    </Page>
  );
}

export function RulesScreen() {
  return (
    <ProjectRegistry title={T.tabs.rules}>
      {(id) => <RulesSection projectId={id} />}
    </ProjectRegistry>
  );
}

export function ChainsScreen() {
  return (
    <ProjectRegistry title={T.tabs.chains}>
      {(id) => <ChainsSection projectId={id} />}
    </ProjectRegistry>
  );
}

export function McpScreen() {
  return (
    <ProjectRegistry title={T.tabs.mcp}>{(id) => <McpSection projectId={id} />}</ProjectRegistry>
  );
}

export function EnvironmentsScreen() {
  return (
    <ProjectRegistry title={T.tabs.environments}>
      {(id) => <EnvironmentsSection projectId={id} />}
    </ProjectRegistry>
  );
}
