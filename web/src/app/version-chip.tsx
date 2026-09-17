// The top bar's version chip: it says a newer version EXISTS, not which one is installed.
//
// The colour says the gap, not whether it can be closed. The state used to be
// `blocker ? "idle" : "wait"`: when the update was blocked the chip went grey, leaving a neutral
// version number top right, exactly where apps show the INSTALLED version. A block is what makes the
// gap LAST, so the moment it most needs seeing; the reason stays in the tooltip
// (`versionBlockedTitle`).
//
// The arrow replaces the dot: the dot said nothing the colour did not, while a bare number reads as
// the current version. `↑ v0.28.2` says "the coming one". On 08/09 the confusion happened twice in
// one hour, both ways: the operator read the chip as the installed version, and so did the assistant
// reading a screenshot. A label you must hover to understand is not a label.
import { ArrowUp } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { VersionState } from "../api/version.js";
import { StatusChip } from "../ui/chip.js";
import { Link as UiLink } from "../ui/link.js";
import { SHELL_TEXT } from "./text/shell.js";
import "./version-chip.css";

/** `version` may be absent (first request) and `target` null (up to date): either way there is no
 *  chip. A permanent chip showing the current version was rejected on purpose: being behind is not
 *  a failure, and the bar need not always carry what the System screen says better. */
export function VersionChip({ version }: { version: VersionState | undefined }) {
  if (!version?.target) return null;
  return (
    // Points to `/system/general`, where `VersionPanel` lives since 02/09.
    <UiLink
      variant="inherit"
      className="version-chip"
      render={(p) => <Link to="/system/general" {...p} />}
    >
      <StatusChip
        state="wait"
        dot={false}
        title={
          version.blocker && version.reason
            ? SHELL_TEXT.topbar.versionBlockedTitle(version.target, version.reason)
            : SHELL_TEXT.topbar.versionTitle(version.target)
        }
      >
        <ArrowUp size={11} aria-hidden="true" />
        {version.target}
      </StatusChip>
    </UiLink>
  );
}
