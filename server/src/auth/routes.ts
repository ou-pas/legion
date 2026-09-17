import { Hono } from "hono";
import { resolveAuthIdentity } from "./identity.js";

export function registerAuthRoutes(app: Hono): void {
  // Says which credential is present, masked. Never the full value.
  app.get("/api/auth/identity", (c) => {
    return c.json(resolveAuthIdentity());
  });
}
