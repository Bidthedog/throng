/**
 * A text field that offers the values remembered for it (067 US7, FR-061 to FR-067).
 *
 * The values belong to one field of one terminal type; the list drops under the field when it is focused
 * and narrows as the user types (FR-135), a pick fills the whole value, and a clear button beside the field forgets that field's list for
 * that type alone. It is the ARIA combobox pattern over a listbox rather than a native `<datalist>`
 * because a remembered value can hold newlines or run to hundreds of characters, and the list must show
 * each on one truncated line with the full text on hover, which a datalist cannot do.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { IconButton } from '../common/icon-button.js';

/** One line, whatever the value holds: line breaks become a visible mark. */
export function oneLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ⏎ ');
}

export function HistoryInput({
  testId,
  value,
  onChange,
  history,
  clearTitle,
  onClear,
  onRemove,
  title,
  placeholder,
}: {
  testId: string;
  value: string;
  onChange: (next: string) => void;
  /** Remembered values for this field and terminal type, newest first. Empty when the history is off. */
  history: readonly string[];
  /** Names the clear action, e.g. "Clear remembered startup commands". */
  clearTitle: string;
  onClear: () => void;
  /** 067 FR-133 — Delete on the highlighted value forgets that one value. */
  onRemove?: (value: string) => void;
  title?: string;
  placeholder?: string;
}): ReactElement {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Flip and clamp (018 FR-013): the list opens below the field, or above it when the window has more room
  // there, and its height never exceeds the room it has.
  const [placement, setPlacement] = useState<{ above: boolean; maxHeight: number }>({ above: false, maxHeight: 160 });

  // 067 FR-135 — focusing or clicking offers the whole list, whatever the field holds; only typing since
  // then narrows it to the matches.
  const [narrowing, setNarrowing] = useState(false);
  const matches = useMemo(() => {
    const needle = value.trim().toLowerCase();
    if (!narrowing || needle === '') return history;
    return history.filter((h) => h.toLowerCase().includes(needle) && h !== value);
  }, [history, value, narrowing]);
  const offerAll = (): void => {
    setOpen(true);
    setNarrowing(false);
    setActive(-1);
  };
  const shown = open && matches.length > 0;
  useLayoutEffect(() => {
    if (!shown || !inputRef.current || !listRef.current) return;
    const field = inputRef.current.getBoundingClientRect();
    const wanted = Math.min(listRef.current.scrollHeight, 160);
    const below = window.innerHeight - field.bottom - 8;
    const above = field.top - 8;
    const flip = wanted > below && above > below;
    setPlacement({ above: flip, maxHeight: Math.max(48, Math.min(160, flip ? above : below)) });
  }, [shown, matches.length]);

  const pick = (picked: string): void => {
    onChange(picked);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="history-input">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        data-testid={testId}
        title={title}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setNarrowing(true);
          setActive(-1);
        }}
        onFocus={offerAll}
        // A click on a field that already has focus (after Esc or a pick) fires no focus event.
        onMouseDown={() => {
          if (document.activeElement === inputRef.current && !open) offerAll();
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && matches.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + 1) % matches.length);
          } else if (e.key === 'ArrowUp' && shown) {
            e.preventDefault();
            setActive((a) => (a <= 0 ? matches.length - 1 : a - 1));
          } else if (e.key === 'Enter' && shown && active >= 0) {
            // Picking is not confirming the form: the Enter is spent here.
            e.preventDefault();
            e.stopPropagation();
            pick(matches[active]!);
          } else if (e.key === 'Delete' && shown && active >= 0 && onRemove) {
            // 067 FR-133 — forget the highlighted value; the text is untouched. The highlight stays at this
            // index, which is now the next value, or steps back after the last; an emptied list closes.
            e.preventDefault();
            onRemove(matches[active]!);
            const left = matches.length - 1;
            if (left === 0) {
              setOpen(false);
              setActive(-1);
            } else {
              setActive(Math.min(active, left - 1));
            }
          } else if (e.key === 'Escape' && shown) {
            // Closes the list only; the dialog around the form does not see it.
            e.stopPropagation();
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      {history.length > 0 ? (
        <IconButton
          token="dismiss"
          title={clearTitle}
          testId={`${testId}-clear`}
          className="history-input__clear"
          onClick={onClear}
        />
      ) : null}
      {shown ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className={`history-input__list${placement.above ? ' history-input__list--above' : ''}`}
          style={{ maxHeight: placement.maxHeight }}
          data-testid={`${testId}-history`}
        >
          {matches.map((m, i) => (
            <li
              key={m}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`history-option${i === active ? ' history-option--active' : ''}`}
              title={m}
              // mousedown, not click: the input's blur would close the list before a click landed.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
            >
              {oneLine(m)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
