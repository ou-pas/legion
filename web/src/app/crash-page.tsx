// The screen that broke (14/09, direction A of `docs/directions/direction-erreur.html`).
//
// Why it exists: an installed app has no address bar, so no reload button. When a screen crashed
// there was no way out (no back, no refresh, and closing the app resumes where it was), and
// TanStack's default "Something went wrong" on white left the phone stuck there.
//
// It is an empty-state board, not a separate page: the app already has a language for "nothing to
// show" (`ui/empty.tsx`), and a broken screen is a case of it, with a tear as the series' only
// colour. An error drawing of its own would be a second grammar for the same situation.
//
// Two sentences because two causes, told apart by `crash.ts`: a stale screen after an update can
// PROMISE that reloading is enough; a real crash cannot.
//
// The bottom bar stays, and that matters most. This page renders INSIDE the shell in place of the
// screen alone, so navigation survives the failure. That is why it is wired to the router's
// `defaultErrorComponent`, which only replaces the route, and not around everything.
import { RotateCw } from "lucide-react";
import { Button } from "../ui/button.js";
import { Empty } from "../ui/empty.js";
import { Page } from "../ui/page.js";
import { Stack } from "../ui/flex.js";
import { crashMessage, isStaleScreen } from "./crash.js";
import { CRASH_TEXT } from "./text/crash.js";
import "./crash-page.css";

export function CrashPage({
  error,
  /** Injected so the page shows in the workshop without reloading it. In production it is
   *  `location.reload()` and nothing else: `router.invalidate()` would not do, since the missing
   *  file is precisely the one the document remembered. */
  onReload = () => location.reload(),
}: {
  error: unknown;
  onReload?: () => void;
}) {
  const stale = isStaleScreen(error);
  const detail = crashMessage(error);
  const t = stale ? CRASH_TEXT.stale : CRASH_TEXT.broken;
  return (
    <Page>
      <div className="app-crash">
        <Empty
          art="torn"
          title={t.title}
          action={
            <Stack gap={8} className="app-crash-actions">
              <Button variant="primary" leading={<RotateCw size={14} />} onClick={onReload}>
                {CRASH_TEXT.reload}
              </Button>
              {/* A native `<details>`, not React state: this page renders right after something
                  failed, the last place to depend on one more render. */}
              {detail && (
                <details className="app-crash-detail">
                  <summary>{CRASH_TEXT.detail}</summary>
                  <code>{detail}</code>
                </details>
              )}
            </Stack>
          }
        >
          {t.body}
        </Empty>
      </div>
    </Page>
  );
}
