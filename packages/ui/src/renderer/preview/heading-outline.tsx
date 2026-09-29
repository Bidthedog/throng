/**
 * The Go to Heading pop-down (047 US4, research.md R7, contracts/menus-commands-controls.md
 * "Go to Heading pop-down"). Opened by `preview.goToHeading` (T055 wires it in); a renderer component
 * over the `DocumentSymbol[]` the body's last render reported (`onHeadings`, `provider-view.ts`), so it
 * follows edits live with no fetch of its own.
 *
 * ══ WHAT IS "CURRENT" VS WHAT IS "ACTIVE" ══
 *
 * Two different ideas share this UI, and conflating them was the easiest way to get this wrong:
 *
 * - The CURRENT entry (`aria-current="location"`) is a fact about the DOCUMENT — the heading whose
 *   section contains the block at the top of the view right now (`heading-outline-model.ts`'s
 *   `currentHeadingSlug`). It never moves because of a keypress here.
 * - The ACTIVE row (`activeIndex`, roving `tabIndex`) is a fact about THIS POP-DOWN's own keyboard
 *   focus, which starts in the search box and only enters the tree on Down.
 *
 * On open they usually coincide (the pop-down opens scrolled to the current entry) — but typing moves
 * ACTIVE to the first match while CURRENT stays exactly where the document's scroll position leaves it,
 * and the two stay visually distinct (`.heading-outline__row--current` vs `--active`) for exactly that
 * reason.
 *
 * ══ TREE-NODE COLLAPSE IS THIS COMPONENT'S OWN, NEVER THE DOCUMENT'S (FR-045) ══
 *
 * `collapsedNodes` narrows what THIS LIST shows; it has no connection at all to the document's own
 * Markdown fold state (`preview-panel.tsx`'s `foldState`) — collapsing a node here to tidy the outline
 * does not fold the document, and folding a section in the document does not collapse it here.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { DocumentSymbol } from '@throng/core';
import { Icon } from '../common/icon.js';
import { flattenHeadings, visibleRows, type OutlineRow } from './heading-outline-model.js';
import './heading-outline.css';

export interface HeadingOutlineProps {
  panelId: string;
  /** Renders nothing while false — mounted once, per panel, for its whole lifetime (T055). */
  open: boolean;
  /** This render's heading tree (`PreviewBodyProps.onHeadings`); `[]` reads as "No headings". */
  headings: readonly DocumentSymbol[];
  /** R7 — the heading whose section holds the block at the top of the view right now, or none. */
  currentSlug: string | null;
  /** The reader picked a heading (Enter or click) — jump to it. Does not itself close the pop-down. */
  onJump(slug: string): void;
  /** Esc, or a jump: closes and returns focus to the preview body (contract). */
  onClose(): void;
}

