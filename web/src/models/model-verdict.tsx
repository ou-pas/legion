// The probe verdict, on one line. Presentational, so all four verdicts render in stories without
// network or API key, including `unverifiable`, which only happens on a subscription-only machine.
//
// None of the four is a refusal: that is the server's decision (`models-probe.ts`). An id missing
// from the SDK list can run fine, so the warning tone on `unknown` says "look", not "impossible".
import type { ProbeVerdict } from "../api/models.js";
import { Caption } from "../ui/text.js";
import { MODEL_TEXT } from "./text.js";

export function ModelVerdict({
  verdict,
  detail,
  checking = false,
}: {
  verdict?: ProbeVerdict;
  detail?: string;
  checking?: boolean;
}) {
  const t = MODEL_TEXT;
  if (checking) return <Caption>{t.checking}</Caption>;
  if (!verdict) return null;
  return (
    <Caption tone={verdict === "unknown" ? "wait" : "muted"}>
      {t.verdict[verdict]}
      {detail ? ` ${detail}` : ""}
      {verdict === "unknown" ? ` ${t.unknownWhy}` : ""}
    </Caption>
  );
}
