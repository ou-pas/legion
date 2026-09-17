// The concierge thread: a panel in the bar, and the page. The same component.
//
// Pure presentation, like `sessions/steer-field.tsx`: it holds typing and the displayed thread; the
// caller talks to the server (`onAsk`). Stories can show every state without network, and the "no
// write tool" guarantee stays a server contract (three belts, tested on the control plane), never
// reinvented here.
//
// - `onAsk` does not receive history: the server carries it (`concierge_turns`). The local turns
//   here are screen optimism, not a source of truth.
// - `initialTurns` renders a resumed conversation. Read at mount only, on purpose: switching
//   conversation uses a `key`, not a sync effect that would overwrite what was just typed.
// - `lead` receives the situation report, the first turn of the conversation, which is why the
//   page has no empty state.
//
// Every promise makes its failure visible: a server refusal (timeout, ephemeral session that could
// not start) shows in full under the field, never swallowed.
import { useState, type FormEvent, type ReactNode } from "react";
import { Send } from "lucide-react";
import { type ConciergeTurn } from "../api/concierge.js";
import { Button } from "../ui/button.js";
import { Empty } from "../ui/empty.js";
import { FormError } from "../ui/form.js";
import { Row, Stack } from "../ui/flex.js";
import { Input } from "../ui/input.js";
import { Markdownish } from "../ui/markdownish.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Text } from "../ui/text.js";
import { CONCIERGE_TEXT } from "./text.js";
import "./concierge-panel.css";
import { CHAT_ROLE } from "../api/concierge.js";

export function ConciergePanel({
  onAsk,
  initialTurns = [],
  lead,
  footer,
  size = "md",
  defaultText = "",
  className,
}: {
  /** Asks the server and resolves the answer. Rejects with the server's refusal, whose sentence is
   *  shown as is. History is not passed: the server rereads it. */
  onAsk: (message: string) => Promise<string>;
  /** Turns already said, reread server side. Read at mount only (see header). */
  initialTurns?: ConciergeTurn[];
  /** The situation report, at the head of the thread. Its presence removes the empty state. */
  lead?: ReactNode;
  /** Under the field: the link to the page from the bar's hover panel. */
  footer?: ReactNode;
  /** `fill` takes the height left by the parent, which the page needs. */
  size?: "md" | "fill";
  /** Initial field value. Exists for stories; the app does not need it. */
  defaultText?: string;
  className?: string;
}) {
  const [turns, setTurns] = useState<ConciergeTurn[]>(initialTurns);
  const [text, setText] = useState(defaultText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = !busy && text.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const message = text.trim();
    setTurns((t) => [...t, { role: CHAT_ROLE.user, content: message }]);
    setText("");
    setBusy(true);
    setError(null);
    onAsk(message)
      .then((reply) => setTurns((t) => [...t, { role: CHAT_ROLE.assistant, content: reply }]))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className={["cc-panel", className].filter(Boolean).join(" ")} data-size={size}>
      <ScrollArea
        size={size === "fill" ? "fill" : "md"}
        follow
        count={turns.length}
        label={CONCIERGE_TEXT.label}
        className="cc-panel-scroll"
      >
        {lead != null && <div className="cc-panel-lead">{lead}</div>}
        {turns.length === 0 && lead == null ? (
          <Empty variant="inline" title={CONCIERGE_TEXT.empty.title}>
            {CONCIERGE_TEXT.empty.body}
          </Empty>
        ) : (
          <Stack gap={12}>
            {turns.map((t, i) => (
              <div key={i} className="cc-turn" data-who={t.role}>
                <Text size="xs" tone="muted" weight="semi" as="div" className="cc-turn-who">
                  {t.role === CHAT_ROLE.user ? CONCIERGE_TEXT.you : CONCIERGE_TEXT.name}
                </Text>
                <div className="cc-turn-body">
                  <Markdownish text={t.content} />
                </div>
              </div>
            ))}
            {busy && (
              <div className="cc-turn" data-who="assistant" data-pending="true">
                <Text size="xs" tone="muted" weight="semi" as="div" className="cc-turn-who">
                  {CONCIERGE_TEXT.name}
                </Text>
                <Text tone="subtle" size="sm">
                  {CONCIERGE_TEXT.thinking}
                </Text>
              </div>
            )}
          </Stack>
        )}
      </ScrollArea>
      <form className="cc-panel-form" onSubmit={submit}>
        <Row gap={6} flex={1} minWidth={0}>
          <Input
            value={text}
            disabled={busy}
            aria-label={CONCIERGE_TEXT.label}
            placeholder={CONCIERGE_TEXT.placeholder}
            onChange={(e) => setText(e.target.value)}
          />
          {/* No `title` on a disabled button: Chrome and Safari do not show it. The empty field
              is enough to say why the button does not send. */}
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!ready}
            leading={<Send size={13} />}
          >
            {CONCIERGE_TEXT.ask}
          </Button>
        </Row>
        {error !== null && <FormError>{error}</FormError>}
        {footer}
      </form>
    </div>
  );
}
