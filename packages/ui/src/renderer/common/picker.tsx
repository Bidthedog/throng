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
 *
 * ══ 033 (#219) — FIVE OPTIONAL PROPS, AND THE RULE THEY ALL OBEY ══
 *
 * `contracts/picker-extensions.md §§3–4`. Quick Open needs ranking, a render cap, a line saying what
 * the cap hid, a control above the input and a seeded query. Every one of them is OPTIONAL and inert
 * when absent, because the governing constraint here is NEGATIVE: **a caller that passes none of
 * them must behave exactly as it does today**, and `tab-picker.tsx` passes none (SC-013). `rank`
 * above all — a picker that ranked unasked would reorder the tab strip under the user's arrow keys,
 * which is 031's K11 and the reason this file did not rank in the first place.
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
import { compileQuery, rankStable, type CompiledQuery } from '@throng/core';
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
  /**
   * The chosen entry, and the QUERY that was standing when it was chosen.
   *
   * The second argument is additive (033 FR-061) and every existing caller ignores it. Quick Open
   * needs it because "the query that opened a file" is a fact only this component holds: the query
   * lives in `useState` here, and a caller that wanted it would otherwise have to keep a second copy
   * in step with every keystroke — a duplicate of the control's own state, which is exactly the
   * forking `contracts/picker-extensions.md` forbids.
   */
  onChoose: (entry: PickerEntry, query: string) => void;
  onDismiss: () => void;
  placeholder?: string;
  /**
   * Shown when the query matches nothing (K12).
   *
   * A `ReactNode` rather than a `string` since 033: Quick Open's "still listing" state (FR-015, S3)
   * belongs exactly here — in the space where results would be — and it carries a test id of its
   * own. Widening a prop nobody passes an element to changes no existing caller.
   */
  emptyMessage?: ReactNode;
  /** Prefix for this instance's test ids, so two pickers on one screen stay distinguishable. */
  testId?: string;
  /**
   * Ranks the FILTERED entries; higher is better. **Absent → the seeded order, unchanged** (K11, P1).
   *
   * Applied after filtering and before the cap, so `maxRows` keeps the best rows rather than the
   * first ones (P2).
   */
  rank?: (text: string, query: CompiledQuery) => number;
  /** The most rows to RENDER. Absent → no cap. Matching is never capped (P3). */
  maxRows?: number;
  /** Rendered when `maxRows` truncated the list. Absent → nothing is said (P4). */
  truncatedMessage?: (shown: number, total: number) => string;
  /** Rendered ABOVE the input, first in the DOM and so first in the tab order (P7, E5). */
  header?: ReactNode;
  /** Seeds the query, fully selected on open, so the first keystroke replaces it (P5, P6). */
  initialQuery?: string;
}

/**
 * The label with its matched runs marked (K10, FR-028e).
 *
 * The spans are computed against the **rendered** string rather than the searchable one, because an
 * offset into a text the user cannot see would highlight the wrong characters. When an entry matched
 * only on a hidden part of its text (a path whose label is just the file name), nothing is marked —
 * correct, and better than marking something arbitrary.
 */
function Marked({ text, query }: { text: string; query: CompiledQuery }): ReactElement {
  const spans = useMemo(() => query.spans(text), [text, query]);
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
  rank,
  maxRows,
  truncatedMessage,
  header,
  initialQuery = '',
}: PickerProps): ReactElement {
  const [query, setQuery] = useState(initialQuery);
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // E1 — the narrowing needs to know whether a key ORIGINATED here, so the input needs a handle.
  const inputRef = useRef<HTMLInputElement>(null);
  // P5's once-only latch: a seeded query is selected when the input first takes focus, and never
  // again — re-selecting on a later focus would swallow the user's caret position.
  const selected = useRef(false);

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

  /*
   * The query, compiled ONCE per keystroke rather than once per entry (C2).
   *
   * `matches(text, query)` builds this query's regular expressions inside every call, which is two
   * constructions at 031's tab counts and a hundred thousand at 033's fifty-thousand-path corpus.
   * The compiled form is the same rule — it IS what `matches` now wraps — hoisted out of the loop.
   */
  const compiled = useMemo(() => compileQuery(query), [query]);

  const matched = useMemo(
    // `filter` preserves the seeded order — K11 is this line, and it must stay this line.
    () => entries.filter((entry) => compiled.test(entry.text)),
    [entries, compiled],
  );

  /*
   * matched → rank (ONLY when given) → slice(maxRows). The order matters and P2 is why: ranking
   * before the cap keeps the best `maxRows` rows, ranking after it would keep the first ones and
   * then sort that arbitrary handful.
   */
  const visible = useMemo(() => {
    const ranked = rank ? rankStable(matched, (entry) => rank(entry.text, compiled)) : matched;
    return maxRows !== undefined && ranked.length > maxRows ? ranked.slice(0, maxRows) : ranked;
  }, [matched, rank, compiled, maxRows]);

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
    onChoose(entry, query);
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    // E2 — Escape is claimed from ANYWHERE inside the modal and always dismisses, header included.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    /*
     * E1 — the list's three keys are claimed ONLY when the event came from the query input.
     *
     * This handler sits on the dialog, so before 033 it claimed `Enter` wherever it originated —
     * which was invisible while the input was the only focusable element (E4), and wrong the moment
     * a `header` puts a control beside it: Enter on that control would open a file instead of
     * operating the control the user was actually on (FR-010b). With no header the condition is
     * always true and this is the same code path it has always been, which is what keeps the tab
     * picker's behaviour bit-for-bit unchanged.
     */
    if (event.target === inputRef.current) {
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
        default:
          break;
      }
    }
    // Everything else is typing, or a key belonging to the focused control. The trap still gets Tab.
    trap.onKeyDown(event);
  };

  return (
    <div
      // `--transient`: no scrim of its own. The shared one is painted from <body> by the overlay
      // registry, because a picker replacing another picker must not blink the scrim between them.
      className="modal-overlay modal-overlay--transient"
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
        {/* P7 — above the input, so it is also BEFORE it in the tab order and Shift+Tab reaches it
            (E5). Inside the card, so it is inside the focus trap and Tab cannot leave through it. */}
        {header}
        <input
          className="picker__input"
          data-testid={`${testId}-input`}
          type="text"
          ref={inputRef}
          autoFocus
          value={query}
          placeholder={placeholder}
          aria-label={title}
          // P5 — a SEEDED query arrives fully selected, so the first keystroke replaces it rather
          // than appending to it. `onFocus` rather than an effect: `autoFocus` has already fired by
          // the time an effect could run, and re-selecting on every render would fight the caret.
          onFocus={(event) => {
            if (initialQuery !== '' && !selected.current) {
              selected.current = true;
              event.target.select();
            }
          }}
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
                  <Marked text={entry.label} query={compiled} />
                </span>
                {entry.meta ? <span className="picker__meta">{entry.meta}</span> : null}
              </div>
            ))
          )}
          {/* P3, P4 — the cap limits RENDERING only, so this count is the truth about how many
              matched. It sits in the list, after the rows, where the list visibly stops. */}
          {truncatedMessage && visible.length < matched.length ? (
            <div className="picker__truncated" data-testid={`${testId}-truncated`}>
              {truncatedMessage(visible.length, matched.length)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
