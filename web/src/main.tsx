import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { queryClient, router } from "./router.js";
import { OperatorGate } from "./operator/operator-gate.js";
// Self-hosted variable fonts: no external request, no FOUT, versioned in the lockfile. Archivo is the
// only UI family, JetBrains Mono is for data.
import "@fontsource-variable/archivo";
import "@fontsource-variable/jetbrains-mono";
// Foundations then base, BEFORE any component: cascade order is a contract.
import "./ui/tokens.css";
import "./ui/base.css";
import "./ui/theme-dark.css";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    {/* The gate is ABOVE the router (13/09), and that placement is the point: a screen's requests
      start from its hooks, which run before the first `return`. A gate in the shell would let out the
      calls it claims to stop. */}
    <OperatorGate>
      <RouterProvider router={router} />
    </OperatorGate>
  </QueryClientProvider>,
);
