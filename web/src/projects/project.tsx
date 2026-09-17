// Project, scoped by the URL (/p/$projectId/...), not by an "active project" hidden in
// localStorage. useProject() reads the route param; pages under /p/$projectId get their project,
// global surfaces (dashboard, inbox) have none. Only a "last visited project" stays in localStorage,
// to offer a default to the global composer.
import { Fragment, useEffect, useState } from "react";
import { Outlet, useNavigate, useParams, useRouterState, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FolderPlus, PackageOpen, Plus } from "lucide-react";
import { projectsApi, type Project } from "../api/projects.js";
import { bootstrapQuery, qk } from "../queries.js";
import { CrateImport } from "../portability/CrateImport.js";
import { Button } from "../ui/button.js";
import { Tag } from "../ui/chip.js";
import { Spacer, Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "../ui/modal.js";
import { NavItem, NavLabel } from "../ui/nav.js";
import { RailHead } from "../ui/rail-head.js";
import { Tab, TabList, TabPanel, Tabs } from "../ui/tabs.js";
import { ProjectSquare } from "./project-rail.js";
import { PROJECT_TEXT } from "./text/vocabulary.js";
import { railRowsFor } from "./rail-sections.js";
import { ProjectSwitch } from "./project-switch.js";
import { useTaskFacts } from "../tasks/task-facts.js";
import { TASK_VIEW_PATH } from "../tasks/task-views.js";
import "./rail-sections.css";

const LAST_KEY = "legion.lastProjectId";
export const readLastProjectId = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};

/** A <Link>'s active state comes from the router, not <NavItem>: `activeProps` adds the design
 *  system state class to the one NavItem computed (TanStack concatenates both). */
const NAV_ACTIVE = { className: "is-active" };

/** Current project = the URL's (null on global pages). */
export function useProject(): { project: Project | null; projectId: string | null } {
  const { data: boot } = useQuery(bootstrapQuery);
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = params.projectId ?? null;
  const project = (boot?.projects ?? []).find((p) => p.id === projectId) ?? null;
  return { project, projectId };
}

/** Layout of /p/$projectId routes: remembers the last visited project and renders the page. */
export function ProjectLayout() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  useEffect(() => {
    if (projectId) {
      try {
        localStorage.setItem(LAST_KEY, projectId);
      } catch {
        /* ignore */
      }
    }
  }, [projectId]);
  return <Outlet />;
}

/** The project rail: the open project's name, then its pages. It no longer lists other projects
 *  (they live in the icon rail since nav slice 02), and nothing global appears either.
 *
 *  Since slice 09 it renders two states: the project list, or a section's list (Settings, Library)
 *  that replaces it. Never both. What it shows is decided by the path, in `rail-sections.ts`; this
 *  file only draws it. */
export function ProjectRailNav() {
  const { project } = useProject();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // A task's views (nav slice 17) need its id besides the project's. Read from the URL, so the rail
  // stays decided by the path alone; `strict: false` because the shell mounts it on every route.
  const { taskId } = useParams({ strict: false }) as { taskId?: string };
  const { sub, rows } = railRowsFor(pathname);
  // The only data going up from the page to the rail: the number of pushed files, as a pill on
  // "Diff". The rows themselves do not move (see `tasks/task-facts.ts`).
  const facts = useTaskFacts(taskId);
  if (!project) return null;
  return (
    <>
      {/* The same head as System and the wiki (nav slice 06); the project puts its mark there, its
          initials on its hue. In a section it also carries the section name: the only place still
          saying where you are once the project list is replaced.

          The head opens the project menu (04/09, "flat" mock-up): the chevron says you can switch
          from here, and the list names projects in full where the icon rail only shows initials.
          The menu lives in `project-switch.tsx` since 14/09, because the phone bar needs it too;
          here we only provide what you press. */}
      <ProjectSwitch
        className="prj-rail-switch"
        trigger={
          <>
            {/* The project name alone (04/09): the section ("Library", "Task") is already written
            at the top of the bar, and repeating it here made the same word twice. */}
            <RailHead mark={<ProjectSquare project={project} size="sm" />} name={project.name} />
            <ChevronDown size={14} aria-hidden="true" className="prj-rail-switch-chevron" />
          </>
        }
      />
      {/* `key` on the level: changing level rebuilds the block, so the entry animation plays once;
          changing entry within the same list does not, so it does not replay. Motion repeating with
          nothing happening ends up reading as a display glitch.

          Direction is a property of the list, not of the trip: a section list always enters from
          the right, the project list from the left. No state or ref to hold; both ways of
          remembering the previous trip are refused by the linter (ref read during render, setState
          in an effect). The cost is small: on the app's very first render the rail also slides in
          with the rest of the shell. */}
      <div className="prj-rail-swap" key={sub ?? "projet"} data-move={sub ? "push" : "pop"}>
        {rows.map((s) => (
          <Fragment key={s.to}>
            {"group" in s && <NavLabel>{s.group}</NavLabel>}
            <NavItem
              icon={<s.Icon size={15} />}
              className={"back" in s ? "prj-rail-back" : undefined}
              badge={
                s.to === TASK_VIEW_PATH.pr && facts && facts.files > 0 ? (
                  <Tag title={PROJECT_TEXT.rail.filesChanged(facts.files)}>{facts.files}</Tag>
                ) : undefined
              }
              render={(props) => (
                <Link
                  to={s.to}
                  params={{ projectId: project.id, taskId }}
                  activeProps={NAV_ACTIVE}
                  {...props}
                />
              )}
            >
              {s.label}
            </NavItem>
          </Fragment>
        ))}
      </div>
    </>
  );
}

