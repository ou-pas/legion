// The PROPOSAL end to end: what /api/tasks/classify proposes, what the operator pins, and the
// EFFECTIVE value coming out of both, field by field. Split from `TaskComposer.tsx` on 06/09, where
// the classification effect (a debounce, a sequence, twelve dependencies) read like an accident in
// the middle of a form.
import { useEffect, useRef, useState } from "react";
import { tasksApi } from "../api/tasks.js";
import { type Classify, type Level } from "./task-composer-context.js";

/** Long enough to finish a word, not a sentence: every keystroke restarts the countdown, and a haiku
 *  round trip only goes out on a real typing pause. */
const CLASSIFY_DEBOUNCE_MS = 700;

export interface ClassifyProposal {
  /** The operator's RAW choice ("" while untouched), not the effective value. */
  mode: string;
  effectiveMode: string;
  isTemplate: boolean;
  /** EFFECTIVE gate and complexity: the pin, else the proposal, else the default. */
  gate: boolean;
  complexity: Level;
  value: Classify | null;
  pending: boolean;
  pinned: { target: boolean; complexity: boolean; gate: boolean };
  setMode: (v: string) => void;
  setGate: (v: boolean) => void;
  setComplexity: (v: Level) => void;
  /** After a submit: no proposal, no pin, settings back to defaults. */
  reset: () => void;
  /** After a project change: pins pointed at the old project's agents. Chosen VALUES stay; only
   *  targets that no longer exist go. */
  resetForProject: () => void;
}

/** Nothing left to propose: the target is pinned, and either it is a chain (no complexity nor gate)
 *  or the two other fields are pinned too. The hook stops calling the classifier, the proposal line
 *  says "by hand". */
export function nothingLeftToPropose(
  pinned: { target: boolean; complexity: boolean; gate: boolean },
  isChain: boolean,
): boolean {
  return pinned.target && (isChain || (pinned.complexity && pinned.gate));
}

/** The EFFECTIVE mode: which agent or chain the task gets if run as is. In order: the operator's pin,
 *  the classifier's proposal IF it names something that still exists, what was already chosen, then
 *  the first agent. A proposal naming a deleted agent or an uninstalled chain is ignored: it would
 *  show a choice that cannot run. */
function effectiveModeOf(p: {
  value: Classify | null;
  mode: string;
  pinned: boolean;
  agents: { id: string }[];
  templates: { id: string }[];
}): string {
  const { value, mode, agents, templates } = p;
  const proposed = value
    ? value.kind === "chain" && value.templateId && templates.some((t) => t.id === value.templateId)
      ? `tpl:${value.templateId}`
      : value.agentId && agents.some((a) => a.id === value.agentId)
        ? value.agentId
        : ""
    : "";
  const manual = agents.some((a) => a.id === mode) || mode.startsWith("tpl:") ? mode : "";
  return (p.pinned && manual) || proposed || manual || agents[0]?.id || "";
}

export function useClassifyProposal(input: {
  project: { id: string } | null;
  demo: boolean;
  text: string;
  detail: string;
  agents: { id: string }[];
  templates: { id: string }[];
}): ClassifyProposal {
  const { project, demo, text, detail, agents, templates } = input;
  const [value, setValue] = useState<Classify | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [mode, setModeState] = useState(""); // "" = follow the proposal · agent id · "tpl:<id>"
  const [gate, setGateState] = useState(false);
  const [complexity, setComplexityState] = useState<Level>("med");
  // Per-field pins: touching ONE setting constrains the classifier on THAT field, the others keep
  // being proposed around it (operator feedback).
  const [modePinned, setModePinned] = useState(false);
  const [complexityPinned, setComplexityPinned] = useState(false);
  const [gatePinned, setGatePinned] = useState(false);
  // Last call sent: only the most recent may write, so a slow answer never overwrites a fresher one.
  const classifySeq = useRef(0);

  const allPinned = nothingLeftToPropose(
    { target: modePinned, complexity: complexityPinned, gate: gatePinned },
    mode.startsWith("tpl:"),
  );

  useEffect(() => {
    // `classifySeq` moves on EVERY change: an answer still in flight for a stale state is dropped on
    // arrival. No synchronous setState here (react/set-state-in-effect), everything happens after
    // the debounce; a stale proposal is never shown anyway, the line hides when the title is empty.
    const id = ++classifySeq.current;
    if (allPinned || demo || !project || !text.trim()) return;
    // Pins go with the request: the classifier proposes the remaining fields AROUND the operator's
    // choices, never instead (the server reapplies them over its answer, a pin cannot be overwritten).
    const forced = {
      ...(modePinned && mode.startsWith("tpl:") ? { templateId: mode.slice(4) } : {}),
      ...(modePinned && !mode.startsWith("tpl:") && mode ? { agentId: mode } : {}),
      ...(complexityPinned ? { complexity } : {}),
      ...(gatePinned ? { gate } : {}),
    };
    const timer = setTimeout(() => {
      if (classifySeq.current !== id) return;
      setClassifying(true);
      tasksApi
        .classifyTask({
          projectId: project.id,
          name: text.trim(),
          ...(detail.trim() ? { description: detail.trim() } : {}),
          ...(Object.keys(forced).length ? { forced } : {}),
        })
        .then((r) => {
          if (classifySeq.current === id) {
            setValue(r);
            setClassifying(false);
          }
        })
        // A classify outage is NOT a composer error: the defaults apply.
        .catch(() => {
          if (classifySeq.current === id) {
            setValue(null);
            setClassifying(false);
          }
        });
    }, CLASSIFY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    text,
    detail,
    project,
    demo,
    allPinned,
    modePinned,
    complexityPinned,
    gatePinned,
    mode,
    complexity,
    gate,
  ]);

  // EFFECTIVE values, field by field: the operator's pin, else the proposal, else the defaults. Never
  // a silent mix: the proposal line SHOWS these values, with each one's provenance.
  const effectiveMode = effectiveModeOf({ value, mode, pinned: modePinned, agents, templates });

  return {
    mode,
    effectiveMode,
    isTemplate: effectiveMode.startsWith("tpl:"),
    gate: gatePinned ? gate : value?.kind === "agent" ? value.gate : gate,
    complexity: complexityPinned
      ? complexity
      : value?.kind === "agent"
        ? value.complexity
        : complexity,
    value,
    pending: classifying,
    pinned: { target: modePinned, complexity: complexityPinned, gate: gatePinned },
    // Touching a setting pins THAT field (and only it). The classifier immediately proposes the
    // remaining fields around the pin; see the effect above, whose deps carry the pins AND values.
    setMode: (v: string) => {
      setModePinned(true);
      setModeState(v);
    },
    setGate: (v: boolean) => {
      setGatePinned(true);
      setGateState(v);
    },
    setComplexity: (v: Level) => {
      setComplexityPinned(true);
      setComplexityState(v);
    },
    reset: () => {
      setModeState("");
      setGateState(false);
      setComplexityState("med");
      setModePinned(false);
      setComplexityPinned(false);
      setGatePinned(false);
      setValue(null);
    },
    resetForProject: () => {
      setModeState("");
      setValue(null);
      setModePinned(false);
      setComplexityPinned(false);
      setGatePinned(false);
    },
  };
}
