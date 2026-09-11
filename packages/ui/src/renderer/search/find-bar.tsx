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
import { formatGrouped, type SearchCount } from '@throng/core';
import { useAppSettings } from '../config/config-store.js';
import { Icon } from '../common/icon.js';
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
  toggleReplace,
  useVisibleFindSession,
} from './search-store.js';
import './find-bar.css';

/**
 * What the counter SAYS — `N of M`, the no-results state, or nothing at all (043 FR-014).
 *
 * ══ WHY THE FIGURES ARE GROUPED ══
 *
 * The constitution requires every displayed quantity to carry the active locale's digit grouping
 * (4.5.0, widened by 5.4.0), and it names this counter as one of the enumerated surfaces that
 * predate the rule — the one whose magnitude routinely passes 1,000. A find over a large file or a
 * long scrollback reaches five figures as a matter of course, and `12384 of 20480` is a wall of
 * digits nobody reads as a position. FR-014 makes this feature the numeric change that closes it.
 *
 * `formatGrouped` from `@throng/core` and nothing else: a `toLocaleString` here, or a hand-rolled
 * comma, would be a second formatter that the locale-aware parser is no longer the inverse of. The
 * grouping is strictly a VIEW concern and reaches nothing else — the store's `count` stays a pair
 * of numbers, and that pair is what crosses to the controllers.
 *
 * ══ WHY IT IS A FUNCTION, AND WHY IT TAKES A LOCALE ══
 *
 * `Intl` reads its default from the runtime, so nothing a rendered component is handed can change
 * it — which would leave the case that actually matters, a locale grouping with `.`, untestable at
 * every layer. Taking the locale as an argument is what makes it a unit test, exactly as
 * `statusReadouts` records for the same reason.
 */
export function findCountLabel(count: SearchCount, term: string, locale?: string): string {
  // An empty bar has not searched, so it must not report that it found nothing: 013 FR-009 draws
  // "no results" and "not yet run" as different states, and `0 of 0` would be neither.
  if (count.total === 0) return term.length > 0 ? 'No results' : '';
  return `${formatGrouped(count.current, locale)} of ${formatGrouped(count.total, locale)}`;
}

export interface FindBarProps {
  /** The panel this bar belongs to; it renders only while find is open on it. */
  panelId: string;
}

