// The design system workshop. Replaced Ladle on 25/08, which had replaced the /ds page the day before.
//
// Ladle built a JavaScript identifier from a story's display name, which broke the build on our
// labels (quotes, arrows); it shared the app's Vite cache, which blanked the front end; and it had no
// test harness, while Storybook can check that a story renders.
import { hostname } from "node:os";
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  // Stories are co-located (`ui/button.tsx` next to `ui/button.stories.tsx`), so a module without
  // stories is visible in its folder.
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: { name: "@storybook/react-vite", options: {} },
  // Reachable under the machine's hostname, not only localhost. In an agent session, `make ds` is
  // opened from the runner's shared browser, which lives in another container where "localhost" is
  // itself. Storybook's host check (DNS rebinding protection) answered `403 Invalid host` on
  // `iframe.html` and all 260 stories showed an empty canvas (measured: the body was
  // `<pre>Invalid host</pre>`).
  //
  // Only this one name is added, not `allowedHosts: true`; localhost and 127.0.0.1 stay allowed by
  // default.
  core: { allowedHosts: [hostname()] },
  // A cache separate from the app's. Both servers run under `make dev`; sharing `node_modules/.vite`
  // let the last one started overwrite the other's optimised dependencies, and the front end went
  // blank without a console error.
  viteFinal: (cfg) => ({ ...cfg, cacheDir: "node_modules/.vite-storybook", server: { ...cfg.server, allowedHosts: true } }),
};

export default config;
