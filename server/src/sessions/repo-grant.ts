// A repository grant set by an inbox answer (09/09): the leaf both `inbox.ts` and
// `request-repo.ts` read, so neither has to import the other.
//
// `request-repo.ts` creates the question (it needs `createInboxMessage`, hence `inbox.ts`);
// `answerInbox` applies the answer (it needs to write the agent record). Putting the write in
// `request-repo.ts` closed an inbox ↔ sessions cycle at file level; here it only depends on the
// database.
//
// What granting means: the name enters `agents.repo_names`, the list `grantedReposOf`
// (runner/spec.ts) rereads at EVERY launch and resume. The grant therefore holds for all the
// agent's future tasks, not only the one that asked, and the question tells the human (`impact`).
// The same gesture as ticking the box on the agent's record.
import { agentRow, reposOfProject, writeAgentRepoNames } from "./repo-grant-store.js";

/** Identifiers, not labels: `answerInbox` reads `selectedChoiceId`, never the button text. */
export const GRANT_CHOICE = { grant: "grant", refuse: "refuse" } as const;

/** `undefined` when absent: a name outside the project grants nothing. */
export function repoOfProject(projectId: string, name: string) {
  return reposOfProject(projectId).find((r) => r.name === name);
}

/** Idempotent: a repository already there is not doubled, and a question replayed after a failed
 *  resume cannot leave the list in a strange state. */
export function grantRepoToAgent(
  agentId: string,
  repoName: string,
): { ok: true } | { ok: false; error: string } {
  const agent = agentRow(agentId);
  if (!agent) return { ok: false, error: "agent not found" };
  if (!repoOfProject(agent.projectId, repoName))
    return { ok: false, error: `repo “${repoName}” unknown in the agent's project` };
  const current = JSON.parse(agent.repoNames) as string[];
  if (!current.includes(repoName)) writeAgentRepoNames(agentId, [...current, repoName]);
  return { ok: true };
}

/** What the agent reads on resume. The decision first, then what it changes for IT: where the
 *  repository is if granted, what to do if not. `humanText` is the operator's free text when they
 *  typed instead of clicking: a reasoned refusal beats a curt one. */
export function grantAnswerText(
  repoName: string,
  granted: boolean,
  humanText: string | null,
): string {
  if (granted)
    return (
      `Repo “${repoName}” GRANTED. It is cloned into repos/${repoName} of your workspace, on the ` +
      `task branch: work in it and commit as in the other granted repos.`
    );
  return (
    `Repo “${repoName}” REFUSED by the operator${humanText ? `: ${humanText}` : ""}. ` +
    `Do without it, or stop and explain it in your report. Do not clone it yourself.`
  );
}
