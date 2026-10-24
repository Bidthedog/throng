import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useWorkspaceOptional } from '../state/workspace-store.js';
import { AttentionMark } from './attention-mark.js';
import { AttentionPopover } from './attention-popover.js';
import { categoryCycleKey, goToNextMarkedOf, projectCycleKey } from './mark-cycle.js';
import {
  useCategoryMark,
  useMarkForPanels,
  usePanelMark,
  useProjectMarkKey,
  type HolderMark,
} from './use-attention.js';

/*
 * One small component per holder KIND, because a holder is usually drawn inside a `.map` where a hook
 * cannot be called, and because each subscribes to its own value-compared key (use-attention.ts) so that
 * raising a mark re-renders the holders it concerns and no others.
 *
 * The testid is `attention-<site>-<id>` everywhere (pinned by `attention-mark-call-sites.test.ts`).
 */

/** A panel's header (FR-003). No native tooltip: the panel it marks is the one it sits on (FR-096). */
export function PanelHeaderMark({ panelId }: { panelId: string }): ReactElement | null {
  const mark = usePanelMark(panelId);
  return mark === null ? null : <AttentionMark mark={mark} testId={`attention-panel-${panelId}`} />;
}

/**
 * The lead slot of a project row: the mark while the project is marked, its colour dot otherwise
 * (FR-092), so the mark sits in the same spot on every row and never has to compete with a highlighted
 * row's fill beside the name. Active, loaded or unloaded alike — the mark is main's, not the layout's
 * (FR-012).
 */
export function ProjectRowLead({ projectId, colour }: { projectId: string; colour: string }): ReactElement {
  const mark = useProjectMarkKey(projectId);
  const projectIds = useMemo(() => [projectId], [projectId]);
  return mark === null ? (
    <span className="project-item__dot" style={{ background: colour }} aria-hidden />
  ) : (
    <ListHolderMark
      mark={mark}
      testId={`attention-project-${projectId}`}
      cycleKey={projectCycleKey(projectId)}
      projectIds={projectIds}
      grouped={false}
      blockAncestorTitle
    />
  );
}

/**
 * A category header: any member counts, whether or not its row is visible (FR-013). Its popover is the
 * project row's, grouped by project in list order (FR-098).
 */
export function CategoryHeaderMark({
  categoryId,
  projectIds,
}: {
  categoryId: string;
  projectIds: readonly string[];
}): ReactElement | null {
  const mark = useCategoryMark(projectIds);
  // The flag's slot is held while unmarked, so a header's name never moves as a mark comes and goes (FR-133).
  return mark === null ? (
    <MarkSlot />
  ) : (
    <ListHolderMark
      mark={mark}
      testId={`attention-category-${categoryId}`}
      cycleKey={categoryCycleKey(categoryId)}
      projectIds={projectIds}
      grouped
    />
  );
}

/**
 * A mark on the project list (a row's or a category header's): the mark itself, its popover (FR-097,
 * FR-098) and the click that goes to the next marked panel it stands for, wrapping (FR-105).
 *
 * Its own component, mounted only while the holder is marked, so the workspace context (the layout order
 * the click and the popover use) is subscribed to by marked holders alone and not by every row.
 *
 * The click is stopped from reaching the row: the mark sits inside the switch button, whose click
 * switches project and whose double-click renames, and a click on a flag is neither. It is a pointer
 * target only — the list is a roving-tabindex tree whose inner controls are not tab stops
 * (`projects-panel-keyboard.test.ts`) — and the keyboard reaches the same cycle through the project's
 * context menu and the chord (FR-106).
 */