export function HeadingOutline({ panelId, open, headings, currentSlug, onJump, onClose }: HeadingOutlineProps): ReactElement | null {
  const [query, setQuery] = useState('');
  const [collapsedNodes, setCollapsedNodes] = useState<ReadonlySet<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(-1);
  const [domFocus, setDomFocus] = useState<'search' | 'row'>('search');

  const searchRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const flat = useMemo(() => flattenHeadings(headings), [headings]);
  const rows = useMemo(() => visibleRows(flat, query, collapsedNodes), [flat, query, collapsedNodes]);

  // `false`, never `open`: a panel mounted ALREADY open (the common case — this component mounts once
  // per panel and toggles `open` from then on, but a test or a fresh panel can start true) must still
  // see its first render as an "opening" and initialise from it, not skip the reset because there was
  // no CLOSED render to transition away from.
  const wasOpen = useRef(false);
  const highlightCurrent = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      // A fresh open: query and DOM-focus reset (FR-043a); `collapsedNodes` is untouched (FR-045).
      setQuery('');
      setDomFocus('search');
      highlightCurrent.current = true;
    }
    wasOpen.current = open;
  }, [open]);

  // The current entry is found among the rows DRAWN, once the reset query has taken effect — an index
  // into the whole outline would name the wrong row whenever a tree node above it is collapsed.
  useEffect(() => {
    if (!open || !highlightCurrent.current || query !== '') return;
    highlightCurrent.current = false;
    setActiveIndex(currentSlug !== null ? rows.findIndex((r) => r.heading.symbol.slug === currentSlug) : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows, query]);

  // A query the reader TYPED narrows the list and moves ACTIVE to the first match (never the DOM
  // focus, which stays in the search box until the reader explicitly leaves it). The reset on open is
  // not typing, and must leave the current entry highlighted.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    typed.current = false;
    // The first MATCH, never merely the first visible row — a query's leading rows can be ancestors
    // shown only for context (FR-043's own "highlights the first match").
    const firstMatch = rows.findIndex((r) => r.matched);
    setActiveIndex(firstMatch >= 0 ? firstMatch : rows.length > 0 ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (!open) return;
    if (domFocus === 'search') searchRef.current?.focus();
    else if (activeIndex >= 0) rowRefs.current.get(activeIndex)?.focus();
  }, [open, domFocus, activeIndex]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = activeIndex >= 0 ? rowRefs.current.get(activeIndex) : null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, rows.length]);

  const focusSearch = useCallback(() => {
    setDomFocus('search');
  }, []);

  const jump = useCallback(
    (slug: string) => {
      onJump(slug);
      onClose();
    },
    [onJump, onClose],
  );

  const toggleCollapsed = useCallback((slug: string, collapse: boolean) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (collapse) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }, []);

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (rows.length === 0) return;
        const start = activeIndex >= 0 ? activeIndex : 0;
        setActiveIndex(start);
        setDomFocus('row');
        return;
      }
      if (e.key === 'Enter') {
        if (activeIndex >= 0 && rows[activeIndex]) jump(rows[activeIndex].heading.symbol.slug);
      }
    },
    [rows, activeIndex, onClose, jump],
  );

  const onRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, index: number) => {
      const row = rows[index];
      if (!row) return;
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          return;
        case 'ArrowDown':
          e.preventDefault();
          if (index < rows.length - 1) setActiveIndex(index + 1);
          return;
        case 'ArrowUp':
          e.preventDefault();
          if (index === 0) focusSearch();
          else setActiveIndex(index - 1);
          return;
        case 'ArrowRight': {
          e.preventDefault();
          const hasChildren = row.heading.symbol.children.length > 0;
          if (!hasChildren) return;
          if (collapsedNodes.has(row.heading.symbol.slug)) toggleCollapsed(row.heading.symbol.slug, false);
          else if (index < rows.length - 1) setActiveIndex(index + 1);
          return;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const hasChildren = row.heading.symbol.children.length > 0;
          if (hasChildren && !collapsedNodes.has(row.heading.symbol.slug)) {
            toggleCollapsed(row.heading.symbol.slug, true);
            return;
          }
          const parentSlug = row.heading.parentSlug;
          if (parentSlug === null) return;
          const parentIndex = rows.findIndex((r) => r.heading.symbol.slug === parentSlug);
          if (parentIndex >= 0) setActiveIndex(parentIndex);
          return;
        }
        case 'Enter':
          e.preventDefault();
          jump(row.heading.symbol.slug);
          return;
        default:
          return;
      }
    },
    [rows, collapsedNodes, onClose, focusSearch, jump, toggleCollapsed],
  );

  // Ctrl+G, from anywhere inside the pop-down, always returns to the search box (contract).
  const onRootKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        focusSearch();
      }
    },
    [focusSearch],
  );

  // FR-042c — a pointer-down anywhere outside the pop-down closes it without jumping. Capture phase,
  // so a target that stops propagation (a panel's own drag handle) still closes it.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const doc = rootRef.current?.ownerDocument ?? document;
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return;
      onClose();
    };
    doc.addEventListener('pointerdown', onPointerDown, true);
    return () => doc.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      className="heading-outline"
      data-testid={`heading-outline-${panelId}`}
      role="dialog"
      aria-label="Go to heading"
      onKeyDown={onRootKeyDown}
    >
      <div className="heading-outline__search">
        <span className="heading-outline__search-icon" aria-hidden="true">
          <Icon token="search" />
        </span>
        <input
          ref={searchRef}
          type="text"
          className="heading-outline__search-input"
          data-testid="heading-outline-search"
          aria-label="Filter headings"
          value={query}
          onChange={(e) => {
            typed.current = true;
            setQuery(e.target.value);
          }}
          onKeyDown={onSearchKeyDown}
          onFocus={focusSearch}
        />
      </div>
      {rows.length === 0 ? (
        <div className="heading-outline__empty" data-testid="heading-outline-empty">
          No headings
        </div>
      ) : (
        <div className="heading-outline__list" role="tree" aria-label="Headings">
          {rows.map((row, index) => (
            <HeadingOutlineRow
              key={row.heading.symbol.slug}
              row={row}
              index={index}
              // The roving-tabindex TARGET and the visual highlight are the same row whether or not
              // DOM focus has actually moved there yet (typing highlights the first match while focus
              // stays in the search box) — see the file header's CURRENT-vs-ACTIVE note.
              active={index === activeIndex}
              current={row.heading.symbol.slug === currentSlug}
              collapsed={collapsedNodes.has(row.heading.symbol.slug)}
              onRef={(el) => {
                if (el) rowRefs.current.set(index, el);
                else rowRefs.current.delete(index);
              }}
              onKeyDown={(e) => onRowKeyDown(e, index)}
              onClick={() => jump(row.heading.symbol.slug)}
              onToggle={(collapse) => toggleCollapsed(row.heading.symbol.slug, collapse)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HeadingOutlineRow({
  row,
  index,
  active,
  current,
  collapsed,
  onRef,
  onKeyDown,
  onClick,
  onToggle,
}: {
  row: OutlineRow;
  index: number;
  active: boolean;
  current: boolean;
  collapsed: boolean;
  onRef: (el: HTMLDivElement | null) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onClick: () => void;
  onToggle: (collapse: boolean) => void;
}): ReactElement {
  const hasChildren = row.heading.symbol.children.length > 0;
  const classes = [
    'heading-outline__row',
    current ? 'heading-outline__row--current' : '',
    active ? 'heading-outline__row--active' : '',
    row.matched ? '' : 'heading-outline__row--context',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      ref={onRef}
      role="treeitem"
      className={classes}
      data-testid={`heading-outline-row-${row.heading.symbol.slug}`}
      data-index={index}
      aria-level={row.heading.depth + 1}
      {...(hasChildren ? { 'aria-expanded': !collapsed } : {})}
      {...(current ? { 'aria-current': 'location' as const } : {})}
      tabIndex={active ? 0 : -1}
      style={{ paddingLeft: `${row.heading.depth * 16 + 8}px` }}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {hasChildren ? (
        <button
          type="button"
          className="heading-outline__toggle"
          data-testid={`heading-outline-toggle-${row.heading.symbol.slug}`}
          aria-label={collapsed ? `Expand ${row.heading.symbol.name}` : `Collapse ${row.heading.symbol.name}`}
          title={collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(!collapsed);
          }}
        >
          <Icon token={collapsed ? 'expand' : 'collapse'} />
        </button>
      ) : (
        <span className="heading-outline__toggle heading-outline__toggle--spacer" aria-hidden="true" />
      )}
      <span className="heading-outline__label">{row.heading.symbol.name}</span>
    </div>
  );
}
