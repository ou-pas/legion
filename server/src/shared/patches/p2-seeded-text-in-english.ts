// P2: the text Legion itself wrote into the database in French, moved to the English the code writes
// since 16/09 (operator's request, 17/09).
//
// Which rows carried it:
//   · the first-boot seed (`projects/seed/index.ts`): agent titles, the compound-engineer chain's
//     description and step names;
//   · built-in agents and chains installed from the catalog (`chains/catalog.ts`): agent titles,
//     chain descriptions and step names, and role prompts and step prompts quoting skill names in
//     « »;
//   · the default agent `project-create.ts` adds to a new project: "Agent par défaut · <name>";
//   · the Legion project (`projects/seed/self.ts`), upserted on EVERY boot of every instance until
//     17/09: its context, its five rules, its three agents.
//
// The one rule: a value is replaced only when it is EXACTLY what the old code wrote. Anything else
// was edited by someone, or never written by Legion, and stays as found. Those still looking French
// are listed in one log line so the operator knows what the patch did not touch.
//
// Left alone on purpose: task names and briefs, inbox messages, notices, session events, control
// events, the demonstration project's showcase rows. Those are history, not configuration.
// Identifiers stay French too (rule names such as `verification-avant-livraison`, slugs, patch ids):
// only content moves.
//
// Values are frozen here, like a migration's SQL: `shared/` is a leaf, and a patch describes the data
// of its time. Long texts whose only change is « » becoming “ ” are matched by sha256 of the old text
// and rebuilt, and the rebuilt text must hash to the English the code writes, or nothing is written.
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { createLogger } from "../log.js";
import type { DataPatch } from "./step.js";

const TITLES = new Map<string, string>([
  ["Agent Legion par défaut", "Default Legion agent"],
  [
    "Rédacteur isolé — réseau limité à l'API Anthropic, écrit dans /agents/writer",
    "Isolated writer — network limited to the Anthropic API, writes in /agents/writer",
  ],
  ["Écrit des specs approuvables", "Writes approvable specs"],
  ["Transforme une spec en plan ordonné", "Turns a spec into an ordered plan"],
  ["Implémente et corrige", "Implements and fixes"],
  [
    "Coordonne les reviews, consolide must-fix/should-fix",
    "Coordinates reviews, consolidates must-fix/should-fix",
  ],
  ["Tient la documentation à jour", "Keeps the documentation up to date"],
  ["Met un brief à l'épreuve avant qu'il parte", "Puts a brief to the test before it goes out"],
  ["Sonde une spec et compte ce qu'elle tait", "Probes a spec and counts what it leaves unsaid"],
  ["Découpe une spec sondée en tranches", "Cuts a probed spec into slices"],
  ["Interface — web/, design system, galerie /ds", "Interface — web/, design system, stories"],
  ["Control plane — server/, runner, schéma", "Control plane — server/, runner, schema"],
  [
    "Spécifie et documente — lecture seule sur le code",
    "Specifies and documents — read-only on the code",
  ],
]);

