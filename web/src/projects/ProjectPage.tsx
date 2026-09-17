// Project settings: eight subjects, grouped by the question you ask rather than by the table that
// stored them (navigation audit, 09/09): what it is (General), how it touches git (Repositories),
// its keys (Secrets), what it connected outside (Integrations, 15/09), which model it runs
// (Models), what its sessions run with (Sessions), its crate, its deletion.
//
// Eight routes, not eight tabs (nav slice 09): a tab is not an address, so no link to the crate and
// no back button. The rail lists them (`projects/rail-sections.ts`), this page is a branch, and
// each section carries its own `<Page>` through `SettingsPage`. The Context row went into General
// and the Chains row's role → agent mapping into Library › Chains (12/09); both routes still
// redirect.
//
// This file holds no card (06/09). Each is a stateful form (draft, dirty, a fading "Saved") whose
// states nobody could see without running the app and breaking something on purpose. They live in
// `<name>-card.tsx` and receive their project as a prop rather than reading the URL, which makes
// them mountable in stories.
import { Outlet } from "@tanstack/react-router";
import { Folder } from "lucide-react";
import { Card } from "../ui/card.js";
import { Field } from "../ui/form.js";
import { Code } from "../ui/code.js";
import { Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { ConnectionsCard } from "../connections/connections-card.js";
import { CrateExport } from "../portability/CrateExport.js";
import { CRATE_TEXT } from "../portability/text.js";
import { ContextCard } from "./context-card.js";
import { CredentialsCard } from "./credentials-card.js";
import { DangerCard } from "./danger-card.js";
import { ProjectHueCard } from "./hue-picker.js";
import { GitIdentityCard } from "./git-identity-card.js";
import { ModelRoutingCard } from "./model-routing-card.js";
import { ProjectNameCard } from "./project-name-card.js";
import { ReposCard } from "./repos-section.js";
import { SecretsCard } from "./secrets-card.js";
import { SessionRuntimeCard } from "./session-runtime-card.js";
import { SettingsPage } from "./settings-page.js";
import { SshKeyCard } from "./ssh-key-card.js";
import { PROJECT_PAGE_TEXT as T } from "./text/project-page.js";
import { PROJECT_GENERAL_TEXT } from "./text/general.js";
import { SESSION_RUNTIME_TEXT } from "./text/session-runtime.js";

/** The branch. Title and project chips are no longer set here: each section has its own
 *  (`settings-page.tsx`), and "Settings" is written at the top of the rail. */
export function ProjectPage() {
  return <Outlet />;
}

// The eight sections, one per route. The frame is shared; title and content change. The router
// mounts these components, never the cards directly: the frame carries the header and the one case
// with no project to configure.

/** General (nav batch 2a): what the project is (name, colour, id, injected context) plus its output
 *  folder, read-only. It gathers what lived under "Secrets & identity" (name, colour) and the old
 *  Context tab, two places answering "what is this project". */
export function ProjectGeneralScreen() {
  return (
    <SettingsPage title={T.tabs.general}>
      {(project) => (
        <Stack gap={14}>
          <ProjectNameCard project={project} />
          {/* The colour right under the name: both are what you recognise in the rail without
              reading. */}
          <ProjectHueCard project={project} />
          {/* Read-only (navigation audit): the folder is chosen at creation, in the new project
              modal, not here. Editable, it would suggest already produced artifacts can move. */}
          <Card icon={<Folder size={16} />} title={PROJECT_GENERAL_TEXT.fsRoot.title}>
            <Field label={PROJECT_GENERAL_TEXT.fsRoot.label}>
              {project.fsRoot ? (
                <Code>{project.fsRoot}</Code>
              ) : (
                <Text tone="muted" size="sm">
                  {PROJECT_GENERAL_TEXT.fsRoot.empty}
                </Text>
              )}
            </Field>
          </Card>
          <ContextCard project={project} />
        </Stack>
      )}
    </SettingsPage>
  );
}

/** Repositories: three settings answering "how does this project touch git": the repositories,
 *  their commit identity (from the old "Secrets & identity") and the SSH key (from the old
 *  "Execution"). */
export function ReposScreen() {
  return (
    <SettingsPage title={T.tabs.repos}>
      {(project) => (
        <Stack gap={14}>
          <ReposCard projectId={project.id} />
          <GitIdentityCard project={project} />
          <SshKeyCard project={project} />
        </Stack>
      )}
    </SettingsPage>
  );
}

export function ModelRoutingScreen() {
  return (
    <SettingsPage title={T.tabs.models}>
      {(project) => <ModelRoutingCard project={project} />}
    </SettingsPage>
  );
}

/** Secrets: two key lists, one page, the project's secrets and its Claude accounts. What remains
 *  only answers "which keys does this project carry". */
export function SecretsScreen() {
  return (
    <SettingsPage title={T.tabs.secrets}>
      {(project) => (
        <Stack gap={14}>
          {/* "Why does my session run on this account" comes before secrets in general. */}
          <CredentialsCard project={project} />
          <SecretsCard project={project} />
        </Stack>
      )}
    </SettingsPage>
  );
}

/** Integrations: what this project connected outside. One card today; multi-provider issues will
 *  land here in batch 3. Next to Secrets, not inside: to the operator a connection is a provider
 *  you connect, and the secret is only its consequence. */
export function IntegrationsScreen() {
  return (
    <SettingsPage title={T.tabs.integrations}>
      {(project) => <ConnectionsCard project={project} />}
    </SettingsPage>
  );
}

export function RuntimeScreen() {
  return (
    <SettingsPage title={SESSION_RUNTIME_TEXT.tab}>
      {(project) => <SessionRuntimeCard project={project} />}
    </SettingsPage>
  );
}

/** The crate has its own section: the only settings gesture taking data out of the project. Import
 *  left (nav batch 2a): it creates another project, so it lives in the new project modal
 *  (`projects/project.tsx`). */
export function CrateScreen() {
  return (
    <SettingsPage title={CRATE_TEXT.tab}>
      {(project) => <CrateExport projectId={project.id} />}
    </SettingsPage>
  );
}

export function DangerScreen() {
  return (
    <SettingsPage title={T.tabs.danger}>
      {(project) => <DangerCard project={project} />}
    </SettingsPage>
  );
}

// The "account quota" card used to live here and was removed on 30/08: the plan percentage needs a
// credential from a normal sign-in, and the control-plane token comes from `claude setup-token`,
// refused on `/api/oauth/profile`, `/api/oauth/usage` and even in the CLI. A missing scope, not an
// implementation defect. The out-of-quota pause lives in `server/src/sessions/quota-pause.ts`.
