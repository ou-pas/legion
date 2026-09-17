import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Book,
  Folder,
  FolderPlus,
  Home,
  Inbox,
  Plus,
  ScrollText,
  Server,
  Settings,
  SquareArrowOutUpRight,
  Target,
} from "lucide-react";
import { bootstrapQuery, wikiIndexQuery } from "../queries.js";
import { lookupApi } from "../api/bootstrap.js";
import { idCandidate } from "./id-candidate.js";
import { routeFor } from "./route-for.js";
import { NewProjectModal, readLastProjectId } from "../projects/project.js";
import { TaskComposerModal } from "../tasks/TaskComposer.js";
import { GoalComposerModal } from "../goals/GoalComposer.js";
import { Empty } from "../ui/empty.js";
import { Row, Stack } from "../ui/flex.js";
import { SearchInput } from "../ui/input.js";
import { Kbd } from "../ui/kbd.js";
import { Modal, ModalBody } from "../ui/modal.js";
import { NavItem, NavLabel } from "../ui/nav.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { PALETTE_TEXT } from "./text/palette.js";

interface Command {
  id: string;
  group: string;
  label: string;
  keywords: string;
  icon: ReactNode;
  run: () => void;
}

const Ctx = createContext<{ open: () => void } | null>(null);
/** Opens the palette from anywhere (e.g. the top bar search button). */
export function useCommandPalette() {
  return use(Ctx);
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [overlay, setOverlay] = useState<null | "task" | "goal" | "project">(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (overlay) return; // never over an already open modal
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);

  return (
    <Ctx value={{ open: () => setOpen(true) }}>
      {children}
      {open && (
        <Palette
          onClose={() => setOpen(false)}
          onAction={(a) => {
            setOpen(false);
            setOverlay(a);
          }}
        />
      )}
      {overlay === "task" && <TaskComposerModal onClose={() => setOverlay(null)} />}
      {overlay === "goal" && <GoalComposerModal onClose={() => setOverlay(null)} />}
      {overlay === "project" && <NewProjectModal onClose={() => setOverlay(null)} />}
    </Ctx>
  );
}

