// Temporary, NOT committed: verification-only config for AI-2329's Legion redirect (task
// 8jZtM1gy9n). Proves that Vitest browser mode connects to a Playwright `run-server` over
// BROWSER_WS_ENDPOINT, the same mechanism the real shared browser-image exposes to sessions.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.browser-verify.test.tsx"],
    browser: {
      enabled: true,
      provider: playwright({
        connectOptions: {
          wsEndpoint: process.env.BROWSER_WS_ENDPOINT!,
        },
      }),
      instances: [{ browser: "chromium" }],
      headless: true,
    },
  },
});
