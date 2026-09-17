// The inbox questionnaire (07/09), direction A of inbox-decoupes.html chosen by the operator: one
// decision per screen, a recap to send. It replaces a `FormSpec` rendered in one block (all markdown,
// then all fields, a button at the bottom), where the decision drowned in its justification.
//
// Layout: on the left the rail (`ui/step-rail`), with the chosen answer under each question; on the
// right one screen per question, then the recap holding comment and send. ⌘↵ advances, and sends
// where sending is offered. Focus follows the screen, landing on the title at each change for those who
// do not see the page move. The agent receipt (evidence, impact) lives on the item
// (inbox-round-context.tsx), not in the FormSpec.
//
// ONE FIELD (`InboxForm` decides): no rail or recap, one question with comment and send under its
// options. A one-line recap rereads nothing and adds a screen.
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Check, Send } from "lucide-react";
import type { FormSpec } from "../api/inbox.js";
import type { PickedAttachmentsWiring } from "../tasks/use-picked-attachments.js";
import { Button } from "../ui/button.js";
import { Stack } from "../ui/flex.js";
import { StepRail, StepRailDivider, StepRailItem } from "../ui/step-rail.js";
import { isSubmitKey } from "../ui/submit-key.js";
import { SubmitShortcut } from "../ui/submit-shortcut.js";
import { InboxQuestionStep, RoundFoot } from "./inbox-question-step.js";
import { answerLabel, type RoundValues } from "./inbox-round-answers.js";
import { InboxRoundRecap, RoundComment } from "./inbox-round-recap.js";
import type { RoundQuestion } from "./inbox-round-split.js";
import { ReplyAttachments } from "./reply-attachments.js";
import { INBOX_TEXT } from "./text.js";
import { useRound, type RoundState } from "./use-round.js";
import "./inbox-questionnaire.css";

const T = INBOX_TEXT.questionnaire;

/** Under a rail entry: the answer once the question is left, otherwise the recommendation. */
function railSub(q: RoundQuestion, values: RoundValues, seen: ReadonlySet<string>): string {
  const label = answerLabel(q.field, values[q.field.id]);
  if (seen.has(q.field.id) && label !== null) return label;
  if (!seen.has(q.field.id) && q.field.default !== undefined && label !== null)
    return T.recommendedValue(label);
  return T.toDecide;
}

function Rail({ r, go }: { r: RoundState; go: (to: number) => void }) {
  return (
    <StepRail
      label={T.railLabel}
      heading={T.railHeading(r.count)}
      progress={{ value: r.step + 1, max: r.count + 1, label: T.progress }}
    >
      {r.round.questions.map((q, i) => (
        <StepRailItem
          key={q.field.id}
          index={i + 1}
          title={q.field.label}
          sub={railSub(q, r.values, r.seen)}
          current={r.step === i}
          onSelect={() => go(i)}
          done={r.seen.has(q.field.id) && answerLabel(q.field, r.values[q.field.id]) !== null}
        />
      ))}
      <StepRailDivider />
      <StepRailItem
        index={<Check size={13} aria-hidden="true" />}
        title={T.recap.nav}
        sub={T.recap.navSub}
        current={r.atRecap}
        onSelect={() => go(r.count)}
      />
    </StepRail>
  );
}

function SendButton({ r, pending }: { r: RoundState; pending: boolean }) {
  return (
    <Button
      variant="primary"
      size="md"
      disabled={r.missing.length > 0}
      loading={pending}
      onClick={r.submit}
      leading={<Send size={14} aria-hidden="true" />}
      shortcut={<SubmitShortcut />}
    >
      {T.send(r.count)}
    </Button>
  );
}