const SELF_PROMPTS = new Map<string, string>([
  [
    "Tu travailles l'interface d'Legion, dans `web/` uniquement. Tu lis `docs/DESIGN.md` avant d'écrire une ligne : c'est un contrat, pas une description. Tu ne touches ni à `server/`, ni à `runner-payload/`, ni à `session-image/` — si une tâche l'exige, tu poses la question à l'inbox au lieu de déborder. Tu vérifies tes corrections par la mesure (hauteurs, alignements, débordements, contrastes), et tu écris le constat chiffré avant/après. Tu finis par `pnpm lint`, `pnpm --filter @legion/web build` et un passage par `/ds`.",
    "You work on Legion's interface, in `web/` only. You read `docs/DESIGN.md` before writing a line: it is a contract, not a description. You touch neither `server/`, nor `runner-payload/`, nor `session-image/`; if a task requires it, you ask in the inbox instead of spilling over. You check your fixes by measuring (heights, alignments, overflows, contrasts), and you write the before/after figures. You finish with `pnpm lint`, `pnpm --filter @legion/web build` and `pnpm test`, which renders every story.",
  ],
  [
    "Tu travailles le control plane d'Legion : `server/`, `runner-payload/`, `session-image/`. Tu ne touches pas à `web/`. Toute logique pure va dans son propre module AVEC son test (`node:test` + tsx, cf. `server/src/inbox/pending-by-project.test.ts`) : une frontière de sécurité ou une résolution d'identifiant ne se livre pas sans test. Toute migration de schéma passe par un palier `PRAGMA user_version` dans `db.ts`. Tu ne modifies JAMAIS `server/.env`.",
    "You work on Legion's control plane: `server/`, `runner-payload/`, `session-image/`. You do not touch `web/`. Any pure logic goes in its own module WITH its test (`node:test` + tsx, see `server/src/inbox/pending-by-project.test.ts`): a security boundary or an identifier resolution never ships without a test. Every schema change is a `PRAGMA user_version` step in `server/src/shared/migrations/`. You NEVER modify `server/.env`.",
  ],
  [
    "Tu écris des specs approuvables et de la documentation pour Legion. Tu LIS le code, tu ne l'écris pas. Ton livrable est un fichier markdown dans les artifacts : le problème constaté, la décision proposée avec ses alternatives écartées, et comment on vérifiera que c'est fait. Tu cites les fichiers et les lignes que tu as réellement lus. Tu n'inventes aucun comportement : si tu ne peux pas le vérifier dans le code, tu l'écris comme une question, pas comme un fait.",
    "You write approvable specs and documentation for Legion. You READ the code, you do not write it. Your deliverable is a markdown file in the artifacts: the problem observed, the proposed decision with the alternatives set aside, and how we will check it is done. You quote the files and lines you actually read. You invent no behaviour: if you cannot check it in the code, you write it as a question, not as a fact.",
  ],
]);

const RULES = new Map<string, string>([
  [
    "Aucune tâche n'est terminée sans ces 5 commandes vertes, dans cet ordre : `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @legion/web build`. Si l'une échoue, la tâche n'est pas finie : corrige, ou pose une question à l'inbox. Ne jamais annoncer un travail terminé sur la foi d'une lecture du code.",
    "No task is finished until these 5 commands pass, in this order: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @legion/web build`. If one fails, the task is not finished: fix it, or ask a question in the inbox. Never announce work as done on the strength of reading the code.",
  ],
  [
    "Tout travail dans `web/` lit `docs/DESIGN.md` AVANT d'écrire. Aucun `style={{}}` inline. Aucune valeur en dur (couleur, taille, rayon, durée, z-index) : tout vient de `components/ui/tokens.css`, et un token manquant s'ajoute LÀ avec un nom sémantique. Un composant = un module `ui/<nom>.tsx` + son `<nom>.css` co-localisé ; pas de barrel. Tous les hooks avant le premier `return`. Icônes lucide-react uniquement, jamais d'emoji. Tout nouveau composant entre dans la galerie `/ds` avec tous ses états.",
    "Any work in `web/` reads `docs/DESIGN.md` BEFORE writing. No inline `style={{}}`. No hardcoded value (colour, size, radius, duration, z-index): everything comes from `web/src/ui/tokens.css`, and a missing token is added THERE with a semantic name. One component = one module `ui/<name>.tsx` + its co-located `<name>.css`; no barrel. Every hook before the first `return`. lucide-react icons only, never an emoji. Every `.tsx` module has its `<name>.stories.tsx` next to it.",
  ],
  [
    "Une correction d'interface se vérifie par la MESURE, pas à l'œil : hauteurs, alignements, débordements, contrastes, plan des titres. Écris le constat chiffré avant/après dans le rapport de tâche. Un « ça devrait marcher » n'est pas une vérification.",
    "An interface fix is checked by MEASURING, not by eye: heights, alignments, overflows, contrasts, heading outline. Write the before/after figures in the task report. “It should work” is not a check.",
  ],
  [
    "Legion te donne déjà la branche de ta session : pousse dessus, ne la renomme pas. Une branche que tu crées TOI-MÊME suit conventionalbranch.org : `feature/<description>` pour un comportement nouveau, `bugfix/<description>` pour quelque chose de cassé, `chore/<description>` pour tout le reste (doc, refacto, config). La description n'utilise que a-z, 0-9 et le tiret — jamais de majuscule, jamais d'accent, jamais deux tirets de suite, jamais de tiret en début ou en fin.",
    "Legion already gives you your session's branch: push to it, do not rename it. A branch you create YOURSELF follows conventionalbranch.org: `feature/<description>` for new behaviour, `bugfix/<description>` for something broken, `chore/<description>` for everything else (docs, refactoring, config). The description uses only a-z, 0-9 and the hyphen: never a capital, never an accent, never two hyphens in a row, never a hyphen at the start or the end.",
  ],
  [
    "Ne jamais écrire un secret en clair dans le code, un commentaire, un log ou un commit. Ne jamais toucher à `server/.env`. Les secrets se citent par `${SECRET:NOM}` et se déclarent dans la carte « Secrets du projet ».",
    "Never write a secret in plain text in code, a comment, a log or a commit. Never touch `server/.env`. Secrets are referenced as `${SECRET:NAME}` and declared in the project's Secrets card.",
  ],
  [
    "Aucune tâche n'est terminée sans ces quatre commandes vertes, dans cet ordre : `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @legion/web build`. Si l'une échoue, la tâche n'est pas finie : corrige, ou pose une question à l'inbox. Ne jamais annoncer un travail terminé sur la foi d'une lecture du code.",
    "No task is finished until these 5 commands pass, in this order: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @legion/web build`. If one fails, the task is not finished: fix it, or ask a question in the inbox. Never announce work as done on the strength of reading the code.",
  ],
]);

