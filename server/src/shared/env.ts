// Minimal .env loader (review finding #1: nothing loaded server/.env).
// Zero-dependency on purpose; values already present in the environment win.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(HERE, "../../.env");

if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (!key || process.env[key] !== undefined) continue;
    const value = raw!.replace(/^["']|["']$/g, "");
    if (value) process.env[key] = value;
  }
  console.log(`[env] loaded ${ENV_PATH}`);
}

// Announce the active session auth at boot — masked, but enough to catch a bad paste instantly.
const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const apiKey = process.env.ANTHROPIC_API_KEY;
const describe = (v: string) => `${v.slice(0, 11)}… (${v.length} chars)`;
if (oauth && !oauth.startsWith("sk-ant-oat"))
  console.warn(
    `[auth] ⚠ CLAUDE_CODE_OAUTH_TOKEN does not look like an OAuth token (expected sk-ant-oat…): ${describe(oauth)}`,
  );
if (apiKey && apiKey.startsWith("sk-ant-oat"))
  console.warn(
    `[auth] ⚠ ANTHROPIC_API_KEY holds an OAuth token (sk-ant-oat…) — the API will reject it. Put it in CLAUDE_CODE_OAUTH_TOKEN.`,
  );
if (apiKey)
  console.log(
    `[auth] API key active: ${describe(apiKey)}${oauth ? " (takes precedence over the OAuth token)" : ""}`,
  );
else if (oauth) console.log(`[auth] subscription OAuth active: ${describe(oauth)}`);
else console.log("[auth] no Claude credential — sessions will run in mock mode");
