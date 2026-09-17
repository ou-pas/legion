// General (02/09): what Infra carried without ever being about machines: running version, control
// plane identity, daily standup, webhooks. None of these panels depends on a Docker runner, so Infra
// now keeps only the fleet. The panels are gathered, not rewritten.
import { VersionPanel } from "../infra/VersionPanel.js";
import { ModelsPanel } from "../models/models-panel.js";
import { IdentityPanel } from "../infra/IdentityPanel.js";
import { StandupPanel } from "../notifications/StandupPanel.js";
import { WebhooksPanel } from "../notifications/WebhooksPanel.js";
import { PushPanel } from "../notifications/PushPanel.js";
import { InboundWebhooksPanel } from "../integrations/InboundWebhooksPanel.js";
import { Page } from "../ui/page.js";
import { Stack } from "../ui/flex.js";
import { SYSTEM_TEXT } from "./text.js";

export function GeneralScreen() {
  return (
    <Page title={SYSTEM_TEXT.tab.general} sub={SYSTEM_TEXT.generalSub}>
      <Stack gap={14}>
        {/* Version first: "what is running?" is the question asked on arrival, and it depends on
            no Docker daemon. */}
        <VersionPanel />
        <IdentityPanel />
        <StandupPanel />
        <WebhooksPanel />
        {/* Push right after the outgoing ones: same question, "what warns me?", with the operator
            as recipient, on their phone, app closed. */}
        <PushPanel />
        {/* Inbound next to outgoing but in THEIR domain (integrations/): they talk to forges (PR
            merged → task done), not to the operator. */}
        <InboundWebhooksPanel />
        {/* SDK models (02/09): the dedicated screen was a read-only catalog, four lines taking a
            whole navigation entry. `/systeme/modeles` redirects here. */}
        <ModelsPanel />
      </Stack>
    </Page>
  );
}
