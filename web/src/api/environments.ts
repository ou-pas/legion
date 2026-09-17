// Network allowlist applied to a session's egress proxy. `networking` has two values in the
// database ("open" | "limited") but this screen only drives one: it creates and edits an allowlist,
// never open access (least privilege, see capabilities/text/environments.ts). An existing "open"
// environment (seeded before the screen) stays readable, its hosts read-only.
import { json, patch, post } from "./client.js";

/** An environment's egress, mirror of `NETWORKING` (server/src/shared/enums.ts). `limited`
 *  restricts sessions to a host list; without it they go out freely. */
export const NETWORKING = { open: "open", limited: "limited" } as const;
export const NETWORKINGS = [NETWORKING.open, NETWORKING.limited] as const;
export type Networking = (typeof NETWORKINGS)[number];

export type Environment = {
  id: string;
  projectId: string;
  name: string;
  networking: "open" | "limited";
  allowedHosts: string[];
};

export const environmentsApi = {
  environments: (projectId: string): Promise<Environment[]> =>
    fetch(`/api/environments?projectId=${projectId}`).then(json),
  /** Always created limited, never "open" by default: see the DO NOT of task 08. */
  createEnvironment: (body: {
    projectId: string;
    name: string;
    allowedHosts: string[];
  }): Promise<Environment> => post("/api/environments", body),
  /** Refused (409, body { error, agentNames }) while an agent still references the environment;
   *  EnvironmentRow shows the error, which names the agents, verbatim. */
  patchEnvironment: (
    id: string,
    body: { name?: string; allowedHosts?: string[] },
  ): Promise<Environment> => patch(`/api/environments/${id}`, body),
  deleteEnvironment: (id: string) =>
    fetch(`/api/environments/${id}`, { method: "DELETE" }).then(json),
};
