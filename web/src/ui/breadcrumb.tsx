// When the path is too long, the middle collapses (the root and the last two levels carry the
// meaning) behind a button that expands it.
import {
  Children,
  createContext,
  Fragment,
  use,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { UI_TEXT } from "./vocabulary.js";
import "./breadcrumb.css";

const ItemContext = createContext<boolean>(false);

export function Breadcrumb({
  label = UI_TEXT.breadcrumb,
  maxItems = 4,
  className,
  children,
}: {
  label?: string;
  /** Beyond this, intermediate levels collapse. */
  maxItems?: number;
  className?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children);
  const folded = !expanded && items.length > maxItems;
  const shown = folded ? [items[0], ...items.slice(-2)] : items;
  return (
    <nav aria-label={label} className={["ui-breadcrumb", className].filter(Boolean).join(" ")}>
      <ol className="ui-breadcrumb-list">
        {shown.map((child, i) => (
          <Fragment key={i}>
            <li className="ui-breadcrumb-item">
              <ItemContext value={i === shown.length - 1}>{child}</ItemContext>
            </li>
            {folded && i === 0 && (
              <>
                <Sep />
                <li className="ui-breadcrumb-item">
                  <button
                    type="button"
                    className="ui-breadcrumb-more"
                    onClick={() => setExpanded(true)}
                    aria-label={UI_TEXT.breadcrumbMore(items.length - 3)}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </li>
              </>
            )}
            {i < shown.length - 1 && <Sep />}
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

const Sep = () => (
  <li aria-hidden="true" className="ui-breadcrumb-sep">
    <ChevronRight size={13} />
  </li>
);

/** The last item gets `aria-current="page"` and is no longer an actionable link. */
export function BreadcrumbItem({
  icon,
  render,
  className,
  children,
}: {
  icon?: ReactNode;
  /** E.g. `render={(p) => <Link to="/p/$projectId/board" params={{ projectId }} {...p} />}`. */
  render?: (props: {
    className: string;
    children: ReactNode;
    "aria-current"?: "page";
  }) => ReactElement;
  className?: string;
  children: ReactNode;
}) {
  const last = use(ItemContext);
  const cls = ["ui-breadcrumb-link", last && "is-current", className].filter(Boolean).join(" ");
  const body = (
    <>
      {icon}
      <span className="ui-breadcrumb-text">{children}</span>
    </>
  );
  const current = last ? ("page" as const) : undefined;
  if (render) return render({ className: cls, children: body, "aria-current": current });
  return (
    <span className={cls} aria-current={current}>
      {body}
    </span>
  );
}
