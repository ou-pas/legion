// The sign-in screen (13/09).
//
// Why it exists: the human API used to be authorized by the caller's address, and multi-machine
// runners made that distinction impossible. An agent container on a runner machine leaves through
// its host, so it arrives as 100.x, indistinguishable from the operator's browser. Measured on
// 13/09: a `curl` from a runner machine got 200 on `/api/bootstrap`. No address rule separates two
// processes on one machine; it takes a proof you hold.
//
// The token is kept nowhere here. It is sent once and the server answers with an `httpOnly` cookie
// this page cannot read back. Storing it in `localStorage` would make it something an injected
// script can exfiltrate.
import { useState, type FormEvent } from "react";
import { Orbit } from "lucide-react";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Field } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Text } from "../ui/text.js";
import { OPERATOR_TEXT } from "./text.js";
import "./sign-in.css";

export function SignIn({ onSignIn }: { onSignIn: (token: string) => Promise<void> }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSignIn(token.trim());
    } catch (err) {
      // The server only says "token refused": not whether a token exists, nor how many sessions
      // are open. Relayed as is.
      setError(err instanceof Error ? err.message : OPERATOR_TEXT.signIn.refused);
      setBusy(false);
    }
  }

  return (
    <div className="op-signin">
      <div className="op-signin-card">
        <div className="op-signin-head">
          <div className="op-signin-mark">
            <Orbit size={20} aria-hidden="true" />
            <Text size="lg" weight="semi">
              {OPERATOR_TEXT.signIn.title}
            </Text>
          </div>
          <Text tone="muted">{OPERATOR_TEXT.signIn.lede}</Text>
        </div>

        {error && <Banner tone="bad" title={error} />}

        <form className="op-signin-form" onSubmit={submit}>
          {/* A hidden username field, for the browser keychain. A lone password field does not
              look like a sign-in to Chrome/Safari, so nothing is offered for saving. Legion has
              one operator, so the value is fixed and the field is invisible. */}
          <input
            className="ui-sr"
            type="text"
            name="username"
            autoComplete="username"
            value="operator"
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
          <Field label={OPERATOR_TEXT.signIn.label} hint={OPERATOR_TEXT.signIn.hint}>
            <Input
              className="op-signin-field"
              type="password"
              name="password"
              value={token}
              autoFocus
              autoComplete="current-password"
              spellCheck={false}
              placeholder={OPERATOR_TEXT.signIn.placeholder}
              onChange={(e) => setToken(e.currentTarget.value)}
            />
          </Field>
          <Button type="submit" variant="primary" full loading={busy} disabled={!token.trim()}>
            {OPERATOR_TEXT.signIn.submit}
          </Button>
        </form>

        <Text as="p" size="sm" tone="muted">
          {OPERATOR_TEXT.signIn.lost}
        </Text>
      </div>
    </div>
  );
}
