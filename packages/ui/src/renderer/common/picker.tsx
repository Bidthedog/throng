/**
 * The general list-and-choose control (031 US3, contracts/tab-strip.md §5, FR-028a).
 *
 * Entries in, chosen entry out. **Nothing in this file knows what a tab is** — that is the whole
 * requirement, not a stylistic preference: #219 seeds the same control with file paths, and a
 * control that had learned about tabs would have to be forked to do it. Everything tab-shaped lives
 * in `workspace/tab-picker.tsx`, which is a seeding function and a callback.
 *
 * The matching rule is core's (`matches` / `matchSpans`): every whitespace-separated term must appear
 * as a case-insensitive substring, in ANY order, matched across separators. So `find file` finds
 * `file find.txt` and `src/find/file.ts` alike (K4, K5, K7), and an empty query matches everything
 * (K6).
 *
 * Two things this control deliberately does NOT do:
 *
 *  - **It does not rank.** Rows come back in the seeded set's own order (K11). A picker over the tab
 *    strip must list tabs in strip order, and a relevance score would reorder them under the user
 *    mid-type — the one motion that makes an arrow-key list unusable.
 *  - **It does not close on an empty result.** No match keeps the picker open and says so (K12), so
 *    a typo is a backspace rather than a re-open.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { matchSpans, matches } from '@throng/core';
import { useFocusTrap } from './focus-trap.js';

export interface PickerEntry {
  id: string;
  /** What the typeahead matches against. */
  text: string;
  /** What is shown. Usually the same string as `text`; the marks are drawn on THIS one. */
  label: string;
  /** Secondary detail shown at the trailing edge of the row (a count, a folder, a size). */
  meta?: string;
  /** Marks the entry the user is already on, so "where am I?" is answerable without choosing. */
  isCurrent?: boolean;
}

export interface PickerProps {
  /** Names what is being chosen — the one piece of text a caller must supply. */
  title: string;
  entries: readonly PickerEntry[];
  onChoose: (entry: PickerEntry) => void;
  onDismiss: () => void;
  placeholder?: string;
  /** Shown when the query matches nothing (K12). */
  emptyMessage?: string;
  /** Prefix for this instance's test ids, so two pickers on one screen stay distinguishable. */
  testId?: string;
}

/**
 * The label with its matched runs marked (K10, FR-028e).
 *
 * The spans are computed against the **rendered** string rather than the searchable one, because an
 * offset into a text the user cannot see would highlight the wrong characters. When an entry matched
 * only on a hidden part of its text (a path whose label is just the file name), nothing is marked —
 * correct, and better than marking something arbitrary.
 */
