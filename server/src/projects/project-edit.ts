// Editing a project: many fields, one write (06/09). Extracted from `PATCH /api/projects/:id` so the
// field judgements can be tested without mounting an app.
//
// One UPDATE once everything is validated (05/09). It used to be one `db.update` per field, each
// atomic but not together, so block order decided what stayed written when one refused. Same shape
// as `PATCH /api/agents/:id`.
import fs from "node:fs";
import { validateChainBindingsInput } from "../chains/templates.js";
import { validateModelRoutingInput } from "../models/model.js";
import { listSkills } from "../capabilities/capabilities.js";
import { validateGitAuthorEmail, validateGitAuthorName } from "./git-identity.js";
import { validateHueInput } from "./hue.js";
import { projectRoot } from "./fs-acl.js";
import { projectFootprint } from "./purge.js";
import { logControlEvent } from "../events/control-log-store.js";
import {
  agentRowsOfProject,
  projectRowById,
  slugTaken,
  updateProjectRow,
  type ProjectPatch,
  type ProjectRow,
} from "./project-edit-store.js";
import { slugMove, slugOf, validateProjectName } from "./rename.js";
import { SELF_SLUG } from "./self-slug.js";
import {
  validateSessionDockerfile,
  validateSessionImage,
  validateSshKeyPath,
} from "./session-runtime.js";
import type { ProjectPatchInput } from "./schemas.js";

export type ProjectRenamed = {
  name: string;
  slug: string;
  slugMoved: boolean;
  slugReason: string | null;
};

export type ProjectEdited =
  | { ok: true; renamed: ProjectRenamed | null }
  | { ok: false; status: 400 | 404; error: string };

type Refusal = { error: string };
const refused = (value: unknown): value is Refusal =>
  typeof value === "object" && value !== null && "error" in value;

/** v42, renaming. The name always changes; the identifier follows when it can. The rule lives in the
 *  pure `rename.ts`; this only feeds it the two facts it cannot know, disk and history.
 *
 *  `fsRoot` is an argument rather than read from the row (13/09): one PATCH can set it and rename,
 *  and the rule must see the root this call asks for. */
function renamePlan(
  project: ProjectRow,
  rawName: string,
  fsRoot: string | null,
): ProjectRenamed | Refusal {
  const error = validateProjectName(rawName);
  if (error) return { error };
  const name = rawName.trim();
  const wanted = slugOf(name);
  const root = projectRoot(project.slug, fsRoot);
  const move = slugMove({
    current: project.slug,
    wanted,
    taken: wanted !== project.slug && slugTaken(wanted),
    isSelf: project.slug === SELF_SLUG,
    fsRootExplicit: Boolean(fsRoot?.trim()),
    // The disk, not the database: an agent `fs_write` or a hand-dropped file leaves no row, and is
    // exactly what a rename would orphan.
    hasSessions: projectFootprint(project.id).sessions > 0,
    fsHasContent: (() => {
      try {
        return fs.readdirSync(root).length > 0;
      } catch {
        return false; // missing folder: nothing to move
      }
    })(),
  });
  return {
    name,
    slug: move.move ? wanted : project.slug,
    slugMoved: move.move && wanted !== project.slug,
    slugReason: move.move ? null : move.reason,
  };
}

/** v35: skills active by default on the whole project, validated against skills actually on disk.
 *  A default pointing at a missing folder would be a silent setting, shown in the box and without
 *  effect in the session. The unknown name is named, not silently dropped. */
function skillNamesJson(raw: readonly string[]): string | Refusal {
  const names = [...new Set(raw.map((n) => n.trim()).filter(Boolean))];
  const known = new Set(listSkills().map((sk) => sk.name));
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length)
    return {
      error: `unknown skill(s): ${unknown.join(", ")} — drop it in Capabilities first`,
    };
  return JSON.stringify(names);
}

// v47: the mark's hue. `null` removes the choice and returns to derivation, so a missing key and a
// `null` key mean different things here, unlike the neighbouring text fields where "" means default.
function patchHue(input: ProjectPatchInput): ProjectPatch | Refusal {
  if (input.hue === undefined) return {};
  const hue = validateHueInput(input.hue);
  if (!hue.ok) return { error: hue.error };
  return { hue: hue.value };
}

// v40: project runtime. The values become `docker run` arguments, which is why they are validated
// rather than just stored. An empty string restores the default for each. The key file itself is
// not checked here: it may be dropped later, and refusing a path whose file does not exist yet would
// forbid configuring before installing; preflight says so at launch. The pasted Dockerfile (v67) is
// judged on size only; the trust rule on its content applies at build time.
function patchSessionRuntime(input: ProjectPatchInput): ProjectPatch | Refusal {
  const patch: ProjectPatch = {};
  if (input.sessionImage !== undefined) {
    const error = validateSessionImage(input.sessionImage);
    if (error) return { error };
    patch.sessionImage = input.sessionImage.trim() || null;
  }
  if (input.sessionDockerfile !== undefined) {
    const error = validateSessionDockerfile(input.sessionDockerfile);
    if (error) return { error };
    patch.sessionDockerfile = input.sessionDockerfile.trim() || null;
  }
  if (input.sshKeyPath !== undefined) {
    const error = validateSshKeyPath(input.sshKeyPath);
    if (error) return { error };
    patch.sshKeyPath = input.sshKeyPath.trim() || null;
  }
  return patch;
}

