/** The slug the Legion project recognises itself by. Renaming must refuse it: changing it would
 *  create a second Legion project at the next `pnpm seed:self` (`rename.ts`, `isSelf`).
 *
 *  Its own module because `seed/self.ts` is a script: importing it runs the seed. It used to be the
 *  home of this constant, so the server seeded the author's project on every boot. */
export const SELF_SLUG = "legion";