function ListHolderMark({
  mark,
  testId,
  cycleKey,
  projectIds,
  grouped,
  blockAncestorTitle = false,
}: {
  mark: HolderMark;
  testId: string;
  cycleKey: string;
  projectIds: readonly string[];
  grouped: boolean;
  blockAncestorTitle?: boolean;
}): ReactElement {
  const popover = useMarkPopover();
  const layout = useWorkspaceOptional()?.layout ?? null;
  return (
    <>
      <AttentionMark
        mark={mark}
        testId={testId}
        blockAncestorTitle={blockAncestorTitle}
        showCount
        data-clickable="true"
        onClick={(e) => {
          e.stopPropagation();
          goToNextMarkedOf(cycleKey, projectIds, layout);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        {...popover.props}
      />
      {popover.open ? <AttentionPopover anchor={popover.anchor} projectIds={projectIds} grouped={grouped} /> : null}
    </>
  );
}

/**
 * When the popover is open on a list holder (FR-097, FR-098): while the pointer is on the mark, or while
 * the keyboard has the holder's ROW.
 *
 * The keyboard route is the row rather than the mark. The projects list is a roving-tabindex tree whose
 * inner controls are `tabIndex={-1}` by design (`projects-panel-keyboard.test.ts`); a focusable mark
 * would add a tab stop to every marked row and break that. So the popover opens when the enclosing
 * `treeitem` itself takes `:focus-visible` focus — arrow-key navigation lands there, a pointer click's
 * script-focus does not match it — and closes on blur or Escape (WCAG 1.4.13: dismissible).
 */
/** Whether `el` has keyboard (`:focus-visible`) focus. An engine without the selector says yes, rather than leave the keyboard with no route. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

function useMarkPopover(options: { markFocusable?: boolean } = {}): {
  anchor: HTMLElement | null;
  open: boolean;
  props: {
    ref: (el: HTMLSpanElement | null) => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    tabIndex?: number;
    onFocus?: (e: { currentTarget: Element }) => void;
    onBlur?: () => void;
    onKeyDown?: (e: { key: string }) => void;
  };
} {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [rowFocused, setRowFocused] = useState(false);

  useEffect(() => {
    const row = anchor?.closest('[role="treeitem"]') ?? null;
    if (row === null) return;
    const onFocusIn = (e: Event): void => {
      if (e.target === row && focusVisible(row)) setRowFocused(true);
    };
    const onFocusOut = (e: Event): void => {
      if (e.target === row) setRowFocused(false);
    };
    const onKeyDown = (e: Event): void => {
      if ((e as KeyboardEvent).key !== 'Escape') return;
      setRowFocused(false);
      setHovered(false);
    };
    row.addEventListener('focusin', onFocusIn);
    row.addEventListener('focusout', onFocusOut);
    row.addEventListener('keydown', onKeyDown);
    return () => {
      row.removeEventListener('focusin', onFocusIn);
      row.removeEventListener('focusout', onFocusOut);
      row.removeEventListener('keydown', onKeyDown);
    };
  }, [anchor]);

  return {
    anchor,
    open: anchor !== null && (hovered || rowFocused),
    props: {
      ref: setAnchor,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      // The tab strip's overflow marks are not in a tree with a focus-owning row, so the mark itself is
      // the keyboard target there (FR-104): a tab stop, opening on focus, closing on blur or Escape.
      ...(options.markFocusable === true
        ? {
            tabIndex: 0,
            // A click focuses the span too; only the keyboard's focus opens it, or it would stay open.
            onFocus: (e: { currentTarget: Element }) => {
              if (focusVisible(e.currentTarget)) setRowFocused(true);
            },
            onBlur: () => setRowFocused(false),
            onKeyDown: (e: { key: string }) => {
              if (e.key !== 'Escape') return;
              setRowFocused(false);
              setHovered(false);
            },
          }
        : {}),
    },
  };
}

/** A panel's row in a tab's hover popover (FR-010). */
export function PopoverPanelMark({ panelId }: { panelId: string }): ReactElement | null {
  const mark = usePanelMark(panelId);
  return mark === null ? null : <AttentionMark mark={mark} testId={`attention-tab-popover-${panelId}`} />;
}

/** A tab chip, or a row naming a tab in the picker: marked while any of its panels is (FR-010). */
export function TabMark({
  site,
  tabId,
  panelIds,
}: {
  site: 'tab' | 'tab-picker';
  tabId: string;
  panelIds: readonly string[];
}): ReactElement | null {
  const mark = useMarkForPanels(panelIds);
  if (mark !== null) {
    // The chip numbers its flag; a picker row (a list of names, not a holder of panels) does not.
    return <AttentionMark mark={mark} testId={`attention-${site}-${tabId}`} showCount={site === 'tab'} />;
  }
  // A chip holds the flag's slot while unmarked, so marking never changes its width (FR-133).
  return site === 'tab' ? <MarkSlot /> : null;
}

/** The flag's footprint with nothing drawn in it: same size and margin, `visibility: hidden` (FR-133). */
function MarkSlot(): ReactElement {
  return <span className="throng-attention-slot" aria-hidden="true" />;
}

/** A tab strip's left/right overflow control: marked while a tab scrolled out on that side is (FR-011). */
export function OverflowMark({
  side,
  panelIds,
}: {
  side: 'left' | 'right';
  panelIds: readonly string[];
}): ReactElement | null {
  const mark = useMarkForPanels(panelIds);
  return mark === null ? null : <OverflowMarkWithPopover mark={mark} side={side} panelIds={panelIds} />;
}

/**
 * The overflow mark with its popover (FR-104): the marked panels on that side's hidden tabs, as
 * "Tab › Panel" and the reason. No native tooltip, which would compete with it.
 */
function OverflowMarkWithPopover({
  mark,
  side,
  panelIds,
}: {
  mark: HolderMark;
  side: 'left' | 'right';
  panelIds: readonly string[];
}): ReactElement {
  const popover = useMarkPopover({ markFocusable: true });
  return (
    <>
      <AttentionMark mark={mark} testId={`attention-overflow-${side}`} {...popover.props} />
      {popover.open ? <AttentionPopover anchor={popover.anchor} panelIds={panelIds} grouped={false} /> : null}
    </>
  );
}
