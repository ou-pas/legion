// Ephemeral notifications. Bounded bottom-right stack, timer paused on hover and focus (a
// notification being read must not run away).
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleCheck, Clock, Info, TriangleAlert, X } from "lucide-react";
import { IconBtn } from "./button.js";
import { UI_TEXT } from "./vocabulary.js";
import "./toast.css";

export type ToastTone = "info" | "ok" | "wait" | "bad";

export interface ToastSpec {
  tone?: ToastTone;
  title: string;
  body?: ReactNode;
  /** One way out ("View session"), never two. */
  action?: ReactNode;
  /** Lifetime in ms; the timer pauses while the stack is hovered or focused. */
  duration?: number;
}

const TICK = 100; // timer step
const EXIT = 200; // ≈ var(--dur-2): time for the exit animation to finish
const VISIBLE = 3; // beyond this, the stack becomes a counter
const DEFAULT_MS = 6000;

interface Live extends ToastSpec {
  id: number;
  left: number;
  leaving?: boolean;
}

const TONE_ICON: Record<ToastTone, ReactNode> = {
  info: <Info size={14} aria-hidden="true" />,
  ok: <CircleCheck size={14} aria-hidden="true" />,
  wait: <Clock size={14} aria-hidden="true" />,
  bad: <TriangleAlert size={14} aria-hidden="true" />,
};

/** One timer for the whole stack: visible toasts run down, queued ones only start once shown,
 *  leaving ones finish their animation. */
function step(paused: boolean) {
  return (prev: Live[]): Live[] =>
    prev
      .map((t, i) => {
        if (t.leaving) return { ...t, left: t.left - TICK };
        if (paused || i >= VISIBLE) return t;
        const left = t.left - TICK;
        return left > 0 ? { ...t, left } : { ...t, leaving: true, left: EXIT };
      })
      .filter((t) => !t.leaving || t.left > 0);
}

const PushContext = createContext<((toast: ToastSpec) => void) | null>(null);

/** Mount once at the top of the app. `push` is stable, usable as an effect dependency. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Live[]>([]);
  const paused = useRef(false);
  const seq = useRef(0);
  const count = items.length;

  const push = useCallback((toast: ToastSpec) => {
    seq.current += 1;
    // The id is fixed here, not in the updater: five pushes in a row are applied together by React
    // and would all read the same counter, already incremented five times.
    const id = seq.current;
    setItems((prev) => [{ ...toast, id, left: toast.duration ?? DEFAULT_MS }, ...prev]);
  }, []);
  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true, left: EXIT } : t)));
  }, []);

  useEffect(() => {
    if (count === 0) return;
    const handle = window.setInterval(() => setItems(step(paused.current)), TICK);
    return () => window.clearInterval(handle);
  }, [count]);

  const extra = count - VISIBLE;
  return (
    <PushContext value={push}>
      {children}
      <div
        className="ui-toast-region"
        role="region"
        aria-label={UI_TEXT.toastRegion}
        aria-live="polite"
        onMouseEnter={() => {
          paused.current = true;
        }}
        onMouseLeave={() => {
          paused.current = false;
        }}
        onFocusCapture={() => {
          paused.current = true;
        }}
        onBlurCapture={() => {
          paused.current = false;
        }}
      >
        {items.slice(0, VISIBLE).map((t) => (
          <Toast
            key={t.id}
            tone={t.tone}
            title={t.title}
            action={t.action}
            leaving={t.leaving}
            onClose={() => dismiss(t.id)}
          >
            {t.body}
          </Toast>
        ))}
        {extra > 0 && <p className="ui-toast-more">{UI_TEXT.toast.pending(extra)}</p>}
      </div>
    </PushContext>
  );
}

export function useToast(): { push: (toast: ToastSpec) => void } {
  const push = use(PushContext);
  if (!push) throw new Error("useToast() must be called inside <ToastProvider>.");
  return { push };
}

/** Exported to be placed as is (story, screenshot). */
export function Toast({
  tone = "info",
  title,
  action,
  onClose,
  leaving = false,
  closeLabel = UI_TEXT.dismissToast,
  className,
  children,
}: {
  tone?: ToastTone;
  title: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
  leaving?: boolean;
  closeLabel?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={["ui-toast", className].filter(Boolean).join(" ")}
      data-tone={tone}
      data-leaving={leaving ? "true" : undefined}
      role={tone === "bad" ? "alert" : "status"}
    >
      <span className="ui-toast-icon">{TONE_ICON[tone]}</span>
      <div className="ui-toast-text">
        <p className="ui-toast-title">{title}</p>
        {children != null && <div className="ui-toast-body">{children}</div>}
        {action != null && <div className="ui-toast-action">{action}</div>}
      </div>
      {onClose && (
        <IconBtn title={closeLabel} variant="quiet" onClick={onClose}>
          <X size={13} />
        </IconBtn>
      )}
    </div>
  );
}
