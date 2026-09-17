// A round being answered (07/09): values, comment, shown screen, and questions already SEEN. Out of the
// component so layout (rail, screen, recap) is only rendering, and "what does ⌘↵ do here" is one
// function.
//
// "Seen" ≠ "answered": a question left (Next, ⌘↵, a rail click) is decided even if untouched: going
// through six screens with ⌘↵ means "I follow you". The rail shows the answer only once the question
// is left; before, it shows the agent's recommendation. The raw value is set from the start
// (`initialValues`).
import { useMemo, useState } from "react";
import { FORM_COMMENT_KEY, type FormSpec } from "../api/inbox.js";
import {
  initialValues,
  isNoteKey,
  missingRequired,
  noteKey,
  noteOf,
  type RoundValues,
} from "./inbox-round-answers.js";
import { splitRound } from "./inbox-round-split.js";

/** Values SENT to the server: answers, non-empty per-question notes, plus the round comment under its
 *  sibling key when not empty. One function for final send and draft, or a resumed draft would not
 *  give what sending would have. A cleared note is not sent: a draft would return it as an extra key. */
const payload = (values: RoundValues, comment: string): RoundValues => {
  const kept = Object.fromEntries(
    Object.entries(values).filter(
      ([k, v]) => !isNoteKey(k) || (typeof v === "string" && v.trim() !== ""),
    ),
  );
  const note = comment.trim();
  return note ? { ...kept, [FORM_COMMENT_KEY]: note } : kept;
};

export function useRound(
  spec: FormSpec,
  onSubmit: (formData: RoundValues) => void,
  /** v62 (07/09): the RESUMED draft, laid OVER the agent's recommendations: an untouched question
   *  keeps its recommendation, a decided one its answer. `__comment` is removed and becomes the
   *  comment, or it would come back as an unknown field key on send.
   *
   *  Read only at MOUNT (`useState` initialiser): rereading each render would overwrite typing with
   *  what the server saved a second earlier. The page remounts the component (`key`) when a draft
   *  arrives from elsewhere, and only if nothing is pending locally. */
  initial?: RoundValues | null,
  /** Called on EVERY change with the full payload, what the draft saves. */
  onChange?: (formData: RoundValues) => void,
) {
  const round = useMemo(() => splitRound(spec), [spec]);
  const fields = useMemo(() => round.questions.map((q) => q.field), [round]);
  const [values, setValues] = useState<RoundValues>(() => {
    const { [FORM_COMMENT_KEY]: _comment, ...answers } = initial ?? {};
    return { ...initialValues(fields), ...answers };
  });
  const [comment, setComment] = useState(() =>
    typeof initial?.[FORM_COMMENT_KEY] === "string" ? initial[FORM_COMMENT_KEY] : "",
  );
  /** 0 … n-1: a question; n: the recap. */
  const [step, setStep] = useState(0);
  /** A RESUMED question is already decided: otherwise the rail of a two-answer draft would show the
   *  recommendation again under both decided questions. */
  const [seen, setSeen] = useState<ReadonlySet<string>>(
    () =>
      new Set(Object.keys(initial ?? {}).filter((k) => k !== FORM_COMMENT_KEY && !isNoteKey(k))),
  );

  const count = round.questions.length;
  const single = count === 1;
  const atRecap = step === count;
  const missing = missingRequired(fields, values);

  const go = (to: number) => {
    const leaving = round.questions[step]?.field.id;
    if (leaving !== undefined) setSeen((s) => (s.has(leaving) ? s : new Set([...s, leaving])));
    setStep(Math.max(0, Math.min(count, to)));
  };
  const setValue = (id: string, next: unknown) => {
    const nextValues = { ...values, [id]: next };
    setValues(nextValues);
    onChange?.(payload(nextValues, comment));
  };
  /** ONE question's note: same path as its value, under the sibling key. */
  const setNote = (id: string, next: string) => setValue(noteKey(id), next);
  const noteFor = (id: string) => noteOf(values, id);
  const changeComment = (next: string) => {
    setComment(next);
    onChange?.(payload(values, next));
  };
  const submit = () => {
    if (missing.length > 0) return;
    onSubmit(payload(values, comment));
  };
  /** What ⌘↵ does: send where sending is offered, advance everywhere else. */
  const advance = () => {
    if (atRecap || single) submit();
    else go(step + 1);
  };

  return {
    round,
    values,
    setValue,
    noteFor,
    setNote,
    comment,
    setComment: changeComment,
    step,
    go,
    seen,
    count,
    single,
    atRecap,
    missing,
    submit,
    advance,
  };
}

export type RoundState = ReturnType<typeof useRound>;
