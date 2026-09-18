// The sign-in screen (13/09).
//
// Why it exists: the human API used to be authorized by the caller's address, and multi-machine
// runners made that distinction impossible. An agent container on a runner machine leaves through
// its host, so it arrives as 100.x, indistinguishable from the operator's browser. Measured on
// 13/09: a `curl` from a runner machine got 200 on `/api/bootstrap`. No address rule separates two
// processes on one machine; it takes a proof you hold.
//
// The token itself is kept nowhere: `TokenEntryForm` sends it once and the server answers with an
// `httpOnly` cookie this page cannot read back. Storing it in `localStorage` would make it
// something an injected script can exfiltrate.
import { Orbit } from "lucide-react";
import { Text } from "../ui/text.js";
import { TokenEntryForm } from "./token-entry-form.js";
import { OPERATOR_TEXT } from "./text.js";
import "./sign-in.css";

export function SignIn({ onSignIn }: { onSignIn: (token: string) => Promise<void> }) {
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

        <TokenEntryForm onSignIn={onSignIn} />

        <Text as="p" size="sm" tone="muted">
          {OPERATOR_TEXT.signIn.lost}
        </Text>
      </div>
    </div>
  );
}
