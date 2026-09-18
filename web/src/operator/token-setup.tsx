// The first-run onboarding screen (18/09).
//
// Why it exists: the operator token is generated at the first boot that finds none and printed
// once, in the boot log — nowhere else, since the database only keeps its hash (operator.ts). A
// fresh install had no page saying so: the sign-in form assumed the token was already in hand, and
// finding it meant already knowing to scroll a terminal. This screen names both commands that get
// one (read the one already printed, or generate a new one) before handing off to the same entry
// gesture as SignIn.
//
// Shown only while no operator session has ever opened (`OperatorGate`, via
// `operatorApi.setupStatus`): once the operator has signed in at least once, they know the drill
// and see the plain SignIn screen like anyone returning.
import { Terminal } from "lucide-react";
import { CodeBlock } from "../ui/code.js";
import { Text } from "../ui/text.js";
import { TokenEntryForm } from "./token-entry-form.js";
import { OPERATOR_TEXT } from "./text.js";
import "./sign-in.css";
import "./token-setup.css";

export function TokenSetup({ onSignIn }: { onSignIn: (token: string) => Promise<void> }) {
  return (
    <div className="op-signin">
      <div className="op-signin-card">
        <div className="op-signin-head">
          <div className="op-signin-mark">
            <Terminal size={20} aria-hidden="true" />
            <Text size="lg" weight="semi">
              {OPERATOR_TEXT.setup.title}
            </Text>
          </div>
          <Text tone="muted">{OPERATOR_TEXT.setup.lede}</Text>
        </div>

        <ol className="op-setup-steps">
          <li>
            <Text as="p" size="sm">
              {OPERATOR_TEXT.setup.readStep}
            </Text>
            <CodeBlock label={OPERATOR_TEXT.setup.readCommandLabel}>
              {OPERATOR_TEXT.setup.readCommand}
            </CodeBlock>
          </li>
          <li>
            <Text as="p" size="sm">
              {OPERATOR_TEXT.setup.generateStep}
            </Text>
            <CodeBlock label={OPERATOR_TEXT.setup.generateCommandLabel}>
              {OPERATOR_TEXT.setup.generateCommand}
            </CodeBlock>
            <Text as="p" size="xs" tone="muted">
              {OPERATOR_TEXT.setup.generateDev}
            </Text>
          </li>
        </ol>

        <Text as="p" size="sm" tone="muted">
          {OPERATOR_TEXT.setup.pasteHint}
        </Text>

        <TokenEntryForm onSignIn={onSignIn} />
      </div>
    </div>
  );
}
