import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { LANGUAGES, PLAIN_TEXT_ID, PLAIN_TEXT_NAME } from '@throng/core';
import { useServices } from '../composition-root.js';
import { setDocumentOverride } from './language-override.js';

/** The tallest the list may ever be — the CSS ceiling, restated here because the clamp caps against it. */
const MAX_HEIGHT_PX = 260;
/** Below this the list is too small to be worth showing; it scrolls instead. */
const MIN_HEIGHT_PX = 96;
/** Breathing room between the picker's top edge and the top of the window. */
const MARGIN_PX = 8;

/**
 * The searchable language picker (016, FR-010/FR-011).
 *
 * Filterable across every supported language PLUS Plain Text — which is a first-class CHOICE here,
 * not the absence of one: picking it is how a user says "stop trying to highlight this file", and
 * it terminates the precedence chain rather than handing the file back to detection (FR-004c).
 *
 * Selecting applies IMMEDIATELY — the document re-highlights and the override is persisted. There
 * is no OK button to forget to press.
 */
export interface LanguagePickerProps {
  panelId: string;
  projectId: string | null;
  relPath: string | null;
  current: string;
  onClose: () => void;
}

interface Choice {
  id: string;
  name: string;
}

const CHOICES: readonly Choice[] = [
  { id: PLAIN_TEXT_ID, name: PLAIN_TEXT_NAME },
  ...LANGUAGES.map((l) => ({ id: l.id, name: l.name })),
];

export function LanguagePicker({
  panelId,
  projectId,
  relPath,
  current,
  onClose,
}: LanguagePickerProps): ReactElement {
  const { documents } = useServices();
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>(MAX_HEIGHT_PX);

  /*
   * 018 / FR-013 — CLAMP. This picker had no measurement of any kind.
   *
   * It is pinned just above the status strip at the BOTTOM of an editor panel and grows UPWARD, so
   * an unbounded 260px list in a SHORT panel near the top of the window simply ran off the top of
   * the screen — the same failure as the font typeahead that put FR-013 in the spec, arrived at from
   * the opposite direction. The discovering guard found this one too.
   *
   * It CLAMPS rather than flips, and that is the honest answer rather than a missing feature: it
   * opens upward from a strip that is already at the bottom of its panel, so there is nothing below
   * to flip down to. The room it has is the room above it, and the fix is to stop pretending it has
   * more than that. The list scrolls (`overflow-y: auto`), so a clamped picker still reaches every
   * language.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `bottom` is measured from the top of the viewport, so it IS the room available above.
    const room = el.getBoundingClientRect().bottom - MARGIN_PX;
    setMaxHeight(Math.max(MIN_HEIGHT_PX, Math.min(MAX_HEIGHT_PX, room)));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return CHOICES;
    return CHOICES.filter((c) => c.name.toLowerCase().includes(needle) || c.id.includes(needle));
  }, [filter]);

  const choose = (languageId: string): void => {
    // Applied to the live view at once; persisted in the background. The user does not wait for a
    // round-trip to see their own decision take effect.
    void setDocumentOverride({ panelId, projectId, relPath, languageId, documents });
    onClose();
  };

  /*
   * THE LIST IS ONE STOP, NOT TWO HUNDRED.
   *
   * Every option was a `<button>`, so Tab stepped through the languages one at a time — a listbox
   * with a hundred tab stops, where Tab did the job of an arrow key and reaching the filter again
   * meant tabbing past every remaining language. That is not what Tab is for, and it is not what the
   * ARIA listbox pattern says: a composite widget is a SINGLE stop, and the arrows move within it.
   *
   * So the list carries a roving tabindex — only the active option is tabbable — and Tab therefore
   * moves between the filter and the list, ArrowUp/ArrowDown move between languages, Home/End jump
   * to the ends, and Enter confirms. Typing in the filter re-aims the active option at the first
   * match, so a filter-then-Enter never confirms a language that has been filtered away.
   */
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  // Clamp when filtering shrinks the list under the cursor — an index past the end would leave
  // Enter confirming nothing and the roving tabindex on no one.
  const active = Math.min(activeIndex, Math.max(0, matches.length - 1));

  /** Move the active option, and take the DOM focus with it if the list already had it. */
  const moveActive = (next: number): void => {
    const clamped = Math.max(0, Math.min(next, matches.length - 1));
    setActiveIndex(clamped);
    const list = listRef.current;
    if (!list || !list.contains(document.activeElement)) return;
    const option = list.querySelectorAll<HTMLElement>('.language-picker__item')[clamped];
    option?.focus();
    option?.scrollIntoView({ block: 'nearest' });
  };

  const onListKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // Off the TOP of the list is back to the filter — the way in was ArrowDown out of it, and a
      // door that only opens one way is not a door. Without this, ArrowUp on the first option just
      // re-focused the first option, and the only way back to the filter was Shift+Tab.
      if (active === 0) inputRef.current?.focus();
      else moveActive(active - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      moveActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      moveActive(matches.length - 1);
    }
  };

  return (
    <div
      ref={ref}
      className="language-picker"
      style={{ maxHeight }}
      role="dialog"
      aria-label="Set language"
      data-testid={`language-picker-${panelId}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <input
        ref={inputRef}
        className="language-picker__filter"
        data-testid={`language-filter-${panelId}`}
        type="text"
        placeholder="Filter languages"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          setActiveIndex(0); // a new filter re-aims at its first match
        }}
        // ArrowDown enters the list — at the ACTIVE option, the one Enter would confirm, rather
        // than stepping past it: focus is in the filter, so nothing in the list has been "left" to
        // move on from. ArrowUp does nothing, because the filter is the top of the picker; the
        // mirror of this gesture is ArrowUp on the first option, which comes back here.
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown') return;
          e.preventDefault();
          if (matches.length === 0) return;
          const options = listRef.current?.querySelectorAll<HTMLElement>('.language-picker__item');
          options?.[active]?.focus();
        }}
      />
      <ul
        className="language-picker__list"
        role="listbox"
        ref={listRef}
        onKeyDown={onListKeyDown}
      >
        {matches.map((choice, i) => (
          <li key={choice.id}>
            <button
              type="button"
              role="option"
              aria-selected={choice.id === current}
              // Roving tabindex: the list is ONE tab stop. Only the active option is reachable by
              // Tab; the arrows move which one that is.
              tabIndex={i === active ? 0 : -1}
              className={`language-picker__item${
                choice.id === current ? ' language-picker__item--current' : ''
              }${i === active ? ' language-picker__item--active' : ''}`}
              data-testid={`language-option-${choice.id}`}
              onFocus={() => setActiveIndex(i)}
              onClick={() => choose(choice.id)}
            >
              {choice.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
