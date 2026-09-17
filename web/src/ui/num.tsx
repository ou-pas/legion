// Mono on purpose (a measure is a copyable literal, see tokens.css) with tabular figures: a column
// of costs that jitters is a defect. A figure inside a sentence stays `Text`, not `Num`.
import "./num.css";
import { LOCALE } from "./locale.js";

export type NumTone = "default" | "muted" | "subtle" | "wait" | "bad" | "ok";

const GROUPED = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 });
const MINUS = "−"; /* U+2212 MINUS SIGN, not the keyboard hyphen */
const THIN = " "; /* narrow no-break space before a suffix: "72 %", "3,821 ms" */

/** The sign, before the prefix. A delta always shows one, `±` at zero: it is a change, and an
 *  unsigned "0" would read as a value. A plain value shows only the minus, and nothing when it is
 *  not a number. */
function signOf(n: number, delta: boolean, known: boolean): string {
  if (delta) return n > 0 ? "+" : n < 0 ? MINUS : "±";
  return known && n < 0 ? MINUS : "";
}

/** Unless the caller overrides: up is good, down is bad, no change fades. A cost delta inverts
 *  the first two, hence the override. */
function deltaTone(n: number): NumTone {
  return n > 0 ? "ok" : n < 0 ? "bad" : "subtle";
}

export function Num({
  value,
  prefix,
  suffix,
  variant = "plain",
  tone,
  align = "start",
  className,
  id,
}: {
  /** A number is grouped with the display locale (`3,821`); a string renders as is, so an
   *  already formatted amount stays untouched. */
  value: number | string;
  /** Glued to the value: `$`. */
  prefix?: string;
  /** Separated by a narrow no-break space: `%`, `ms`, `k tokens`. */
  suffix?: string;
  /** `delta` shows an explicit sign and is colored by it. */
  variant?: "plain" | "delta";
  /** Needed for a cost delta, where `+` is bad news. */
  tone?: NumTone;
  /** `end` = right-aligned in its cell (table columns, figure rails). */
  align?: "start" | "end";
  className?: string;
  id?: string;
}) {
  const n = typeof value === "number" ? value : Number(value);
  const known = Number.isFinite(n);
  const delta = variant === "delta" && known;
  // The sign goes before the prefix ("−$0.18", not "$−0.18").
  const sign = signOf(n, delta, known);
  const magnitude =
    typeof value === "number" ? GROUPED.format(Math.abs(value)) : value.replace(/^[-+−]\s*/, "");
  const resolved = tone ?? (delta ? deltaTone(n) : "default");
  return (
    <span
      id={id}
      className={["ui-num", className].filter(Boolean).join(" ")}
      data-tone={resolved}
      data-align={align}
    >
      {sign}
      {prefix}
      {magnitude}
      {suffix == null ? null : THIN + suffix}
    </span>
  );
}
