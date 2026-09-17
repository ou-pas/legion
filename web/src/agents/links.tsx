// Two project links dressed by the design system. The grants' empty states name the way out (the
// copy rule: "say what to do"), so these links are content, not decoration.
//
// `tab` is required: these links used to target the bare address (`/p/$projectId/libraries`,
// `/p/$projectId/project`), which redirects to a first tab and has been linked nowhere since 12/09.
// A `switch` to each real route, because TanStack Router's `to` is typed on declared paths, not on
// a `/…/$tab` template.
import type { ReactNode } from "react";
import { Link as RouterLink } from "@tanstack/react-router";
import { Link } from "../ui/link.js";

export function CapabilitiesLink({
  projectId,
  tab,
  children,
}: {
  projectId: string;
  tab: "skills" | "regles" | "mcp";
  children: ReactNode;
}) {
  switch (tab) {
    case "skills":
      return (
        <Link
          render={(p) => (
            <RouterLink to="/p/$projectId/libraries/skills" params={{ projectId }} {...p} />
          )}
        >
          {children}
        </Link>
      );
    case "regles":
      return (
        <Link
          render={(p) => (
            <RouterLink to="/p/$projectId/libraries/rules" params={{ projectId }} {...p} />
          )}
        >
          {children}
        </Link>
      );
    case "mcp":
      return (
        <Link
          render={(p) => (
            <RouterLink to="/p/$projectId/libraries/mcp" params={{ projectId }} {...p} />
          )}
        >
          {children}
        </Link>
      );
  }
}

export function ProjectLink({
  projectId,
  tab,
  children,
}: {
  projectId: string;
  tab: "repos" | "secrets";
  children: ReactNode;
}) {
  switch (tab) {
    case "repos":
      return (
        <Link
          render={(p) => (
            <RouterLink to="/p/$projectId/project/repos" params={{ projectId }} {...p} />
          )}
        >
          {children}
        </Link>
      );
    case "secrets":
      return (
        <Link
          render={(p) => (
            <RouterLink to="/p/$projectId/project/secrets" params={{ projectId }} {...p} />
          )}
        >
          {children}
        </Link>
      );
  }
}
