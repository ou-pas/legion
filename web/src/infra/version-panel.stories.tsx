// Every state of update tracking: started, server silent, back, too long, target missed. These
// specimens are pure; the wired VersionPanel tests the integration with mutations and cache.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Spinner } from "../ui/spinner.js";
import { Stack } from "../ui/flex.js";
import { VERSION_TEXT } from "./text-version.js";
import "./version-panel.css";

const meta = { title: "infra / VersionPanel — update tracking" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const PhaseStartedServerAnswers: Story = {
  name: "Phase 1 — Launched: the server responds, update in progress",
  render: () => (
    <Stack gap={10}>
      <Banner tone="wait" title={VERSION_TEXT.updateInProgress("v0.6.0")}>
        <Stack gap={8}>
          <div className="version-panel-update-spinner">
            <Spinner size="sm" label={VERSION_TEXT.updateInProgress("v0.6.0")} />
          </div>
        </Stack>
      </Banner>
    </Stack>
  ),
};

export const PhaseRestartingServerSilent: Story = {
  name: "Phase 2 — Restarting: the server is silent (fetch fails, that's expected)",
  render: () => (
    <Stack gap={10}>
      <Banner tone="wait" title={VERSION_TEXT.updateRestarting}>
        <Stack gap={8}>
          <div className="version-panel-update-spinner">
            <Spinner size="sm" label={VERSION_TEXT.updateRestarting} />
          </div>
        </Stack>
      </Banner>
    </Stack>
  ),
};

export const PhaseSucceededBackOnTargetVersion: Story = {
  name: "Phase 3a — Success: the server comes back on v0.6.0",
  render: () => (
    <Stack gap={10}>
      <Banner tone="ok" title={VERSION_TEXT.updateComplete("v0.6.0")}>
        <Stack gap={8}>
          <div className="version-panel-update-note">{VERSION_TEXT.updateCompleteNote}</div>
          <Button size="sm" variant="primary" disabled>
            {VERSION_TEXT.updateReload}
          </Button>
        </Stack>
      </Banner>
    </Stack>
  ),
};

export const PhaseFailedTargetMissed: Story = {
  name: "Phase 3b — Failure: the server comes back on v0.5.0 instead of v0.6.0",
  render: () => (
    <Stack gap={10}>
      <Banner tone="bad" title={VERSION_TEXT.updateMismatch("v0.5.0", "v0.6.0")}>
        <Stack gap={8}>
          <div className="version-panel-update-note">
            {VERSION_TEXT.updateMismatchNote("/var/log/legion-update.log")}
          </div>
          <Button size="sm" variant="default" disabled>
            Retry
          </Button>
        </Stack>
      </Banner>
    </Stack>
  ),
};

export const PhaseTimeoutTooLong: Story = {
  name: "Phase 4 — Timeout: more than 10 minutes without a response",
  render: () => (
    <Stack gap={10}>
      <Banner tone="bad" title={VERSION_TEXT.updateTimeout(11)}>
        <Stack gap={8}>
          <div className="version-panel-update-note">{VERSION_TEXT.updateTimeoutNote}</div>
          <Button size="sm" variant="default" disabled>
            Start over
          </Button>
        </Stack>
      </Banner>
    </Stack>
  ),
};

export const PhaseInitialBannerBeforePolling: Story = {
  name: 'Initial phase — "update launched" banner before polling starts',
  render: () => (
    <Stack gap={10}>
      <Banner tone="wait" title={VERSION_TEXT.startedTitle}>
        {VERSION_TEXT.startedBody("/var/log/legion-update.log", "docker")}
      </Banner>
    </Stack>
  ),
};