export function InboxQuestionnaire({
  spec,
  pending,
  onSubmit,
  initial,
  onChange,
  attachments,
}: {
  spec: FormSpec;
  pending: boolean;
  onSubmit: (formData: RoundValues) => void;
  /** v62 (07/09): the resumed draft, laid over the agent's recommendations. */
  initial?: RoundValues | null;
  /** Called on each change with the full payload, saved as a debounced draft (`use-inbox-draft.ts`).
   *  Absent where no draft is kept: a one-question round is answered in one click. */
  onChange?: (formData: RoundValues) => void;
  /** Screenshot attaching for the round (16/09): the answer to "where does it break?" is often an
   *  image, and describing it wastes work on both sides.
   *
   *  Attached at the RECAP, next to the comment, the sending screen. ⌘V paste works from ANY screen
   *  of the round (the event bubbles up to the frame), since the screenshot is taken while reading the
   *  question. */
  attachments?: PickedAttachmentsWiring;
}) {
  const r = useRound(spec, onSubmit, initial, onChange);
  const pane = useRef<HTMLDivElement>(null);
  const navigated = useRef(false);
  // Focus follows the screen, but not on mount: a question expanding in a queue must not steal focus.
  useEffect(() => {
    if (navigated.current) pane.current?.querySelector<HTMLElement>(".inbox-qz-title")?.focus();
  }, [r.step]);
  const go = (to: number) => {
    navigated.current = true;
    r.go(to);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!isSubmitKey(e)) return;
    e.preventDefault();
    navigated.current = true;
    r.advance();
  };
  // ⌘/Ctrl+↵ also works WITHOUT focus inside (07/09 evening, the shortcut seemed broken). The handler
  // above only hears focused descendants; a freshly opened page has focus nowhere, so the announced
  // shortcut did nothing until an option was clicked. The window is listened to, leaving priority to
  // what is inside (already handled) and to any input elsewhere.
  const advance = useRef(r.advance);
  // Written in an effect, not during render (`react/refs`): the ref is only read by the listener.
  useEffect(() => {
    advance.current = r.advance;
  }, [r.advance]);
  useEffect(() => {
    const onWindowKey = (e: globalThis.KeyboardEvent) => {
      // `isSubmitKey` reads a React event (`nativeEvent.isComposing`): hand it the native one.
      if (!isSubmitKey({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, nativeEvent: e }))
        return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      // Inside, `onKey` answers: without this guard a ⌘↵ on an option would advance twice.
      if (target && pane.current?.closest(".inbox-qz")?.contains(target)) return;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      )
        return;
      e.preventDefault();
      navigated.current = true;
      advance.current();
    };
    window.addEventListener("keydown", onWindowKey);
    return () => window.removeEventListener("keydown", onWindowKey);
  }, []);
  const missingIndexes = r.missing.map(
    (f) => r.round.questions.findIndex((q) => q.field.id === f.id) + 1,
  );
  const question = r.round.questions[r.step];

  return (
    <Stack gap={0} className="inbox-qz" onKeyDown={onKey}>
      {/* ⌘V from ANY round screen: paste bubbles from the fields up to here, like the send shortcut to
          `onKeyDown` above. */}
      <div
        className="inbox-qz-body"
        data-single={r.single ? "true" : undefined}
        onPaste={attachments?.paste}
      >
        {!r.single && <Rail r={r} go={go} />}
        <div className="inbox-qz-pane" ref={pane}>
          {question ? (
            <InboxQuestionStep
              question={question}
              value={r.values[question.field.id]}
              onChange={(v) => r.setValue(question.field.id, v)}
              note={r.single ? undefined : r.noteFor(question.field.id)}
              onNote={r.single ? undefined : (v) => r.setNote(question.field.id, v)}
            >
              {r.single ? (
                <>
                  <RoundComment value={r.comment} onChange={r.setComment} />
                  {attachments && <ReplyAttachments files={attachments} />}
                  <RoundFoot action={<SendButton r={r} pending={pending} />} />
                </>
              ) : (
                <RoundFoot
                  onPrev={r.step > 0 ? () => go(r.step - 1) : undefined}
                  action={
                    <Button
                      variant="primary"
                      size="md"
                      onClick={() => go(r.step + 1)}
                      shortcut={<SubmitShortcut />}
                    >
                      {r.step === r.count - 1 ? T.toRecap : T.next}
                    </Button>
                  }
                />
              )}
            </InboxQuestionStep>
          ) : (
            <InboxRoundRecap
              fields={r.round.questions.map((q) => q.field)}
              values={r.values}
              comment={r.comment}
              onComment={r.setComment}
              onEdit={go}
            >
              {attachments && <ReplyAttachments files={attachments} />}
              <RoundFoot
                onPrev={() => go(r.count - 1)}
                note={missingIndexes.length > 0 ? T.missing(missingIndexes) : undefined}
                action={<SendButton r={r} pending={pending} />}
              />
            </InboxRoundRecap>
          )}
        </div>
      </div>
    </Stack>
  );
}