function Marked({ text, query }: { text: string; query: string }): ReactElement {
  const spans = useMemo(() => matchSpans(text, query), [text, query]);
  if (spans.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start > at) parts.push(text.slice(at, span.start));
    parts.push(
      <mark className="picker__mark" key={`${span.start}-${span.end}`}>
        {text.slice(span.start, span.end)}
      </mark>,
    );
    at = span.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

export function Picker({
  title,
  entries,
  onChoose,
  onDismiss,
  placeholder = 'Type to filter…',
  emptyMessage = 'No matches',
  testId = 'picker',
}: PickerProps): ReactElement {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Declared FIRST on purpose. React runs unmount cleanups in the order their effects were declared,
  // and the trap installs a `focusin` guard that hauls focus back inside. Restoring focus (below)
  // while that guard was still live would be undone the instant it happened.
  const trap = useFocusTrap<HTMLDivElement>(true);

  /*
   * T8 / FR-032e — dismissing returns focus to where it was.
   *
   * The picker is a detour: the user was in a terminal or an editor, pressed the chord, and either
   * chose something or changed their mind. Leaving focus on a dismissed overlay's corpse strands
   * them, and "press Escape then click back into what you were doing" is not a dismissal.
   */
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const captured = useRef(false);
  /*
   * Captured during RENDER, which is the only phase early enough.
   *
   * The query input carries `autoFocus`, and React applies that in the COMMIT phase — before layout
   * effects and long before passive ones. So an effect asking "where was focus?" is answered with
   * the picker's own input, and on unmount that element is already gone: `document.contains` is
   * false, the restore is skipped, and focus is left on `body`. The user pressed Escape and landed
   * nowhere. Rendering happens before the commit, so at this point `document.activeElement` is still
   * whatever the user was actually on — read once, and never again, so a re-render mid-typing cannot
   * overwrite it with the input.
   */
  if (!captured.current) {
    captured.current = true;
    returnFocusTo.current = document.activeElement as HTMLElement | null;
  }
  useEffect(() => {
    return () => {
      const previous = returnFocusTo.current;
      // `document.body` is not a place to send anyone back to, and it is what `activeElement` reads
      // when nothing is focused — restoring it would fight the trap for no gain.
      if (previous && previous !== document.body && document.contains(previous)) previous.focus();
    };
  }, []);

  const visible = useMemo(
    // `filter` preserves the seeded order — K11 is this line, and it must stay this line.
    () => entries.filter((entry) => matches(entry.text, query)),
    [entries, query],
  );

  /*
   * Keep the highlight on a real row as the result set narrows. Reset to the top on every query
   * change rather than trying to follow the previously highlighted entry: a list that re-narrows
   * under the caret while the highlight chases an entry that may no longer be present is far harder
   * to use than one that always starts from the top of what is now shown.
   */
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const index = visible.length === 0 ? -1 : Math.min(highlighted, visible.length - 1);

  // Keep the highlighted row in view — arrowing past the bottom of a scrolling list must not require
  // the user to also scroll it.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [index, query]);

  const move = (step: 1 | -1): void => {
    if (visible.length === 0) return;
    setHighlighted((current) => {
      const from = Math.min(current, visible.length - 1);
      return (from + step + visible.length) % visible.length;
    });
  };

  const choose = (entry: PickerEntry | undefined): void => {
    if (!entry) return;
    onChoose(entry);
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        return;
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        choose(visible[index]);
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
        return;
      default:
        // Everything else is typing. The trap still gets Tab.
        trap.onKeyDown(event);
    }
  };

  return (
    <div
      className="modal-overlay"
      data-testid={`${testId}-overlay`}
      // `mousedown`, not `click`: a click that STARTED inside the card and finished on the scrim (a
      // drag-select across the query field) is not a dismissal, and `click` cannot tell them apart.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        className="picker"
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={trap.ref}
        onKeyDown={onKeyDown}
      >
        <input
          className="picker__input"
          data-testid={`${testId}-input`}
          type="text"
          autoFocus
          value={query}
          placeholder={placeholder}
          aria-label={title}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="picker__list" data-testid={`${testId}-list`} role="listbox" ref={listRef}>
          {visible.length === 0 ? (
            <div className="picker__empty" data-testid={`${testId}-empty`}>
              {emptyMessage}
            </div>
          ) : (
            visible.map((entry, i) => (
              <div
                key={entry.id}
                className={`picker__row${i === index ? ' picker__row--highlighted' : ''}${
                  entry.isCurrent ? ' picker__row--current' : ''
                }`}
                data-testid={`${testId}-row-${entry.id}`}
                data-highlighted={i === index ? 'true' : 'false'}
                data-current={entry.isCurrent ? 'true' : 'false'}
                role="option"
                aria-selected={i === index}
                title={entry.meta ? `${entry.label} — ${entry.meta}` : entry.label}
                // `mousedown` again: the query input is focused, and a plain click would blur it
                // first. Choosing on the press is also what makes a click feel immediate.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(entry);
                }}
                onMouseEnter={() => setHighlighted(i)}
              >
                <span className="picker__label">
                  <Marked text={entry.label} query={query} />
                </span>
                {entry.meta ? <span className="picker__meta">{entry.meta}</span> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