const CONTEXTS = new Map<string, string>([
  [
    "Legion : control plane + UI au-dessus du Claude Agent SDK, opérateur unique (l'opérateur). Monorepo pnpm : `server/` (Hono + Drizzle/SQLite, SSE), `web/` (React 19 + Vite + TanStack), `runner-payload/` (le process qui vit dans le container), `session-image/` (son image Docker). Sources de vérité : docs/plan.md (décisions actées), docs/STATE.md (état courant), docs/DESIGN.md (le contrat de design, monde « Atelier »). Français pour la doc et les commentaires, anglais pour le code et les identifiants.",
    "Legion: control plane + UI on top of the Claude Agent SDK, for a single operator. pnpm monorepo: `server/` (Hono + Drizzle/SQLite, SSE), `web/` (React 19 + Vite + TanStack), `runner-payload/` (the process living in the container), `session-image/` (its Docker image). Sources of truth: docs/wiki/produit/ (what Legion is today; settled decisions in decisions.md), GitHub issues on ou-pas/legion (known defects and open work), docs/DESIGN.md (the design contract, the “Atelier” world). English for code, identifiers, comments and documentation.",
  ],
  [
    "Legion : control plane + UI au-dessus du Claude Agent SDK, opérateur unique (Romuald). Monorepo pnpm : `server/` (Hono + Drizzle/SQLite, SSE), `web/` (React 19 + Vite + TanStack), `runner-payload/` (le process qui vit dans le container), `session-image/` (son image Docker). Sources de vérité : docs/plan.md (décisions actées), docs/STATE.md (état courant), docs/DESIGN.md (le contrat de design, monde « Atelier »). Français pour la doc et les commentaires, anglais pour le code et les identifiants.",
    "Legion: control plane + UI on top of the Claude Agent SDK, for a single operator. pnpm monorepo: `server/` (Hono + Drizzle/SQLite, SSE), `web/` (React 19 + Vite + TanStack), `runner-payload/` (the process living in the container), `session-image/` (its Docker image). Sources of truth: docs/wiki/produit/ (what Legion is today; settled decisions in decisions.md), GitHub issues on ou-pas/legion (known defects and open work), docs/DESIGN.md (the design contract, the “Atelier” world). English for code, identifiers, comments and documentation.",
  ],
]);

