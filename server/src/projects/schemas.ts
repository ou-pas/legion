// What a client may send to the `projects` context (06/09, audit wave 2).
//
// Same move as `sessions/internal-schemas.ts`, on the other boundary. Routes used to read bodies with
// `c.req.json<{…}>()`, which declares a shape without checking it: `hue: "3"` reached the compiler as
// a number, and invented keys went through silently.
//
// `strictObject` everywhere: an unknown key is refused by name. Silently dropping it would close the
// hole, but the caller would believe its request was heard as sent, and the fault would show on the
// next reload, far from where it was made.
//
// Schemas describe shape and stop there. Hue step, model routing, chain bindings, skill names, forge
// hosts need a scale, the database or the environment, and live in the services called afterwards,
// whose messages name the fault better than a type can.
import { z } from "zod";
import { FORGE_KINDS } from "../integrations/forge.js";
import { REPO_ACCESSES } from "../shared/enums.js";

/** POST /api/projects: only the name is required; the rest is set or fixed later. */
export const projectCreateBody = z.strictObject({
  name: z.string(),
  fsRoot: z.string().optional(),
  repoUrl: z.string().optional(),
  defaultModel: z.string().optional(),
  gitAuthorName: z.string().optional(),
  gitAuthorEmail: z.string().optional(),
});
export type ProjectCreateInput = z.infer<typeof projectCreateBody>;

/** PATCH /api/projects/:id: every field optional.
 *
 *  `hue` is the only one both `nullable` and `optional`, and that is the point: `null` removes the
 *  choice and returns to derivation, a missing key touches nothing. Neighbouring text fields do not
 *  need it: an empty string already means "restore the default".
 *
 *  `modelRouting` and `chainBindings` stay `unknown`: their `validate*Input` already say which level,
 *  role or cap is at fault. */
export const projectPatchBody = z.strictObject({
  name: z.string().optional(),
  context: z.string().optional(),
  /** 13/09: the output folder, previously set only at creation. Empty string returns to the managed
   *  folder derived from the identifier. */
  fsRoot: z.string().optional(),
  hue: z.number().nullable().optional(),
  gitAuthorName: z.string().optional(),
  gitAuthorEmail: z.string().optional(),
  sessionImage: z.string().optional(),
  sessionDockerfile: z.string().optional(),
  sshKeyPath: z.string().optional(),
  defaultModel: z.string().optional(),
  defaultSkillNames: z.array(z.string()).optional(),
  modelRouting: z.unknown().optional(),
  chainBindings: z.unknown().optional(),
});
export type ProjectPatchInput = z.infer<typeof projectPatchBody>;

/** POST /api/projects/:id/agents: shape only. Defaults (folder, repository access, inbox) and the
 *  taken-name refusal belong to `chains/catalog.ts`, which applies them to library agents too.
 *
 *  The `repoAccess` message is written here rather than left to zod: listing the valid values says
 *  what to fix, "expected one of …" says something is broken. */
export const agentCreateBody = z.strictObject({
  name: z.string(),
  rolePrompt: z.string(),
  title: z.string().optional(),
  model: z.string().nullable().optional(),
  repoAccess: z
    .enum(REPO_ACCESSES, { error: `invalid repoAccess: ${REPO_ACCESSES.join(", ")}` })
    .optional(),
  inboxAccess: z.boolean().optional(),
  skillNames: z.array(z.string()).optional(),
});

/** POST /api/repos: the forge is declared when the host does not give it. Validated against
 *  `FORGE_KINDS` here: a provided but invalid `forge` (empty string included) must say "invalid",
 *  not "unknown for this host", since the client did send a field. */
export const repoCreateBody = z.strictObject({
  projectId: z.string(),
  name: z.string(),
  url: z.string(),
  forge: z
    .enum(FORGE_KINDS, {
      error: (issue) => `invalid forge: “${String(issue.input)}” (${FORGE_KINDS.join(" or ")})`,
    })
    .optional(),
});
export type RepoCreateInput = z.infer<typeof repoCreateBody>;

/** PATCH /api/repos/:id: `testCommand: null` clears the command, a missing key leaves it.
 *
 *  `name` and `url` since 13/09: a repository that moves (renamed on the forge, or replaced) had no
 *  way to say so except remove and reconnect, which erases every citing agent's grants (`deleteRepo`
 *  cleans them, nothing restores them). */
export const repoPatchBody = z.strictObject({
  name: z.string().optional(),
  url: z.string().optional(),
  testCommand: z.string().nullable().optional(),
  forge: z
    .enum(FORGE_KINDS, {
      error: (issue) => `invalid forge: “${String(issue.input)}” (${FORGE_KINDS.join(" or ")})`,
    })
    .optional(),
});
export type RepoPatchInput = z.infer<typeof repoPatchBody>;

/** POST /api/secrets: `value` is never returned, logged or read back. */
export const secretCreateBody = z.strictObject({
  projectId: z.string(),
  name: z.string(),
  value: z.string(),
  label: z.string().optional(),
});
export type SecretCreateInput = z.infer<typeof secretCreateBody>;

/** PATCH /api/secrets/:id: the label only. `null`, like an empty string, clears it: "never named"
 *  and "named then cleared" must be the same state. */
export const secretPatchBody = z.strictObject({
  label: z.string().nullable().optional(),
});

/** POST /api/projects/:id/credentials: add a Claude credential to the ordered list.
 *
 *  No `rank`: a credential always arrives last and is moved afterwards, so adding a backup does not
 *  move current spending unasked.
 *
 *  `name` stays accepted so the fault is stated rather than guessed: `addCredential` refuses anything
 *  but a subscription token, saying where an API key goes. */
export const credentialCreateBody = z.strictObject({
  value: z.string(),
  name: z.string().optional(),
  label: z.string().optional(),
});

/** PATCH /api/credentials/:id: label, rank, or both. Never the value: renewing a token means adding
 *  another and removing the old one. */
export const credentialPatchBody = z.strictObject({
  label: z.string().nullable().optional(),
  rank: z.number().int().positive().optional(),
});
