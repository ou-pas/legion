// Queries for instance settings: the `settings` key/value table, no project. Re-exported by
// `settings.ts`, which also decides encryption.
import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";

export function getSetting(key: string): string | null {
  return db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null;
}

/** Writes the value whether or not the key exists. No uniqueness constraint is declared in
 *  Drizzle, so existence is read first instead of relying on an upsert. */
export function setSetting(key: string, value: string): void {
  if (db.select().from(schema.settings).where(eq(schema.settings.key, key)).get())
    db.update(schema.settings).set({ value }).where(eq(schema.settings.key, key)).run();
  else db.insert(schema.settings).values({ key, value }).run();
}
