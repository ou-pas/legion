// The interactive gesture (13/09, extracted 18/09): password-styled token field, submit, busy and
// error state. Shared between SignIn and TokenSetup, which show the same gesture behind a
// different lede: the operator learns one motion, not two, and a fix to the submit logic only
// happens once.
//
// The token is kept nowhere here. It is sent once and the server answers with an `httpOnly` cookie
// this page cannot read back. Storing it in `localStorage` would make it something an injected
// script can exfiltrate.
import { useState, type FormEvent } from "react";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Field } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { OPERATOR_TEXT } from "./text.js";
import "./token-entry-form.css";

export function TokenEntryForm({ onSignIn }: { onSignIn: (token: string) => Promise<void> }) {
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
    <>
      {error && <Banner tone="bad" title={error} />}
      <form className="op-entry-form" onSubmit={submit}>
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
            className="op-entry-field"
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
    </>
  );
}