const CHAIN_DESCRIPTIONS = new Map<string, string>([
  [
    "Spec (gate) → Plan → Revue (3 angles) → Révision → Implémentation → Code review → Corrections → Wiki → Revue humaine (gate)",
    "Spec (gate) → Plan → Review (3 angles) → Revision → Implementation → Code review → Fixes → Wiki → Human review (gate)",
  ],
  [
    "Entretien (gate) → Sonde (gate) → Découpe (gate, approuve le lot) → [tranches] → Wiki → Revue humaine (gate)",
    "Interview (gate) → Probe (gate) → Breakdown (gate, approves the batch) → [slices] → Wiki → Human review (gate)",
  ],
  [
    "Reproduction → Cause racine → Test qui échoue (écrit AVANT le correctif) → Correctif minimal → Revue (gate)",
    "Reproduction → Root cause → Failing test (written BEFORE the fix) → Minimal fix → Review (gate)",
  ],
]);

const STEP_NAMES = new Map<string, string>([
  ["Revue du plan", "Plan review"],
  ["Révision du plan", "Plan revision"],
  ["Implémentation", "Implementation"],
  ["Corrections", "Fixes"],
  ["Revue humaine", "Human review"],
  ["Entretien", "Interview"],
  ["Sonde", "Probe"],
  ["Découpe", "Breakdown"],
  ["Diagnostic de cause racine", "Root cause diagnosis"],
  ["Test qui échoue", "Failing test"],
  ["Correctif minimal", "Minimal fix"],
  ["Revue", "Review"],
]);

/** sha256 of a built-in role prompt as installed before 16/09 → sha256 of the English one
 *  (spec, interviewer, prober, slicer). */
const QUOTED_PROMPTS = new Map<string, string>([
  [
    "fbcf1a590d39d668b6b9da1f66a48d645b3c5624fd8c7c56ff5bcf66cad652c8",
    "bf8b91513c6f02336ece0ca8b0ab6758e994322ccc19aa452b12824fc50aa94e",
  ],
  [
    "7e247392402ef42064fe26c711d6e64b9af9e27d4ae40a4b350c4260edc08aa2",
    "478e81d7fb71bbebd5902b2a2bd7a9c9ba4c794eff9d04c1d9b9c81da4cc8a5c",
  ],
  [
    "1aaea277ff75b98bc14b30c15b1539401412cfa160594fcfb857430e72789285",
    "ee9b2df3988af36870e7a9dddc46ea853620777f591ae0edb80e0ac4f54f2817",
  ],
  [
    "4f095ab3fe8f1aa9e24a1012f6ddff5ac512cfb5dc080e070ea2183b1f05abc5",
    "00129a5c4cbc5b1c90389037e604871f989b374a293d99c4b223328387fe4d65",
  ],
]);

/** sha256 of a chain's `steps` JSON as seeded or installed before 16/09 → sha256 of the English one
 *  (compound-engineer, feature, bugfix). */
const RENAMED_STEPS = new Map<string, string>([
  [
    "537fa57adf42d8cac9fd744af131861a7d351416052e7390265b137b751d8735",
    "8ec2cd5e7360a22bb1057be217206a6917c530c2688f3af13af15097ed56fc5c",
  ],
  [
    "8b0752aa058b847d5896c273e93eec93f81b2282bef291f78c31d353b05b53ef",
    "39bd2c8ba238acc1ed8f9a52ee3fac453d7b9386e59803cb0b0f97c70fbf08a2",
  ],
  [
    "478ec9ca5f0cb05ab07314c39a627f94974d0ea625b5a16c988f09908831a4ef",
    "7fa471bd211de4eb615b295b3fd1634a5f1903c4390cfbeca02a40276da36905",
  ],
]);

const DEFAULT_AGENT_TITLE_FR = "Agent par défaut · ";
const DEFAULT_AGENT_TITLE_EN = "Default agent · ";

