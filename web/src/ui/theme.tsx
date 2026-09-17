// A theme is the color block of the tokens, nothing else: Atelier's typography, spacing, radii and
// motion do not change.
//
// Three preferences, two themes (14/09). The default was hardcoded `light` and the effect wrote to
// storage on first render: someone who never touched the switch already had a saved preference, and
// an installed app on a phone in dark mode opened in warm paper. Following the device is the right
// default, and it is not a theme: it is the absence of a choice.
//
// Storage only keeps explicit choices. `system` is written as an absence (the key is removed): a
// serialised "no preference" is a complicated way of saying nothing.
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/** What the CSS knows: `theme-dark.css` has a single selector, `[data-theme="dark"]`. */
export type ThemeId = "light" | "dark";

/** What the human chooses: a theme, or the device's. Order is the button's cycle, `system` first
 *  because it is the default. */
export const THEME_PREFS = ["system", "light", "dark"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];

const KEY = "legion.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The saved preference, or `system` when there is none (including private browsing, where reading
 *  throws). The two legacy names are still mapped: a preference saved before the rename must not
 *  read as no choice. */
function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "nord") return "dark";
    if (v === "atelier") return "light";
    return THEME_PREFS.includes(v as ThemePref) ? (v as ThemePref) : "system";
  } catch {
    return "system";
  }
}

function systemTheme(): ThemeId {
  return globalThis.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

function subscribeToSystem(onChange: () => void): () => void {
  const mql = globalThis.matchMedia?.(DARK_QUERY);
  mql?.addEventListener("change", onChange);
  return () => mql?.removeEventListener("change", onChange);
}

/** The device theme, followed continuously. `useSyncExternalStore` rather than an effect: the change
 *  comes from the system, not a render, and a `setState` in an effect is what
 *  `react(set-state-in-effect)` rightly refuses. The `"light"` fallback serves SSR and tests, where
 *  `matchMedia` does not exist. */
function useSystemTheme(): ThemeId {
  return useSyncExternalStore(subscribeToSystem, systemTheme, () => "light");
}

interface ThemeApi {
  /** What is chosen: `system`, `light` or `dark`. */
  pref: ThemePref;
  /** What is displayed: always a theme, never `system`. */
  theme: ThemeId;
  setPref: (p: ThemePref) => void;
  dark: boolean;
  /** `system → light → dark → system`. A cycle rather than a toggle: a two-position toggle leaves no
   *  way back to following the device short of clearing storage. */
  cycle: () => void;
}

const Ctx = createContext<ThemeApi | null>(null);

export function useTheme() {
  return use(Ctx);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const system = useSystemTheme();
  const theme: ThemeId = pref === "system" ? system : pref;

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for the session */
    }
  }, []);

  // On <html>: floating surfaces (modal, toast, palette) render in portals outside the React tree
  // and must inherit too.
  //
  // Always the resolved theme, never the preference: `theme-dark.css` only knows an attribute
  // selector. Resolving here beats duplicating a hundred token lines behind
  // `@media (prefers-color-scheme: dark)`, two blocks that would diverge at the first added token.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const cycle = useCallback(() => {
    setPref(THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length] as ThemePref);
  }, [pref, setPref]);

  return <Ctx value={{ pref, theme, setPref, dark: theme === "dark", cycle }}>{children}</Ctx>;
}
