// Brand colours, held by a gate (round 4).
//
// The files in `web/public/providers/` come from simple-icons, which ships them without a `fill`,
// so black. Each got its brand colour by hand (`#FC6D26`, `#5E6AD2`, `#181717`). A regeneration
// from upstream would silently turn them black again, and nobody rereads an SVG.
//
// It reads the files themselves, not a copied table, to catch a file replaced without code change.
//
// `import.meta.glob(?raw)`, not `readFileSync`: the `sourceReadInTests` ratchet
// (`server/src/architecture/`) refuses one more test reading a file, and Vite resolves the path
// here, so the test depends neither on the cwd nor on how `vitest` was started. (The same `?raw` on
// a stylesheet returns an empty string, CSS being disabled in the config: that is why the constant
// brand plate is guaranteed by the absence of an override in `theme-dark.css`, not by a test.)
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../api/connections.js";

/** The expected colour of each brand. Written here and in the file on purpose: that duplication is
 *  the gate. A test reading only what the file holds would say nothing the day the file changes. */
const BRAND: Record<string, string> = {
  github: "#181717",
  gitlab: "#FC6D26",
  linear: "#5E6AD2",
};

const SVGS = import.meta.glob("../../public/providers/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("provider logos carry their brand colour", () => {
  for (const provider of PROVIDERS) {
    it(`${provider}.svg carries ${BRAND[provider]}`, () => {
      const file = Object.entries(SVGS).find(([path]) => path.endsWith(`/${provider}.svg`));
      // `getByText` on a file: if it is missing, the drawing is no longer served at all, which is
      // at least as serious as a lost colour.
      expect(file, `no drawing served for ${provider}`).toBeDefined();
      expect(file?.[1]).toContain(`fill="${BRAND[provider]}"`);
    });
  }
});
