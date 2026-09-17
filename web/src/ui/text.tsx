// Tones and sizes are literal unions. No `mono` prop: mono belongs to Code / CodeBlock / Kbd / Num
// (tokens.css).
import type { ReactNode } from "react";
import "./text.css";

/** `accent` (07/09): the label that locates ("Question 3 of 6" at the top of a questionnaire
 *  screen). Not a domain state, not a page-chosen color: the app's interactive tone on text, saying
 *  "you are here". */
export type TextTone = "default" | "muted" | "subtle" | "wait" | "bad" | "ok" | "accent";
export type TextSize = "2xs" | "xs" | "sm" | "md" | "lg";
export type TextWeight = "normal" | "medium" | "semi";
/** Style never depends on the tag, only on props. */
export type TextTag = "span" | "p" | "div" | "strong" | "em" | "li" | "dt" | "dd";

interface TextProps {
  tone?: TextTone;
  size?: TextSize;
  weight?: TextWeight;
  as?: TextTag;
  className?: string;
  id?: string;
  title?: string;
  children: ReactNode;
}

export function Text({
  tone = "default",
  size = "md",
  weight = "normal",
  as: Tag = "span",
  className,
  id,
  title,
  children,
}: TextProps) {
  return (
    <Tag
      id={id}
      title={title}
      className={["ui-text", className].filter(Boolean).join(" ")}
      data-tone={tone}
      data-size={size}
      data-weight={weight}
    >
      {children}
    </Tag>
  );
}

/** Timestamp, counter, detail under a field. Small and muted by default. */
export function Caption({
  tone = "muted",
  as = "span",
  weight,
  className,
  id,
  title,
  children,
}: Omit<TextProps, "size">) {
  return (
    <Text size="xs" tone={tone} as={as} weight={weight} className={className} id={id} title={title}>
      {children}
    </Text>
  );
}

/** Column header, rail heading, stat label. */
export function Label({
  tone = "subtle",
  as = "span",
  className,
  id,
  title,
  children,
}: Omit<TextProps, "size" | "weight">) {
  return (
    <Text
      size="2xs"
      weight="semi"
      tone={tone}
      as={as}
      id={id}
      title={title}
      className={["ui-label", className].filter(Boolean).join(" ")}
    >
      {children}
    </Text>
  );
}
