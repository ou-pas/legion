// The daily standup card, presentational. Wiring (read and mutations) lives in `StandupPanel`, the
// same split as elsewhere (VersionPanel/version-card in infra): a presentational component renders
// in stories without a server.
import { Sunrise } from "lucide-react";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { CodeBlock } from "../ui/code.js";
import { Field, FormError } from "../ui/form.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Select } from "../ui/select.js";
import { Banner } from "../ui/banner.js";
import { STANDUP_TEXT } from "./text-standup.js";

const HOURS = ["", ...Array.from({ length: 24 }, (_, i) => String(i))];

export function StandupCard({
  hour,
  preview,
  onHourChange,
  onSend,
  sending = false,
  hourError,
  sendError,
  sent = false,
}: {
  /** `null` = disabled, `undefined` = not read yet. */
  hour: number | null | undefined;
  preview?: string;
  onHourChange: (hour: number | null) => void;
  onSend: () => void;
  sending?: boolean;
  hourError?: string;
  sendError?: string;
  /** A manual send changes nothing on screen (no time, no preview): without this word, a successful
   *  click reads as a click that did nothing. */
  sent?: boolean;
}) {
  return (
    <Card icon={<Sunrise size={16} />} title={STANDUP_TEXT.title} desc={STANDUP_TEXT.desc}>
      <Stack gap={10}>
        <Row gap={10} wrap align="flex-end">
          <Field label={STANDUP_TEXT.sendAt}>
            <Select
              value={hour ?? ""}
              onChange={(e) => onHourChange(e.target.value === "" ? null : Number(e.target.value))}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h === "" ? STANDUP_TEXT.disabled : STANDUP_TEXT.hour(h)}
                </option>
              ))}
            </Select>
          </Field>
          <Spacer />
          <Button onClick={onSend} disabled={sending}>
            {sending ? STANDUP_TEXT.sending : STANDUP_TEXT.sendNow}
          </Button>
        </Row>
        {hourError && <FormError>{hourError}</FormError>}
        {sendError && <FormError>{sendError}</FormError>}
        {sent && <Banner tone="ok" title={STANDUP_TEXT.sent} />}
        {preview && (
          <CodeBlock variant="preview" label={STANDUP_TEXT.previewLabel}>
            {preview}
          </CodeBlock>
        )}
      </Stack>
    </Card>
  );
}
