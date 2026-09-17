// A project's encrypted crate. Its content never touches the server's disk: export answers with the
// file TEXT and the browser downloads it; import sends back the text the browser read.
//
// The passphrase travels in a POST body, never a URL, even for the preview that changes nothing: a
// query string ends up in a log.
import { json, post } from "./client.js";

export const CRATE_PARTS = [
  "agents",
  "repos",
  "mcpServers",
  "rules",
  "templates",
  "secrets",
] as const;
export type CratePart = (typeof CRATE_PARTS)[number];
export type CrateInclude = Record<CratePart, boolean>;

/** Secrets unchecked by default: carrying credentials away is a decision. The server applies the
 *  same default; this copy serves the screen and is not authoritative. */
export const DEFAULT_INCLUDE: CrateInclude = {
  agents: true,
  repos: true,
  mcpServers: true,
  rules: true,
  templates: true,
  secrets: false,
};

export interface CrateManifest {
  project: string;
  slug: string;
  counts: Record<CratePart, number>;
}

export interface CrateSummary {
  project: string;
  counts: {
    environments: number;
    agents: number;
    repos: number;
    rules: number;
    mcpServers: number;
    templates: number;
    secrets: number;
  };
  notes: string[];
}

export const portabilityApi = {
  manifest: (projectId: string): Promise<CrateManifest> =>
    fetch(`/api/projects/${projectId}/crate/manifest`).then(json),
  seal: (
    projectId: string,
    body: { passphrase: string; include: CrateInclude },
  ): Promise<{ filename: string; content: string }> =>
    post(`/api/projects/${projectId}/crate`, body),
  preview: (body: { content: string; passphrase: string }): Promise<CrateSummary> =>
    post("/api/crate/preview", body),
  importCrate: (body: {
    content: string;
    passphrase: string;
    name?: string;
  }): Promise<{ projectId: string; slug: string; summary: CrateSummary }> =>
    post("/api/crate/import", body),
};

/** `Blob` + ephemeral link: the content goes through neither a URL (so no log) nor the server's
 *  disk. */
export function downloadCrate(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
