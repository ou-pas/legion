// Which Claude credential the control plane would actually use, read from its environment.

export type AuthKind = "api-key" | "oauth" | "none";

export interface AuthWarning {
  type: "oauth-in-api-key" | "oauth-malformed";
  message: string;
}

export interface AuthIdentity {
  kind: AuthKind;
  masked: string | null;
  warnings: AuthWarning[];
}

/** First 11 characters and the length, never more of the secret. */
function maskValue(value: string): string {
  return `${value.slice(0, 11)}… (${value.length} chars)`;
}

/** `ANTHROPIC_API_KEY` wins over `CLAUDE_CODE_OAUTH_TOKEN`. */
export function resolveAuthIdentity(env: NodeJS.ProcessEnv = process.env): AuthIdentity {
  const oauth = env.CLAUDE_CODE_OAUTH_TOKEN;
  const apiKey = env.ANTHROPIC_API_KEY;

  const warnings: AuthWarning[] = [];

  if (apiKey && apiKey.startsWith("sk-ant-oat")) {
    warnings.push({
      type: "oauth-in-api-key",
      message:
        "ANTHROPIC_API_KEY carries an OAuth token (sk-ant-oat…) — the API will refuse it. Put it in CLAUDE_CODE_OAUTH_TOKEN.",
    });
  }

  if (oauth && !oauth.startsWith("sk-ant-oat")) {
    warnings.push({
      type: "oauth-malformed",
      message: `CLAUDE_CODE_OAUTH_TOKEN does not look like an OAuth token (expected sk-ant-oat…)`,
    });
  }

  if (apiKey) {
    return {
      kind: "api-key",
      masked: maskValue(apiKey),
      warnings,
    };
  }

  if (oauth) {
    return {
      kind: "oauth",
      masked: maskValue(oauth),
      warnings,
    };
  }

  return {
    kind: "none",
    masked: null,
    warnings,
  };
}
