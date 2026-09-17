// The bar's three gestures: shell buttons, like those of `app/top-bar.tsx`, not routing.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Monitor, Moon, Search, Sun } from "lucide-react";
import { notificationsApi } from "../api/notifications.js";
import { IconButton } from "../ui/button.js";
import { useTheme } from "../ui/theme.js";
import { useToast } from "../ui/toast.js";
import { useCommandPalette } from "./CommandPalette.js";
import { SHELL_TEXT } from "./text/shell.js";

// A separate component and not a line in `Layout`: the palette provider is mounted BY `Layout`, so
// `useCommandPalette()` would always return null there.
//
// An icon rather than a wide field (direction-double-nav mockup, variant B): the bar now carries the
// machine state and what awaits a decision, and a 30 rem field pushed them off screen.
export function SearchButton() {
  const palette = useCommandPalette();
  return (
    <IconButton title={SHELL_TEXT.topbar.search} variant="quiet" onClick={() => palette?.open()}>
      <Search size={17} />
    </IconButton>
  );
}

// A theme only changes colours (see ui/theme-dark.css). A toggle, not a navigation entry: it flips a
// state and leads nowhere, so it lives in the bar, not the rail.
export function ThemeToggle() {
  const ctx = useTheme();
  if (!ctx) return null;
  // Three icons for three states: a screen when following the device, otherwise the chosen theme.
  // `aria-pressed` no longer fits: this is not a two-position switch anymore.
  const Icon = ctx.pref === "system" ? Monitor : ctx.pref === "dark" ? Moon : Sun;
  return (
    <IconButton
      title={SHELL_TEXT.topbar.theme(ctx.pref)}
      variant="quiet"
      className="ui-topbar-toggle"
      onClick={ctx.cycle}
    >
      <Icon size={17} />
    </IconButton>
  );
}

// Global kill switch for outgoing notifications. Not a route either, hence the bar.
export function NotifToggle() {
  const { data } = useQuery({
    queryKey: ["notifications"] as const,
    queryFn: () => notificationsApi.notifications(),
    staleTime: 30_000,
  });
  const qc = useQueryClient();
  const { push } = useToast();
  if (!data) return null;
  return (
    <IconButton
      title={SHELL_TEXT.topbar.notifications(data.enabled)}
      variant="quiet"
      className="ui-topbar-toggle"
      aria-pressed={data.enabled}
      onClick={() =>
        notificationsApi
          .toggleNotifications(!data.enabled)
          .then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))
          .catch((e: Error) =>
            push({ tone: "bad", title: SHELL_TEXT.topbar.notificationsFailed, body: e.message }),
          )
      }
    >
      {data.enabled ? <Bell size={17} /> : <BellOff size={17} />}
    </IconButton>
  );
}
