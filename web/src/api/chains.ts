import { json, post } from "./client.js";

/** Chain library (v18), the chain counterpart of `AgentTemplate`: the built-in catalog
 *  (server/src/chains/catalog.ts, id "builtin:") plus chains promoted by the operator. */
export type ChainTemplate = {
  id: string;
  name: string;
  description: string;
  steps: TemplateStep[];
  autoRunNext: boolean;
  /** Built-in entry: lives in server code, not the database; installable, not deletable. */
  builtin: boolean;
  /** null for a built-in entry: it has no creation date in the database. */
  createdAt: string | null;
};
/** `role` (v29): the key of the project's role → agent mapping, `role ?? agentName` (the catalog
 *  name IS the implicit role of existing chains). */
export type TemplateStep = {
  name: string;
  agentName: string;
  role?: string;
  approvalGate: boolean;
  expectedArtifacts: string[];
  prompt: string;
};
export type Template = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  steps: TemplateStep[];
  autoRunNext: boolean;
};

export const chainsApi = {
  runTemplate: (id: string, request: string): Promise<{ runId: string; taskIds: string[] }> =>
    post(`/api/templates/${id}/run`, { request }),
  // Promotion and uninstall act on the INSTALLED copy (`task_templates`, id shared with
  // `Template`), so they go through /api/templates.
  chainTemplates: (): Promise<ChainTemplate[]> => fetch("/api/chain-templates").then(json),
  deleteChainTemplate: (id: string) =>
    fetch(`/api/chain-templates/${id}`, { method: "DELETE" }).then(json),
  installChainTemplate: (
    id: string,
    projectId: string,
  ): Promise<{ id: string; createdAgents: string[] }> =>
    post(`/api/chain-templates/${id}/install`, { projectId }),
  /** Upsert by name in the library: `updated` says whether an existing entry was replaced. */
  promoteChain: (taskTemplateId: string): Promise<{ id: string; updated: boolean }> =>
    post(`/api/templates/${taskTemplateId}/promote`),
  /** Removes the copy installed on the project; the library does not change. */
  uninstallChain: (taskTemplateId: string): Promise<{ ok: true; name: string }> =>
    fetch(`/api/templates/${taskTemplateId}`, { method: "DELETE" }).then(json),
};
