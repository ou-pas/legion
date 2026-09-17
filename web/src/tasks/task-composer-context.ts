// The task composer's CONTRACT: what the provider injects and each piece reads. Split from
// `TaskComposer.tsx` on 06/09 so the context is a LEAF: the pieces (`task-composer-parts.tsx`) and
// the provider both read it, and a context left in the assembling module made the import cycle
// `no-circular` refuses.
import { createContext, use } from "react";
import { type tasksApi } from "../api/tasks.js";
import { type PickedAttachment } from "./attachments.js";

export type Level = "low" | "med" | "high";
export type Classify = Awaited<ReturnType<typeof tasksApi.classifyTask>>;

export interface ComposerValue {
  state: {
    text: string;
    mode: string;
    gate: boolean;
    complexity: Level;
    priority: Level;
    /** v53: READ-ONLY task, repositories cloned read-only, nothing pushed, no PR. Manual setting
     *  only; the classifier does not propose it, "deliver nothing" is an operator intention, not
     *  something to guess from a title. */
    readOnly: boolean;
    effectiveMode: string;
    isTemplate: boolean;
    /** The BRIEF. It becomes `task.description`, the instruction the agent receives
     *  (`server/src/sessions/runner/brief.ts`, `buildTaskBrief`). Without it a session only knows
     *  its one-line title, which was the gap: no UI surface wrote it. */
    detail: string;
    detailOpen: boolean;
    /** Ties the button to the area it expands (`aria-controls` / `aria-expanded`). */
    detailId: string;
    /** Collapsed settings (bar): the selectors prefilled by the proposal. */
    settingsOpen: boolean;
    settingsId: string;
    /** Files attached to the brief, IN MEMORY while the task does not exist: there is no run folder
     *  to store them in yet. They upload right after creation and BEFORE the run (see
     *  `useTaskSubmit`): a session starting without them would get a brief announcing absent files. */
    attachments: PickedAttachment[];
    /** The last LOCAL refusal (too large, empty), spelled out. */
    attachmentRefusal: string | null;
    attachmentsBusy: boolean;
  };
  proposal: {
    /** Last classify answer, null while nothing is proposed. */
    value: Classify | null;
    /** Round trip in progress (debounce included). */
    pending: boolean;
    /** Pins PER FIELD (operator feedback, 23/08): a touched field is a CONSTRAINT given to the
     *  classifier, which keeps proposing the OTHERS around it and never overwrites the pin. All
     *  pinned: no call at all. */
    pinned: { target: boolean; complexity: boolean; gate: boolean };
  };
  actions: {
    setText: (v: string) => void;
    setMode: (v: string) => void;
    setGate: (v: boolean) => void;
    setReadOnly: (v: boolean) => void;
    setComplexity: (v: Level) => void;
    setPriority: (v: Level) => void;
    setDetail: (v: string) => void;
    toggleDetail: () => void;
    toggleSettings: () => void;
    addAttachments: (files: File[]) => void;
    removeAttachment: (name: string) => void;
    /** Create AND run. */
    launch: () => void;
    /** Create WITHOUT running: the task lands in "Later". */
    defer: () => void;
    /** DISCUSS FIRST (discussion mode, D2): instead of running the work, create an INTERVIEW task
     *  given to the interviewer, which tests the brief round by round. */
    discuss: () => void;
  };
  meta: {
    agents: { id: string; name: string }[];
    templates: { id: string; name: string; steps: unknown[] }[];
    pending: boolean;
    canLaunch: boolean;
    /** An interview needs neither agent nor chain, it has its own. A title and a project suffice. */
    canDiscuss: boolean;
    discussing: boolean;
    // Project: fixed by the URL (scoped) or picked (global surfaces: dashboard, ⌘K).
    project: { id: string; name: string } | null;
    projects: { id: string; name: string }[];
    scoped: boolean;
    setPicked: (id: string) => void;
    demo: boolean; // demo project: nothing runs
  };
}

export const ComposerCtx = createContext<ComposerValue | null>(null);

export function useComposer(): ComposerValue {
  const v = use(ComposerCtx);
  if (!v) throw new Error("<TaskComposer.*> must be inside <TaskComposer.Provider>");
  return v;
}
