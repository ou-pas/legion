// Store for a project's session image, shared by `project.ts` and `project-rebuild.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

export function projectById(projectId: string): typeof schema.projects.$inferSelect | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
}

/** Every project, unfiltered: `projectImageTargets` (project.ts) drops those without one. `name`
 *  travels along (11/09) because the Infra card names projects, not ids. */
export function projectImageDeclarations(): {
  id: string;
  name: string;
  sessionImage: string | null;
  sessionDockerfile: string | null;
}[] {
  return db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      sessionImage: schema.projects.sessionImage,
      sessionDockerfile: schema.projects.sessionDockerfile,
    })
    .from(schema.projects)
    .all();
}
