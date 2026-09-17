// An amount billed by the SDK: always two decimals, mono with tabular figures. It is the value as
// the API bills it, data to copy, not a prose number to localise.
import { Num, type NumTone } from "../ui/num.js";

export function CostValue({
  usd,
  tone = "muted",
  align = "start",
}: {
  /** `null`/`undefined` = cost not known yet (running session): nothing is rendered. */
  usd: number | null | undefined;
  tone?: NumTone;
  /** `end` in a column of figures (row meta, table cell). */
  align?: "start" | "end";
}) {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return null;
  return <Num value={usd.toFixed(2)} prefix="$" tone={tone} align={align} />;
}