// Git identity: an empty string restores the default; any other text goes through git-identity.ts.
function patchGitIdentity(input: ProjectPatchInput): ProjectPatch | Refusal {
  const patch: ProjectPatch = {};
  if (input.gitAuthorName !== undefined) {
    const author = input.gitAuthorName.trim();
    const error = author ? validateGitAuthorName(author) : null;
    if (error) return { error };
    patch.gitAuthorName = author || null;
  }
  if (input.gitAuthorEmail !== undefined) {
    const email = input.gitAuthorEmail.trim();
    const error = email ? validateGitAuthorEmail(email) : null;
    if (error) return { error };
    patch.gitAuthorEmail = email || null;
  }
  return patch;
}

// v24: complexity → model routing per project. An id unknown to /api/models (pinned by hand) is
// accepted, same rule as an agent's model. v29: chain role → agent mapping, replaced whole, values
// limited to the project's agents.
function patchRoutingAndBindings(
  input: ProjectPatchInput,
  projectId: string,
): ProjectPatch | Refusal {
  const patch: ProjectPatch = {};
  if (input.modelRouting !== undefined) {
    const routing = validateModelRoutingInput(input.modelRouting);
    if (!routing.ok) return { error: routing.error };
    patch.modelRouting = JSON.stringify(routing.value);
  }
  if (input.chainBindings !== undefined) {
    const agents = agentRowsOfProject(projectId);
    const bindings = validateChainBindingsInput(input.chainBindings, agents);
    if (!bindings.ok) return { error: bindings.error };
    patch.chainBindings = JSON.stringify(bindings.value);
  }
  if (input.defaultSkillNames !== undefined) {
    const names = skillNamesJson(input.defaultSkillNames);
    if (refused(names)) return names;
    patch.defaultSkillNames = names;
  }
  return patch;
}

function patchContext(input: ProjectPatchInput): ProjectPatch {
  return input.context === undefined ? {} : { context: input.context.slice(0, 8000) };
}

// Batch nav/2a: the default model was named as a fallback in the three routing selectors
// (`ModelRoutingCard`, `T.fallback(project.defaultModel)`) with no field to set it. No `null`: it is
// `resolveModel`'s last fallback, and an empty string would leave no model at all.
function patchDefaultModel(input: ProjectPatchInput): ProjectPatch | Refusal {
  if (input.defaultModel === undefined) return {};
  const model = input.defaultModel.trim();
  if (!model)
    return { error: "defaultModel cannot be empty — it is the last fallback of the routing" };
  return { defaultModel: model };
}

/** Merges a patch fragment, or returns the refusal that stops the whole edit: one faulty field
 *  cancels all of them. */
function mergeField(patch: ProjectPatch, fragment: ProjectPatch | Refusal): Refusal | null {
  if (refused(fragment)) return fragment;
  Object.assign(patch, fragment);
  return null;
}

/** The output folder, after creation (13/09). It used to be set at creation only, yet it is the
 *  setting one wants to fix on a project that has lived, and it does two things: it says where
 *  artifacts go, and it detaches that folder from the identifier. The second matters here: a project
 *  with sessions refuses to move its identifier because the folder derives from it (`rename.ts`);
 *  set explicitly, the folder no longer moves and renaming is complete again.
 *
 *  Absolute path, as at creation: a relative one would resolve against the server's working
 *  directory. Empty string returns to the managed folder. */
function patchFsRoot(input: ProjectPatchInput): ProjectPatch | Refusal {
  if (input.fsRoot === undefined) return {};
  const fsRoot = input.fsRoot.trim() || null;
  if (fsRoot && !fsRoot.startsWith("/"))
    return { error: "the output folder must be an absolute path" };
  return { fsRoot };
}

/** Fields depending only on themselves, each with the validator that names its fault. */
function scalarPatch(input: ProjectPatchInput, projectId: string): ProjectPatch | Refusal {
  const patch: ProjectPatch = {};
  const fragments = [
    patchHue(input),
    patchSessionRuntime(input),
    patchGitIdentity(input),
    patchRoutingAndBindings(input, projectId),
    patchContext(input),
    patchDefaultModel(input),
    patchFsRoot(input),
  ];
  for (const fragment of fragments) {
    const refusal = mergeField(patch, fragment);
    if (refusal) return refusal;
  }
  return patch;
}

export function editProject(projectId: string, input: ProjectPatchInput): ProjectEdited {
  const project = projectRowById(projectId);
  if (!project) return { ok: false, status: 404, error: "project not found" };

  const patch = scalarPatch(input, project.id);
  if (refused(patch)) return { ok: false, status: 400, error: patch.error };

  let renamed: ProjectRenamed | null = null;
  if (input.name !== undefined) {
    // The root this call leaves, not the previous one: setting the folder and renaming in one PATCH
    // must unlock the identifier at once, or call order would become an unwritten rule.
    const plan = renamePlan(project, input.name, patch.fsRoot ?? project.fsRoot);
    if (refused(plan)) return { ok: false, status: 400, error: plan.error };
    renamed = plan;
    // Renaming has no effect on disk (`rename.ts`: the identifier only follows when there is nothing
    // to move), so it joins the same update.
    patch.name = plan.name;
    patch.slug = plan.slug;
  }

  // A body with no known field is not a refusal (an unchanged form saves), but Drizzle refuses
  // `set({})`, so the database is skipped.
  if (Object.keys(patch).length > 0) updateProjectRow(project.id, patch);
  if (!renamed) return { ok: true, renamed: null };
  // Refusing to move the identifier is not an error: the name did change. The reason goes up so the
  // UI says it rather than implying a complete rename.
  logControlEvent(
    "info",
    "projects",
    `project renamed to “${renamed.name}” (identifier: ${renamed.slug}${renamed.slugMoved ? ", followed" : ", frozen"})`,
    { projectId: project.id, slug: renamed.slug, slugReason: renamed.slugReason },
  );
  return { ok: true, renamed };
}
