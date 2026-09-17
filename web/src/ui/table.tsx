// Sort display lives here (arrow plus aria-sort); sorting logic stays with the caller. Numbers are
// not formatted here: a `num` cell aligns, `<Num>` renders the measure.
import { Children, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import "./table.css";

export type CellAlign = "start" | "num";
export type SortDirection = "asc" | "desc" | null;

/** Wrapped: horizontal overflow is handled here, not on the page. */
export function Table({
  sticky = false,
  label,
  className,
  children,
}: {
  /** Sticky headers, for a table inside a scrolling area. */
  sticky?: boolean;
  /** Name of the scrolling area (required to make it keyboard-reachable). */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={["ui-table-wrap", className].filter(Boolean).join(" ")}
      tabIndex={0}
      role={label == null ? undefined : "region"}
      aria-label={label}
    >
      <table className="ui-table" data-sticky={sticky ? "true" : undefined}>
        {children}
      </table>
    </div>
  );
}

export function Thead({ className, children }: { className?: string; children: ReactNode }) {
  return <thead className={["ui-thead", className].filter(Boolean).join(" ")}>{children}</thead>;
}

/** `empty` shows when `children` yields no row: the empty state is inside the table. */
export function Tbody({
  empty,
  cols = 1,
  className,
  children,
}: {
  empty?: ReactNode;
  cols?: number;
  className?: string;
  children?: ReactNode;
}) {
  const filled = Children.count(children) > 0;
  return (
    <tbody className={["ui-tbody", className].filter(Boolean).join(" ")}>
      {filled || empty == null ? (
        children
      ) : (
        <tr>
          <td className="ui-table-empty" colSpan={cols}>
            {empty}
          </td>
        </tr>
      )}
    </tbody>
  );
}

export function Tr({
  selected,
  interactive,
  onClick,
  className,
  children,
}: {
  selected?: boolean;
  interactive?: boolean;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <tr
      className={["ui-tr", className].filter(Boolean).join(" ")}
      data-interactive={(interactive ?? onClick != null) ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function Th({
  align = "start",
  sortable = false,
  sortDirection = null,
  onSort,
  scope = "col",
  className,
  children,
}: {
  align?: CellAlign;
  sortable?: boolean;
  sortDirection?: SortDirection;
  onSort?: () => void;
  scope?: "col" | "row";
  className?: string;
  children: ReactNode;
}) {
  const Arrow =
    sortDirection === "asc" ? ArrowUp : sortDirection === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <th
      scope={scope}
      className={["ui-th", className].filter(Boolean).join(" ")}
      data-align={align}
      aria-sort={
        !sortable
          ? undefined
          : sortDirection === "asc"
            ? "ascending"
            : sortDirection === "desc"
              ? "descending"
              : "none"
      }
    >
      {sortable ? (
        <button
          type="button"
          className="ui-th-sort"
          onClick={onSort}
          data-active={sortDirection ? "true" : undefined}
        >
          {children}
          <Arrow size={13} aria-hidden="true" />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({
  align = "start",
  colSpan,
  className,
  children,
}: {
  align?: CellAlign;
  colSpan?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <td
      className={["ui-td", className].filter(Boolean).join(" ")}
      data-align={align}
      colSpan={colSpan}
    >
      {children}
    </td>
  );
}
