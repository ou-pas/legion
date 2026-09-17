// Renaming a project, and deciding whether its identifier follows.
//
// The name is display. The slug is not: derived from the name at creation, it has since been a path,
// `data/fs/<slug>` holding all the project's artifacts. Renaming without moving the folder would
// silently orphan the whole history.
//
// Rule decided with the operator on 27/08: the name always changes, the identifier follows when it
// can, which is more often than one might think:
//
//   · if the operator chose an output folder (`fsRoot`), the slug names no path (`projectRoot()`
//     returns `fsRoot`), so it can always follow;
//   · if the project never had a session and its folder is empty, there is nothing to move: a
//     freshly created or imported project, exactly when one notices a bad name.
//
// Moving the folder is not done: a half-failed `mv` leaves part of the history unreachable, and a
// filesystem has no transactions. The identifier stays, and the UI says so.
//
// This module is pure: the disk and database facts (is the folder empty, did a session run) are
// passed in.

/** The slug a name produces. Same formula as at creation (`POST /api/projects`); a divergent copy
 *  would make a renamed project's identifier differ from one created under the same name. */
export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `null` means the name is acceptable; otherwise the sentence to show. */
export function validateProjectName(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "a project needs a name.";
  if (v.length > 80) return "name too long (80 characters maximum).";
  // A name producing no slug cannot be created, so a rename must not set it either, or the project
  // could not be exported.
  if (!slugOf(v)) return "this name has no letter and no digit: it cannot become an identifier.";
  return null;
}

export interface SlugMoveInput {
  /** The project's current slug. */
  current: string;
  /** The one the new name would produce. */
  wanted: string;
  /** Does another project already carry `wanted`? */
  taken: boolean;
  /** The Legion project itself. `seed/self.ts` finds it by slug: changing it would create a second
   *  Legion project at the next boot, and nobody would understand why. */
  isSelf: boolean;
  /** The operator chose an output folder: the slug then names no path. */
  fsRootExplicit: boolean;
  /** A session already ran in this project. */
  hasSessions: boolean;
  /** The `data/fs/<slug>` folder contains something. */
  fsHasContent: boolean;
}

export type SlugMove = { move: true } | { move: false; reason: string };

export function slugMove(input: SlugMoveInput): SlugMove {
  if (input.wanted === input.current) return { move: true }; // nothing to move, nothing to refuse

  // Refusal order is the point: the message must name the real blocker. A Legion project with a full
  // folder and a taken slug must hear "this is the Legion project", not "the slug is taken", or
  // someone frees the slug for nothing.
  if (input.isSelf)
    return {
      move: false,
      reason: `“${input.current}” is the identifier Legion recognises itself by at boot: it does not change.`,
    };
  if (input.taken)
    return {
      move: false,
      reason: `the identifier “${input.wanted}” is already taken by another project.`,
    };
  if (input.fsRootExplicit) return { move: true };
  if (input.hasSessions)
    return {
      move: false,
      reason: `this project already has sessions: “${input.current}” is the folder of their artifacts, and it stays.`,
    };
  if (input.fsHasContent)
    return {
      move: false,
      reason: `the folder “${input.current}” is not empty: it carries files, and it stays.`,
    };
  return { move: true };
}