export function FindBar({ panelId }: FindBarProps): React.JSX.Element | null {
  /*
   * THIS panel's session, and only while this panel's bar is the visible one (043 FR-003/FR-004).
   * The bar used to read the window's ONE find state and compare its `panelId` — so every bar in
   * the window re-rendered on every keystroke in any of them, and a session could only exist for
   * whichever panel was showing.
   */
  const session = useVisibleFindSession(panelId);
  const debounceMs = useAppSettings().search.asYouTypeDebounceMs;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [input, setInput] = useState('');

  const open = session !== null;
  const openSeq = session?.openSeq ?? 0;
  const term = session?.term ?? '';
  const isEditor = session?.panelKind === 'editor';
  const controller = open ? getPanelSearch(panelId) : undefined;
  const readOnly = controller?.panelKind === 'editor' ? controller.isReadOnly() : true;

  /*
   * Prime the input from the session — on every OPEN, and on every re-SHOW.
   *
   * Two arrivals, one effect. An open (a new `openSeq`) additionally focuses and selects the
   * input, so typing overtypes the seed rather than appending (013 FR-002b) and never lands in the
   * document by accident. A re-show — the user coming back to a panel whose session was merely
   * hidden (043 FR-002) — primes the input but takes NO focus: they moved back into the panel's
   * content, and dragging the caret into the bar would fight the move they just made.
   *
   * `term` and `seeded` are deliberately not dependencies: this must not re-run per keystroke,
   * which would overwrite what the user is typing with the last term the store settled on.
   */
  useEffect(() => {
    if (!open) return;
    setInput(term);
    if (!session?.seeded) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openSeq, panelId]);

  // Incremental as-you-type search (FR-002a), debounced by an injected setting so a
  // large file or scrollback still lands inside the SC-007 budget.
  useEffect(() => {
    if (!open || input === term) return;
    const t = setTimeout(() => setTerm(panelId, input), debounceMs);
    return () => clearTimeout(t);
  }, [open, input, term, debounceMs, panelId]);

  if (!session) return null;

  const noResults = session.term.length > 0 && session.count.total === 0;
  const label = findCountLabel(session.count, session.term);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Enter / Shift+Enter step matches from the input — the near-universal find idiom,
    // and not a rebindable chord. Everything else (Escape to close, Alt+Enter to
    // replace, F3 to step) belongs to the global bindings; handling them here too
    // would fire them twice.
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey) return;
    e.preventDefault();
    if (e.shiftKey) findPrevious(panelId);
    else findNext(panelId);
  };

  return (
    <div className="find-bar" data-testid={`find-bar-${panelId}`} role="search">
      {/*
        THE ROW IS GROUPS, NOT BUTTONS (043 FR-010).

        Every control used to be a direct child of the row at one uniform gap, which drew seven
        identical squares in an unbroken line — nothing said that Aa/ab are one idea, ↑/↓ another and
        replace a third. The wrappers below are what the CSS separates: a wider gap between groups
        than within one. They carry no behaviour, so nothing here changes what any control DOES.
      */}
      <div className="find-bar-row">
        <div className="find-bar-group find-bar-group--field">
          <span className="find-bar-icon" aria-hidden="true">
            <Icon token="search" />
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
        </div>
        {/* Match modes — how the term is matched. */}
        <div className="find-bar-group">
          <button
            type="button"
            className={`find-bar-btn${session.modes.caseSensitive ? ' find-bar-btn--on' : ''}`}
            data-testid="find-match-case"
            aria-pressed={session.modes.caseSensitive}
            title="Match case"
            onClick={() => toggleMode(panelId, 'caseSensitive')}
          >
            <Icon token="matchCase" />
          </button>
          <button
            type="button"
            className={`find-bar-btn${session.modes.wholeWord ? ' find-bar-btn--on' : ''}`}
            data-testid="find-whole-word"
            aria-pressed={session.modes.wholeWord}
            title="Whole word"
            onClick={() => toggleMode(panelId, 'wholeWord')}
          >
            <Icon token="wholeWord" />
          </button>
        </div>
        {/* Navigation — stepping through the matches the term found. */}
        <div className="find-bar-group">
          <button
            type="button"
            className="find-bar-btn"
            data-testid="find-previous"
            title="Find previous"
            onClick={() => findPrevious(panelId)}
          >
            <Icon token="findPrevious" />
          </button>
          <button
            type="button"
            className="find-bar-btn"
            data-testid="find-next"
            title="Find next"
            onClick={() => findNext(panelId)}
          >
            <Icon token="findNext" />
          </button>
        </div>
        {/* Replace — the disclosure that opens the row below, and on a terminal, nothing at all. */}
        <div className="find-bar-group">
          {/*
          The replace DISCLOSURE control (043 FR-008). Before it, the only way to learn that this
          bar could replace at all was to know Ctrl+H, and the only way back to a find-only bar was
          to close it and re-open it.

          It drives the SESSION's `replaceShown` — the same field Ctrl+H sets — because FR-009 says
          the click route and the key route must never disagree, and one piece of state is the only
          arrangement in which they cannot. `aria-expanded` and the glyph both come off that one
          field, so what the control SAYS and what the bar DRAWS cannot drift apart either.

          Editor only (FR-013): a terminal's find is read-only, so there is nothing to disclose and
          the control is absent rather than disabled.

          Two static `<Icon>` elements rather than one with a computed token: `icon-tokens-exist`
          can only check a literal, and a token typo renders NOTHING at all — an invisible control,
          with no error anywhere.
        */}
          {isEditor ? (
            <button
              type="button"
              className="find-bar-btn"
              data-testid="find-toggle-replace"
              aria-expanded={session.replaceShown}
              aria-controls={`find-replace-row-${panelId}`}
              // The title names what the CLICK will do, so it changes with the state — a control
              // whose hover title said "Toggle replace" in both states would name no action at all.
              title={session.replaceShown ? 'Hide replace' : 'Show replace'}
              onClick={() => toggleReplace(panelId)}
            >
              {session.replaceShown ? <Icon token="collapse" /> : <Icon token="expand" />}
            </button>
          ) : null}
        </div>
        {/* Dismissal stands apart from all three: it acts on the bar, not on the search. */}
        <div className="find-bar-group">
          <button
            type="button"
            className="find-bar-btn"
            data-testid="find-close"
            title="Close find"
            onClick={() => closeFind(panelId)}
          >
            <Icon token="dismiss" />
          </button>
        </div>
      </div>

      {isEditor && session.replaceShown ? (
        <div
          className="find-bar-row"
          id={`find-replace-row-${panelId}`}
          data-testid="find-replace-row"
        >
          {/* The same field cluster as the row above, so the two inputs line up: identical
              elements at an identical gap, rather than two coincidentally similar rows. */}
          <div className="find-bar-group find-bar-group--field">
            <span className="find-bar-icon" aria-hidden="true">
              <Icon token="replace" />
            </span>
            <input
              className="find-bar-input"
              data-testid="replace-input"
              type="text"
              value={session.replacement}
              placeholder="Replace"
              aria-label="Replace"
              disabled={readOnly}
              onChange={(e) => setReplacement(panelId, e.target.value)}
              onKeyDown={onKeyDown}
            />
            <span className="find-bar-count" />
          </div>
          <div className="find-bar-group">
            <button
              type="button"
              className="find-bar-btn"
              data-testid="replace-current"
              title="Replace match"
              disabled={readOnly}
              onClick={() => replaceCurrent(panelId)}
            >
              <Icon token="replace" />
            </button>
            <button
              type="button"
              className="find-bar-btn"
              data-testid="replace-all"
              title="Replace all"
              disabled={readOnly}
              onClick={() => replaceAll(panelId)}
            >
              <Icon token="replaceAll" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
