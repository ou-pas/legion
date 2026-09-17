import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // `changeOrigin: false` is required (15/09): without it local development is dead, every mutation
    // answers "origin not allowed", sign-in included. `crossOriginBlocked` (server/src/http/guard.ts)
    // compares the request `Origin` with its `Host`. Vite 6 rewrites `Host` to the proxy target
    // otherwise, so the server sees `localhost:8790` against an `Origin` of `localhost:5173`.
    // The shorthand form (`"/api": "http://localhost:8790"`) cannot say it, hence the object.
    proxy: { "/api": { target: "http://localhost:8790", changeOrigin: false } },
  },
});
