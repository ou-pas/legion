// PR and issue lists. Numbered pages with ellipses, previous/next and an optional page size.
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { UI_TEXT } from "./vocabulary.js";
import "./pagination.css";

/** First, last, current and its neighbours; the rest becomes an ellipsis. */
function windowed(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const near = [page - 1, page, page + 1].filter((p) => p > 1 && p < count);
  const first = near[0] ?? count;
  const last = near.at(-1) ?? 1;
  return [
    1,
    ...(first > 2 ? (["gap"] as const) : []),
    ...near,
    ...(last < count - 1 ? (["gap"] as const) : []),
    count,
  ];
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  pageSize,
  pageSizeOptions = [25, 50, 100],
  onPageSizeChange,
  label = UI_TEXT.pagination.label,
  className,
}: {
  /** 1-indexed. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Provide both `pageSize` and `onPageSizeChange` to show the size selector. */
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  label?: string;
  className?: string;
}) {
  const go = (p: number) => {
    if (p >= 1 && p <= pageCount && p !== page) onPageChange(p);
  };
  return (
    <nav aria-label={label} className={["ui-pagination", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="ui-page-btn"
        aria-label={UI_TEXT.pagination.previous}
        disabled={page <= 1}
        onClick={() => go(page - 1)}
      >
        <ChevronLeft size={14} />
      </button>
      <ol className="ui-pagination-list">
        {windowed(page, pageCount).map((entry, i) => (
          <li key={entry === "gap" ? `gap-${i}` : entry}>
            {entry === "gap" ? (
              <span className="ui-page-gap" aria-hidden="true">
                <MoreHorizontal size={14} />
              </span>
            ) : (
              <button
                type="button"
                className="ui-page-btn"
                aria-label={UI_TEXT.pagination.page(entry)}
                aria-current={entry === page ? "page" : undefined}
                onClick={() => go(entry)}
              >
                {entry}
              </button>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="ui-page-btn"
        aria-label={UI_TEXT.pagination.next}
        disabled={page >= pageCount}
        onClick={() => go(page + 1)}
      >
        <ChevronRight size={14} />
      </button>
      {pageSize != null && onPageSizeChange && (
        <label className="ui-pagination-size">
          {UI_TEXT.pagination.perPage}
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </nav>
  );
}