// Exported: the ⌘K palette reuses it.
//
// Two ways to be born (nav batch 2a): blank, or from a crate exported by another project. Import
// joined this modal because it creates a project and had nothing to do in an existing project's
// settings. `Tabs` chooses between two forms, not two screens: same rule as the board view choice
// (`ui/tabs.tsx`, "segmented" variant).
export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"blank" | "crate">("blank");
  const [name, setName] = useState("");
  const [fsRoot, setFsRoot] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState("");
  // A failure (slug collision, invalid URL) used to leave the modal frozen without a word (toast
  // audit 24/08). The refusal reads inside the modal, where you type.
  const create = async () => {
    if (!name.trim()) return;
    try {
      const p = await projectsApi.createProject({
        name,
        fsRoot: fsRoot || undefined,
        repoUrl: repoUrl || undefined,
      });
      await qc.invalidateQueries({ queryKey: qk.bootstrap });
      onClose();
      void navigate({ to: "/p/$projectId/board", params: { projectId: p.id } });
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  return (
    <Modal onClose={onClose}>
      <ModalHeader icon={<FolderPlus size={15} />}>{PROJECT_TEXT.newProject.title}</ModalHeader>
      <ModalBody>
        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as "blank" | "crate")}
          variant="segmented"
        >
          <TabList label={PROJECT_TEXT.newProject.modeLabel}>
            <Tab value="blank" icon={<FolderPlus size={14} />}>
              {PROJECT_TEXT.newProject.blank}
            </Tab>
            <Tab value="crate" icon={<PackageOpen size={14} />}>
              {PROJECT_TEXT.newProject.crate}
            </Tab>
          </TabList>
          <TabPanel value="blank">
            <Stack gap={12}>
              {/* data-autofocus: this field gets focus on open, not the close button. */}
              <Field label={PROJECT_TEXT.newProject.name} required>
                <Input
                  data-autofocus
                  placeholder={PROJECT_TEXT.newProject.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label={PROJECT_TEXT.newProject.fsRoot}>
                <Input
                  placeholder={PROJECT_TEXT.newProject.fsRootPlaceholder}
                  value={fsRoot}
                  onChange={(e) => setFsRoot(e.target.value)}
                />
              </Field>
              <Field
                label={PROJECT_TEXT.newProject.repoUrl}
                hint={PROJECT_TEXT.newProject.repoUrlHint}
              >
                <Input
                  placeholder={PROJECT_TEXT.newProject.repoUrlPlaceholder}
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
              </Field>
              {error && <FormError>{error}</FormError>}
            </Stack>
          </TabPanel>
          <TabPanel value="crate">
            {/* Its own "Create the project" button: the modal footer's has nothing to do here,
                see below. */}
            <CrateImport onImported={onClose} />
          </TabPanel>
        </Tabs>
      </ModalBody>
      {/* Only the blank form uses this footer: import has its own buttons ("Decrypt and
          preview", "Create the project", "Cancel") inside the card; doubling them here would give
          two "Create" buttons at different moments. */}
      {mode === "blank" && (
        <ModalFooter>
          <Button variant="quiet" onClick={onClose}>
            {PROJECT_TEXT.newProject.cancel}
          </Button>
          <Spacer />
          <Button
            variant="primary"
            leading={<Plus size={12} />}
            onClick={create}
            disabled={!name.trim()}
          >
            {PROJECT_TEXT.newProject.create}
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
}
