// One tone = one triplet (fg / wash / line): the page never writes a color.
import type { ReactNode } from "react";
import { CircleCheck, Clock, Info, Stamp, TriangleAlert, X } from "lucide-react";
import { IconBtn } from "./button.js";
import { UI_TEXT } from "./vocabulary.js";
import "./banner.css";

export type BannerTone = "info" | "wait" | "bad" | "ok" | "gate";

/** One icon per tone, never chosen by the caller: that is what makes the tone recognisable
 *  from one screen to the next. */
const TONE_ICON: Record<BannerTone, ReactNode> = {
  info: <Info size={15} aria-hidden="true" />,
  wait: <Clock size={15} aria-hidden="true" />,
  bad: <TriangleAlert size={15} aria-hidden="true" />,
  ok: <CircleCheck size={15} aria-hidden="true" />,
  gate: <Stamp size={15} aria-hidden="true" />,
};

export function Banner({
  tone = "info",
  title,
  actions,
  onClose,
  closeLabel = UI_TEXT.dismissBanner,
  className,
  children,
}: {
  tone?: BannerTone;
  title: ReactNode;
  actions?: ReactNode;
  /** Passing onClose makes the banner dismissible; otherwise no close button appears. */
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
  /** One sentence, not a paragraph. */
  children?: ReactNode;
}) {
  return (
    <div
      className={["ui-banner", className].filter(Boolean).join(" ")}
      data-tone={tone}
      role={tone === "bad" ? "alert" : "status"}
    >
      <span className="ui-banner-icon">{TONE_ICON[tone]}</span>
      <div className="ui-banner-text">
        <p className="ui-banner-title">{title}</p>
        {children != null && <div className="ui-banner-body">{children}</div>}
      </div>
      {actions != null && <div className="ui-banner-actions">{actions}</div>}
      {onClose && (
        <IconBtn title={closeLabel} variant="quiet" onClick={onClose}>
          <X size={14} />
        </IconBtn>
      )}
    </div>
  );
}
