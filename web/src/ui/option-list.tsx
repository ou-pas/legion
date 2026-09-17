// The other rendering of a question's choices, when labels are too long or uneven for side-by-side
// buttons (web/src/inbox/choice-layout.ts decides). Full-width rows, a round marker on the left,
// text may wrap.
//
// No lasting selection: a choice sends its answer immediately; `selectedId` only marks the gap
// between the click and the server's response.
import "./option-list.css";

export interface Option {
  id: string;
  label: string;
}

export function OptionList({
  options,
  selectedId = null,
  disabled = false,
  onSelect,
}: {
  options: readonly Option[];
  /** The clicked option while the response is pending, not a persistent selection. */
  selectedId?: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="ui-option-list" role="list">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="listitem"
          className="ui-option"
          data-selected={o.id === selectedId ? "true" : undefined}
          disabled={disabled}
          onClick={() => onSelect(o.id)}
        >
          <span className="ui-option-mark" aria-hidden="true" />
          <span className="ui-option-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
