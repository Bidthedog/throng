/**
 * The one shared find bar (013, FR-002). ONE component serves both panel types: it
 * adapts to whichever panel it is open on — a terminal gets a read-only scrollback
 * find, an editor additionally gets replace. There is no results list: matches show
 * as in-content highlights plus the current/total count shown here.
 *
 * Every action control is a THEMEABLE ICON carrying a hover title (constitution
 * v3.12.0) — glyphs and colours come from theme tokens, never inline assets.
 */
import { useEffect, useRef, useState } from 'react';
import { resolveIcon } from '@throng/core';
import { useActiveTheme, useAppSettings } from '../config/config-store.js';
import { getPanelSearch } from './search-controller.js';
import {
  closeFind,
  findNext,
  findPrevious,
  replaceAll,
  replaceCurrent,
  setReplacement,
  setTerm,
  toggleMode,
  useFindState,
} from './search-store.js';
import './find-bar.css';

export interface FindBarProps {
  /** The panel this bar belongs to; it renders only while find is open on it. */
  panelId: string;
}

export function FindBar({ panelId }: FindBarProps): React.JSX.Element | null {
  const state = useFindState();
  const theme = useActiveTheme();
  const debounceMs = useAppSettings().search.asYouTypeDebounceMs;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [input, setInput] = useState('');

  const open = state.panelId === panelId;
  const isEditor = state.panelKind === 'editor';
  const controller = open ? getPanelSearch(panelId) : undefined;
  const readOnly = controller?.panelKind === 'editor' ? controller.isReadOnly() : true;

  // Every open — including re-issuing the chord while the bar is already up — primes the
  // input, focuses it, and selects it, so typing overtypes the seed rather than appending
  // (FR-002b) and never lands in the document by accident. Keyed on openSeq, which changes
  // on every open even when the term and panel do not.
  useEffect(() => {
    if (!open || !state.seeded) return;
    setInput(state.term);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [open, state.openSeq, state.seeded, state.term, panelId]);

  // Incremental as-you-type search (FR-002a), debounced by an injected setting so a
  // large file or scrollback still lands inside the SC-007 budget.
  useEffect(() => {
    if (!open || input === state.term) return;
    const t = setTimeout(() => setTerm(input), debounceMs);
    return () => clearTimeout(t);
  }, [open, input, state.term, debounceMs]);

  if (!open) return null;

  const icon = (token: string): string => resolveIcon(theme, token);
  const noResults = state.term.length > 0 && state.count.total === 0;
  const label = noResults
    ? 'No results'
    : state.count.total === 0
      ? ''
      : `${state.count.current} of ${state.count.total}`;

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Enter / Shift+Enter step matches from the input — the near-universal find idiom,
    // and not a rebindable chord. Everything else (Escape to close, Alt+Enter to
    // replace, F3 to step) belongs to the global bindings; handling them here too
    // would fire them twice.
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey) return;
    e.preventDefault();
    if (e.shiftKey) findPrevious();
    else findNext();
  };

  return (
    <div className="find-bar" data-testid={`find-bar-${panelId}`} role="search">
      <div className="find-bar-row">
        <span className="find-bar-icon" aria-hidden="true">
          {icon('search')}
        </span>
        <input
          ref={inputRef}
          className="find-bar-input"
          data-testid="find-input"
          type="text"
          value={input}
          placeholder="Find"
          aria-label="Find"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <span
          className={`find-bar-count${noResults ? ' find-bar-count--empty' : ''}`}
          data-testid="find-count"
        >
          {label}
        </span>
        <button
          type="button"
          className={`find-bar-btn${state.modes.caseSensitive ? ' find-bar-btn--on' : ''}`}
          data-testid="find-match-case"
          aria-pressed={state.modes.caseSensitive}
          title="Match case"
          onClick={() => toggleMode('caseSensitive')}
        >
          {icon('matchCase')}
        </button>
        <button
          type="button"
          className={`find-bar-btn${state.modes.wholeWord ? ' find-bar-btn--on' : ''}`}
          data-testid="find-whole-word"
          aria-pressed={state.modes.wholeWord}
          title="Whole word"
          onClick={() => toggleMode('wholeWord')}
        >
          {icon('wholeWord')}
        </button>
        <button
          type="button"
          className="find-bar-btn"
          data-testid="find-previous"
          title="Find previous"
          onClick={() => findPrevious()}
        >
          {icon('findPrevious')}
        </button>
        <button
          type="button"
          className="find-bar-btn"
          data-testid="find-next"
          title="Find next"
          onClick={() => findNext()}
        >
          {icon('findNext')}
        </button>
        <button
          type="button"
          className="find-bar-btn"
          data-testid="find-close"
          title="Close find"
          onClick={() => closeFind()}
        >
          {icon('dismiss')}
        </button>
      </div>

      {isEditor && state.replaceShown ? (
        <div className="find-bar-row" data-testid="find-replace-row">
          <span className="find-bar-icon" aria-hidden="true">
            {icon('replace')}
          </span>
          <input
            className="find-bar-input"
            data-testid="replace-input"
            type="text"
            value={state.replacement}
            placeholder="Replace"
            aria-label="Replace"
            disabled={readOnly}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="find-bar-count" />
          <button
            type="button"
            className="find-bar-btn"
            data-testid="replace-current"
            title="Replace match"
            disabled={readOnly}
            onClick={() => replaceCurrent()}
          >
            {icon('replace')}
          </button>
          <button
            type="button"
            className="find-bar-btn"
            data-testid="replace-all"
            title="Replace all"
            disabled={readOnly}
            onClick={() => replaceAll()}
          >
            {icon('replaceAll')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
