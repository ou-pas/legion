// Test configuration, kept apart from `vite.config.ts` on purpose: the dev server and production build
// have no use for jsdom, and mixing them means reading an app config to understand a failing test.
//
// One environment, jsdom, for every file including pure modules. Splitting by environment would save a
// few tens of milliseconds for one more rule to remember; not worth it while the suite runs in a second.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
