import { json, post } from "./client.js";
import type { EffortLevel } from "./agents.js";

/** A model and what it can do, from `/api/models`, which asks the SDK. Capabilities come with the
 *  list so the screen never offers an effort setting on a model that ignores it. */
export type ModelChoice = {
  id: string;
  resolves: string | null;
  displayName: string;
  description: string;
  supportsEffort: boolean;
  effortLevels: EffortLevel[];
  supportsAdaptiveThinking: boolean;
};

export const modelsApi = {
  /** `source: "fallback"` = the SDK was unreachable and these are fallback aliases. The screen
   *  must say so: a fallback list looks exactly like the real one. */
  models: (): Promise<{ models: ModelChoice[]; source: "sdk" | "fallback"; fetchedAt: number }> =>
    fetch("/api/models").then(json),

  /** Probes a hand-pinned id, one typed because the SDK list does not know it yet. The verdict is
   *  a warning, never a wall: `claude-opus-4-8` was pinned and ran on 23/08 while no
   *  `supportedModels()` listed it. The only refusal that counts is session init's, which names
   *  its error. */
  probe: (id: string, projectId?: string): Promise<ProbeResult> =>
    post("/api/models/probe", projectId ? { id, projectId } : { id }),
};

export type ProbeVerdict = "listed" | "exists" | "unknown" | "unverifiable";

export type ProbeResult = {
  verdict: ProbeVerdict;
  /** The API's message when it gives one, shown verbatim. */
  detail?: string;
};
