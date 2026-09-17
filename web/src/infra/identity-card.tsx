// The Identity card (26/08): what the control plane authenticates with, and what is wrong.
//
// Why a card rather than a line: the failure it catches is silent. An OAuth token stored in
// `ANTHROPIC_API_KEY` is refused by the API with nothing saying why; sessions fail one by one, and
// you look at Docker. The server can detect the case; it only had to be shown.
//
// Presentational: it receives state and fetches nothing. The wired component is `IdentityPanel`,
// next to it, which gives stories to its four states, including those a working machine cannot
// produce.
import { KeyRound } from "lucide-react";
import type { AuthIdentity } from "../api/auth.js";
import { StatusChip } from "../ui/chip.js";
import { Code } from "../ui/code.js";
import { Empty } from "../ui/empty.js";
import { Stack } from "../ui/flex.js";
import { Panel, PanelHeader, PanelNote, PanelRow } from "../ui/panel.js";
import { Caption } from "../ui/text.js";
import { IDENTITY_TEXT } from "./text-identity.js";

export function IdentityCard({ identity }: { identity: AuthIdentity }) {
  const t = IDENTITY_TEXT;
  return (
    <Panel>
      <PanelHeader icon={<KeyRound size={15} />} title={t.title}>
        <StatusChip state={identity.kind === "none" ? "bad" : "ok"}>
          {t.kind[identity.kind]}
        </StatusChip>
      </PanelHeader>

      {identity.kind === "none" ? (
        <PanelRow>
          <Empty variant="panel" title={t.noneTitle}>
            {t.noneBody}
          </Empty>
        </PanelRow>
      ) : (
        <PanelRow>
          <Stack gap={4}>
            <Code>{identity.masked ?? "—"}</Code>
            <Caption>{t.maskedWhy}</Caption>
          </Stack>
        </PanelRow>
      )}

      {/* One note per detected defect, with the server's sentence word for word: the server
          recognises the case, and rewording it here would drift at the first change. */}
      {identity.warnings.map((w) => (
        <PanelNote key={w.type} tone="bad">
          {w.message}
        </PanelNote>
      ))}
    </Panel>
  );
}
