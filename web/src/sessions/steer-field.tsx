// Saying something to an agent WHILE it works (v23). Before, the only moment to talk to it was
// when IT asked a question: you watched a session go astray, or stopped it. This field is the other
// direction: the message enters the conversation as a user turn, without pausing.
//
// Pure presentation on purpose: the component holds typing and send feedback, the caller talks to
// the server (`onSend`). Stories can show every state without the API, and the refusal rule lives
// in ONE place (the control plane answers 409 with its reason, see server/src/sessions/steering.ts).
//
// The refusal is shown VERBATIM under the field: the 409 body is written for a human, and turning
// it into a generic "error" would throw away the only useful information.
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "../ui/button.js";
import { Row } from "../ui/flex.js";
import { FormError, FormOk } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { isSubmitKey } from "../ui/submit-key.js";
import { SubmitShortcut } from "../ui/submit-shortcut.js";
import { SESSION_TEXT } from "./text.js";
import "./steer-field.css";

export function SteerField({
  onSend,
  agentName,
  defaultText = "",
  placeholder,
  className,
}: {
  /** Rejects with the server's refusal, whose sentence is shown verbatim. */
  onSend: (text: string) => Promise<unknown>;
  /** Named in the confirmation, rather than "the agent". */
  agentName?: string;
  /** Exists for stories; the app does not need it. */
  defaultText?: string;
  /** The same field serves two destinations (03/09): steering a running session, or a message to a
   *  task without a live session, which RELAUNCHES it. The placeholder lets the screen say so.
   *  Absent = the steering label. */
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(defaultText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const who = agentName ? SESSION_TEXT.steer.toAgent(agentName) : SESSION_TEXT.steer.anyAgent;
  const ready = !busy && text.trim().length > 0;

  const submit = () => {
    if (!ready) return;
    const message = text.trim();
    setBusy(true);
    setError(null);
    setSent(null);
    // The failure is VISIBLE, under the field: a silently refused send is exactly the defect this
    // field exists to remove.
    onSend(message)
      .then(() => {
        setText("");
        setSent(message);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className={["ui-steer", className].filter(Boolean).join(" ")}>
      <Row gap={6} flex={1} minWidth={0}>
        <Input
          value={text}
          disabled={busy}
          aria-label={SESSION_TEXT.steer.label(who)}
          placeholder={placeholder ?? SESSION_TEXT.steer.placeholder}
          onChange={(e) => setText(e.target.value)}
          // Plain Enter does NOT send (07/09, ui/submit-key.ts): this field talks to an agent, the
          // very gesture whose accidental sending cost the convention. Only ⌘/Ctrl+Enter and the
          // button send.
          onKeyDown={(e) => {
            if (isSubmitKey(e)) submit();
            else if (e.key === "Enter") e.preventDefault();
          }}
        />
        <Button
          variant="primary"
          loading={busy}
          disabled={!ready}
          onClick={submit}
          leading={<Send size={13} />}
          shortcut={<SubmitShortcut />}
        >
          {SESSION_TEXT.steer.send}
        </Button>
      </Row>
      {error !== null && <FormError>{error}</FormError>}
      {error === null && sent !== null && <FormOk>{SESSION_TEXT.steer.sent(who, sent)}</FormOk>}
    </div>
  );
}
