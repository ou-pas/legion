# Browser-mode tests

A session with the browser grant already receives `BROWSER_WS_ENDPOINT`, the shared browser's
address ([[guides/capacites]]). Until now the only documented use was a manual Playwright
script: connect, load a page, screenshot. A project's own Vitest suite can reach the same service,
for component tests that need a real browser, hover included, not a DOM emulator.

## Why this page exists

Three sessions on a different agent's task read Vitest browser mode as impossible in a sandbox:
no root, no system libraries, a `playwright install` that refuses to run. All three obstacles were
about installing a browser locally. They do not apply here, because the browser already runs,
elsewhere: the shared service. Nothing to install, nothing to launch, only a client that connects.

## Wiring a project's Vitest config

Two packages, both dev-only: `@vitest/browser-playwright` (Vitest's own provider) and `playwright`
(its peer dependency, even in connect-only mode where no local browser ever launches). Pin
`playwright` to the SAME version as the shared service, `1.62.1` as of this writing
(`browser-image/Dockerfile`): `chromium.connect()` refuses a client older or newer than the server.
`playwright-core` is not enough here; the provider imports from the full package.

```ts
// vitest.config.browser.ts, a separate config from the jsdom one: the two run under different
// conditions (BROWSER_WS_ENDPOINT present or not) and mixing them in one file means reading past
// an `if` to see which tests actually run.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright({
        connectOptions: { wsEndpoint: process.env.BROWSER_WS_ENDPOINT! },
      }),
    },
  },
});
```

A test, using `vitest/browser`'s locators for anything that needs a real pointer (`@vitest/browser/context`
still works but is deprecated as of Vitest 4.1.11, which prints so on import):

```tsx
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "@testing-library/react";

test("hover reveals the tooltip", async () => {
  render(<NodeCard />);
  await userEvent.hover(page.getByRole("button", { name: "settings" }));
  await expect.element(page.getByText("Open settings")).toBeVisible();
});
```

Run it with the endpoint set, same as the manual script:

```
BROWSER_WS_ENDPOINT=$BROWSER_WS_ENDPOINT npx vitest run --config vitest.config.browser.ts
```

## What this proves, and how it was checked

Verified from inside an agent session (task 8jZtM1gy9n), against a local `playwright run-server`
1.62.1 standing in for the shared service (same protocol, so the result holds for the real one):
a component rendered, and a `hover()` interaction produced the state change it caused in a real
DOM. Full transcript in the task's artifact.

The one thing this DOES need, which the manual-script path does not: the project's own
`package.json` carries `playwright` as a devDependency. Left alone, its postinstall tries to
download Chromium on every `pnpm install`, which stalls or fails behind a "limited" network's
allowlist, since connect-only mode never needs a local browser. `session-image` sets
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` by default so that download never starts.

## The hover question, settled

An earlier attempt at this, on a different project, found `locator.hover()` unreliable under
`chrome-headless-shell` specifically (6 failures in 80 passes on one file, 10 in 12 on another,
identical on `main`, so environmental rather than a real defect). The shared service does not run
the headless shell: `browser-image/Dockerfile` builds on the official Playwright image, which ships
full Chromium, and the verification above used exactly that path. Hover passed. If a future project
sees the same flake through this connection, it is a new finding, not a repeat of the old one, and
worth its own report rather than a silent retry.

## Read next

[[guides/capacites]] for the grant itself, [[concepts/runner]] for what a session receives.
