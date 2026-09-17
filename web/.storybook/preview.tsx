// The context every story receives.
//
// Two lessons are set here:
//  - The router is created once, at module level. Built inside the decorator it is new on every render
//    and never finishes resolving: the story rendered nothing, with no console error.
//  - The style imports of `main.tsx`, all of them. `base.css` depends on `tokens.css` without importing
//    it, and fonts are a separate import; taking only one gave a bare-serif, colourless workshop. A font
//    import that outlives its dependency (Fraunces, 08/09) stops Storybook from starting; `make deadcode`
//    catches it.
import { createContext, use, useEffect, type ReactNode } from "react";
import type { Decorator, Preview } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { ThemeProvider } from "../src/ui/theme.js";
import { ToastProvider } from "../src/ui/toast.js";

import "@fontsource-variable/archivo";
import "@fontsource-variable/jetbrains-mono";
import "../src/ui/tokens.css";
import "../src/ui/base.css";
import "../src/ui/theme-dark.css";
// Demo support classes (a narrow column to show truncation, a sheet to hold a list). Outside src/: only
// the workshop uses them.
import "./specimens.css";

/** The current story, passed to the router without rebuilding it. */
const StoryContext = createContext<ReactNode>(null);

/** A root that renders the story directly: no child route, so no path to match. The router only gives
 *  `<Link>`s their context (wikilink, breadcrumb, task card); a workshop renders, it does not navigate. */
const rootRoute = createRootRoute({ component: () => <>{use(StoryContext)}</> });
const router = createRouter({
  routeTree: rootRoute,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

/** A client that never retries: a story querying the API must fail fast and visibly, not spin behind a
 *  skeleton. */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});

/** The Storybook toolbar theme drives the app theme: our tokens read `<html data-theme>`, while
 *  Storybook styles its own frame. */
function SyncTheme({ theme }: { theme: string }) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  }, [theme]);
  return null;
}

const withAppContext: Decorator = (Story, ctx) => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <SyncTheme theme={String(ctx.globals.theme ?? "dark")} />
      <ToastProvider>
        <StoryContext value={<Story />}>
          <RouterProvider router={router} />
        </StoryContext>
      </ToastProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

const preview: Preview = {
  decorators: [withAppContext],
  globalTypes: {
    theme: {
      description: "Colour theme (tokens, not type or spacing)",
      defaultValue: "dark",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "dark", title: "Nord (dark)" },
          { value: "light", title: "Atelier (light)" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    // No generated controls: components expose explicit variants, not booleans to toggle. One story per
    // state beats a settings panel.
    controls: { disable: true },
    layout: "padded",
  },
};

export default preview;