function Palette({
  onClose,
  onAction,
}: {
  onClose: () => void;
  onAction: (a: "task" | "goal" | "project") => void;
}) {
  const navigate = useNavigate();
  const { data: boot } = useQuery(bootstrapQuery);
  // The corpus only changes with a repo commit: read once when the palette opens, kept an hour.
  // The index is a list of titles, not the pages.
  const { data: wiki } = useQuery(wikiIndexQuery);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      {
        id: "new-task",
        group: PALETTE_TEXT.group.actions,
        ...PALETTE_TEXT.command.newTask,
        icon: <Plus size={16} />,
        run: () => onAction("task"),
      },
      {
        id: "new-goal",
        group: PALETTE_TEXT.group.actions,
        ...PALETTE_TEXT.command.newGoal,
        icon: <Target size={16} />,
        run: () => onAction("goal"),
      },
      {
        id: "new-project",
        group: PALETTE_TEXT.group.actions,
        ...PALETTE_TEXT.command.newProject,
        icon: <FolderPlus size={16} />,
        run: () => onAction("project"),
      },
      // "Home", not "Dashboard": `/` is no longer a screen but a switch to the last open project
      // (slice nav/04). The word follows the destination.
      {
        id: "nav-dashboard",
        group: PALETTE_TEXT.group.goTo,
        ...PALETTE_TEXT.command.home,
        icon: <Home size={16} />,
        run: () => void navigate({ to: "/" }),
      },
      // There is no global inbox anymore (12/09): the inbox is per project, see
      // [[produit/decisions]]. The palette opens the last open project's, with the SAME rule as the
      // root route `/` (`indexRoute`, `router.tsx`): last visited, else the first, else nothing.
      {
        id: "nav-inbox",
        group: PALETTE_TEXT.group.goTo,
        ...PALETTE_TEXT.command.inbox,
        icon: <Inbox size={16} />,
        run: () => {
          const projects = boot?.projects ?? [];
          const last = readLastProjectId();
          const target = projects.find((p) => p.id === last) ?? projects.at(0);
          if (!target) return;
          void navigate({ to: "/p/$projectId/inbox", params: { projectId: target.id } });
        },
      },
      {
        id: "nav-system",
        group: PALETTE_TEXT.group.goTo,
        ...PALETTE_TEXT.command.system,
        icon: <Settings size={16} />,
        run: () => void navigate({ to: "/system/general" }),
      },
      {
        id: "nav-infra",
        group: PALETTE_TEXT.group.goTo,
        ...PALETTE_TEXT.command.infra,
        icon: <Server size={16} />,
        run: () => void navigate({ to: "/system/runners" }),
      },
      {
        id: "nav-logs",
        group: PALETTE_TEXT.group.goTo,
        ...PALETTE_TEXT.command.logs,
        icon: <ScrollText size={16} />,
        run: () => void navigate({ to: "/system/logs" }),
      },
      {
        id: "nav-analytics",
        group: PALETTE_TEXT.group.goTo,
        ...PALETTE_TEXT.command.analytics,
        icon: <BarChart3 size={16} />,
        run: () => void navigate({ to: "/system/analytics" }),
      },
    ];
    for (const p of boot?.projects ?? []) {
      cmds.push({
        id: `proj-${p.id}`,
        group: PALETTE_TEXT.group.projects,
        label: p.name,
        keywords: PALETTE_TEXT.projectKeywords(p.name),
        icon: <Folder size={16} />,
        run: () => void navigate({ to: "/p/$projectId/board", params: { projectId: p.id } }),
      });
    }
    // Wiki pages (slice nav/03). What one wants from a wiki is rarely browsing the tree, it is
    // "what is an approval gate": the palette is the real door. The SECTION travels as a keyword,
    // so "docker" finds the infra pages without knowing their titles.
    for (const page of wiki?.pages ?? []) {
      cmds.push({
        id: `wiki-${page.slug}`,
        group: PALETTE_TEXT.group.wiki,
        label: page.title,
        keywords: PALETTE_TEXT.wikiKeywords(page.slug, page.section),
        icon: <Book size={16} />,
        run: () => void navigate({ to: "/wiki/$slug", params: { slug: page.slug } }),
      });
    }
    return cmds;
  }, [navigate, onAction, boot, wiki]);

  // Pasting an id opens its page (26/08). `idCandidate` decides locally whether the input can be an
  // id, or every typed letter would trigger a call. Resolution is SERVER-side: tasks are not in
  // `bootstrap` (hundreds of them), and loading them all for an id search would pay a whole list
  // for one row.
  const probe = idCandidate(q);
  const { data: hit, isFetching: probing } = useQuery({
    queryKey: ["lookup", probe ?? ""] as const,
    queryFn: () => lookupApi.lookup(probe!).catch(() => null),
    enabled: Boolean(probe),
    staleTime: 30_000,
  });

  const idCommand = useMemo<Command | null>(() => {
    if (!hit) return null;
    // A hit `routeFor` cannot route (no projectId; never in practice, the columns are NOT NULL) is
    // treated as an unknown id: no command row, the palette falls back to "not found".
    const route = routeFor(hit);
    if (!route) return null;
    const kind = PALETTE_TEXT.id.kind[hit.kind];
    return {
      id: `lookup-${hit.id}`,
      group: PALETTE_TEXT.group.id,
      label: PALETTE_TEXT.id.open(kind, hit.label),
      keywords: PALETTE_TEXT.id.keywords(hit.id, hit.label),
      icon: <SquareArrowOutUpRight size={16} />,
      run: () => void navigate(route),
    };
  }, [hit, navigate]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matches = needle
      ? commands.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(needle))
      : commands;
    // Always first: after pasting an id it is the only row wanted, and Enter must open it without
    // aiming.
    return idCommand ? [idCommand, ...matches] : matches;
  }, [commands, q, idCommand]);

  // A new query restarts from the first result, or Enter would run an old index no longer at the top.
  // Adjusted during render, not in an effect, to avoid a cascading render (oxlint
  // react/set-state-in-effect).
  const [seenQuery, setSeenQuery] = useState(q);
  if (q !== seenQuery) {
    setSeenQuery(q);
    setActive(0);
  }
  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runAt = (i: number) => {
    const cmd = filtered[i];
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let flat = -1; // continuous index across groups, for the active state
  let lastGroup = "";

  return (
    <Modal onClose={onClose} size="lg" label={PALETTE_TEXT.label}>
      <ModalBody>
        <Stack gap={10}>
          <Row gap={8}>
            <SearchInput
              value={q}
              onValueChange={setQ}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls="cmdp-list"
              aria-label={PALETTE_TEXT.search}
              aria-activedescendant={filtered[active] ? `cmdp-${filtered[active].id}` : undefined}
              spellCheck={false}
              placeholder={PALETTE_TEXT.placeholder}
            />
            <Kbd keys={PALETTE_TEXT.escape} />
          </Row>
          <ScrollArea>
            <div id="cmdp-list" role="listbox" aria-label={PALETTE_TEXT.list}>
              {/* Three different empties. "No command matches" used to show on a perfectly valid
                  id, true and useless. Searching → say so; unknown id → say it DIFFERENTLY; not an
                  id → the plain message. */}
              {filtered.length === 0 && probing && (
                <Empty variant="inline" art="filtered" title={PALETTE_TEXT.id.searching} />
              )}
              {filtered.length === 0 && !probing && probe && (
                <Empty variant="inline" art="filtered" title={PALETTE_TEXT.id.unknownTitle}>
                  {PALETTE_TEXT.id.unknownWhy(probe)}
                </Empty>
              )}
              {filtered.length === 0 && !probing && !probe && (
                <Empty variant="inline" art="filtered" title={PALETTE_TEXT.noMatchTitle}>
                  {PALETTE_TEXT.noMatchWhy(q)}
                </Empty>
              )}
              {filtered.map((cmd) => {
                flat += 1;
                const i = flat;
                const header = cmd.group !== lastGroup ? cmd.group : null;
                lastGroup = cmd.group;
                return (
                  <div key={cmd.id}>
                    {header && <NavLabel>{header}</NavLabel>}
                    <NavItem
                      icon={cmd.icon}
                      active={i === active}
                      // The ↵ follows the ACTIVE item. It was hardcoded on the first row while
                      // Enter ran the selected one: the mark lied about the key (operator
                      // feedback).
                      badge={i === active ? <Kbd keys={PALETTE_TEXT.enter} /> : undefined}
                      render={({ className, children }) => (
                        <button
                          type="button"
                          id={`cmdp-${cmd.id}`}
                          className={className}
                          role="option"
                          aria-selected={i === active}
                          ref={(el) => {
                            itemRefs.current[i] = el;
                          }}
                          onMouseMove={() => setActive(i)}
                          onClick={() => runAt(i)}
                        >
                          {children}
                        </button>
                      )}
                    >
                      {cmd.label}
                    </NavItem>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </Stack>
      </ModalBody>
    </Modal>
  );
}