/** What a value left untouched must look like to be reported: an accent or a French quote. Not a
 *  language detector, a pointer for the operator. */
const LOOKS_FRENCH = /[àâçéèêëîïôûùœ«»]/i;

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const requote = (text: string): string => text.replace(/« ([^»]*?) »/g, "“$1”");

/** The rebuilt text is kept only if it hashes to the English the code writes. */
function rebuilt(hashes: Map<string, string>, value: string, rebuild: (v: string) => string) {
  const expected = hashes.get(sha256(value));
  if (!expected) return null;
  const next = rebuild(value);
  return sha256(next) === expected ? next : null;
}

function title(value: string): string | null {
  const known = TITLES.get(value);
  if (known) return known;
  return value.startsWith(DEFAULT_AGENT_TITLE_FR)
    ? DEFAULT_AGENT_TITLE_EN + value.slice(DEFAULT_AGENT_TITLE_FR.length)
    : null;
}

const rolePrompt = (value: string): string | null =>
  SELF_PROMPTS.get(value) ?? rebuilt(QUOTED_PROMPTS, value, requote);

type Step = { name: string; prompt: string };

const steps = (value: string): string | null =>
  rebuilt(RENAMED_STEPS, value, (json) =>
    JSON.stringify(
      (JSON.parse(json) as Step[]).map((step) => ({
        ...step,
        name: STEP_NAMES.get(step.name) ?? step.name,
        prompt: requote(step.prompt),
      })),
    ),
  );

const exact =
  (pairs: Map<string, string>) =>
  (value: string): string | null =>
    pairs.get(value) ?? null;

type Column = { table: string; column: string; rewrite: (value: string) => string | null };

const COLUMNS: readonly Column[] = [
  { table: "agents", column: "title", rewrite: title },
  { table: "agents", column: "role_prompt", rewrite: rolePrompt },
  { table: "agent_templates", column: "title", rewrite: title },
  { table: "agent_templates", column: "role_prompt", rewrite: rolePrompt },
  { table: "rules", column: "content", rewrite: exact(RULES) },
  { table: "projects", column: "context", rewrite: exact(CONTEXTS) },
  { table: "task_templates", column: "description", rewrite: exact(CHAIN_DESCRIPTIONS) },
  { table: "task_templates", column: "steps", rewrite: steps },
  { table: "chain_templates", column: "description", rewrite: exact(CHAIN_DESCRIPTIONS) },
  { table: "chain_templates", column: "steps", rewrite: steps },
];

export type SeededTextReport = {
  /** `table.column:id` of every value replaced. */
  translated: string[];
  /** `table.column:id` of values not replaced that still look French: edited, or not Legion's. */
  leftInFrench: string[];
};

/** Replaces, in the configuration columns, every value that is exactly a known French text. */
export function translateSeededText(sqlite: Database.Database): SeededTextReport {
  const report: SeededTextReport = { translated: [], leftInFrench: [] };
  for (const { table, column, rewrite } of COLUMNS) {
    const rows = sqlite.prepare(`SELECT id, ${column} AS value FROM ${table}`).all() as {
      id: string;
      value: string | null;
    }[];
    const update = sqlite.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
    for (const { id, value } of rows) {
      if (!value) continue;
      const where = `${table}.${column}:${id}`;
      const next = rewrite(value);
      if (next !== null) {
        update.run(next, id);
        report.translated.push(where);
      } else if (LOOKS_FRENCH.test(value)) report.leftInFrench.push(where);
    }
  }
  return report;
}

const log = createLogger("patch");

export const p2SeededTextInEnglish: DataPatch = {
  id: "p2-seeded-text-in-english",
  apply: (sqlite) => {
    const { translated, leftInFrench } = translateSeededText(sqlite);
    // Silent on a fresh database: the test suite opens hundreds.
    if (translated.length === 0 && leftInFrench.length === 0) return;
    log.info(
      `p2: ${translated.length} value(s) moved to English, ${leftInFrench.length} left as found ` +
        "(edited, or not written by Legion)",
      { leftInFrench },
    );
  },
};
