/**
 * Search & scrollback key dispatch (013, FR-020).
 *
 * The commands are scoped to the ACTIVE panel and its TYPE, exactly as `editor.*` is:
 * gate on the workspace pane being active, resolve the active tab's active panel (012),
 * then route to that panel's registered search controller. A terminal-only command is
 * inert in an editor and vice versa — the routing, not a mode flag, is what scopes them.
 *
 * Consuming these keys here is also what keeps them OUT of a terminal's shell: the
 * handler calls preventDefault, so find and scrollback navigation never reach the pty
 * (FR-010 / FR-014).
 */
import { useEffect } from 'react';
import {
  collectPanels,
  effectiveActivePanelId,
  resolveAction,
  type ActionId,
  type Panel,
} from '@throng/core';
import { scopeFromKind } from '../keybindings/scope.js';
import { useKeybindings } from '../config/config-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { getActivePane } from '../workspace/active-pane.js';
import { getPanelSearch } from './search-controller.js';
import {
  closeFind,
  closeFindIfNotOn,
  findNext,
  findPrevious,
  getFindState,
  openFind,
  replaceAll,
  replaceCurrent,
  openFind as openFindOn,
} from './search-store.js';

/** Only these actions are ours; every other chord falls through untouched. */
const HANDLED = new Set<ActionId>([
  'search.find',
  'search.findNext',
  'search.findPrevious',
  'search.close',
  'search.replace',
  'search.replaceCurrent',
  'search.replaceAll',
  'terminal.scrollLineUp',
  'terminal.scrollLineDown',
  'terminal.scrollPageUp',
  'terminal.scrollPageDown',
  'terminal.scrollToTop',
  'terminal.scrollToBottom',
]);

export function SearchKeybindings(): null {
  const keybindings = useKeybindings();
  const { layout } = useWorkspace();

  const tab = layout?.tabs.find((t) => t.id === layout.activeTabId);
  const activePanelId = tab ? (effectiveActivePanelId(tab) ?? null) : null;
  const activePanel: Panel | undefined = tab
    ? collectPanels(tab.root).find((p) => p.id === activePanelId)
    : undefined;
  const activeKind = activePanel?.kind;

  // A bar left open on a panel that is no longer active would act on the wrong panel,
  // so moving focus elsewhere closes it (spec Edge Cases).
  useEffect(() => {
    closeFindIfNotOn(activePanelId);
  }, [activePanelId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // This component has already resolved which panel is active, so it maps that KIND straight
      // to a scope rather than resolving it a second time. The find bar's own commands are never
      // suppressed by the focus guard — Escape must close it and Enter must find next, from
      // inside the bar (FR-017f protects the DOCUMENT from the bar, not the bar from itself).
      const action = resolveAction(
        keybindings,
        { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey },
        scopeFromKind(activeKind),
      );
      if (!action || !HANDLED.has(action)) return;
      // Panel commands only apply while the workspace (not the file tree) is active.
      if (getActivePane() !== 'workspace') return;
      if (!activePanelId || (activeKind !== 'editor' && activeKind !== 'terminal')) return;

      const controller = getPanelSearch(activePanelId);
      if (!controller) return;

      const findOpen = getFindState().panelId === activePanelId;

      switch (action) {
        case 'search.find':
          e.preventDefault();
          openFind(activePanelId, activeKind);
          return;

        case 'search.replace':
          // Replace is an editor affordance; on a terminal the chord is inert.
          if (activeKind !== 'editor') return;
          e.preventDefault();
          openFindOn(activePanelId, activeKind, { replace: true });
          return;

        // The remaining commands act on a live session only — with no bar open they
        // are not ours to swallow (Escape especially must stay available elsewhere).
        case 'search.close':
          if (!findOpen) return;
          e.preventDefault();
          closeFind();
          return;

        case 'search.findNext':
          if (!findOpen) return;
          e.preventDefault();
          findNext();
          return;

        case 'search.findPrevious':
          if (!findOpen) return;
          e.preventDefault();
          findPrevious();
          return;

        case 'search.replaceCurrent':
          if (!findOpen || activeKind !== 'editor') return;
          e.preventDefault();
          replaceCurrent();
          return;

        case 'search.replaceAll':
          if (!findOpen || activeKind !== 'editor') return;
          e.preventDefault();
          replaceAll();
          return;

        default:
          break;
      }

      // Scrollback navigation — terminal only, and never delivered to the program.
      if (controller.panelKind !== 'terminal') return;
      e.preventDefault();
      switch (action) {
        case 'terminal.scrollLineUp':
          controller.scrollLines(-1);
          break;
        case 'terminal.scrollLineDown':
          controller.scrollLines(1);
          break;
        case 'terminal.scrollPageUp':
          controller.scrollPages(-1);
          break;
        case 'terminal.scrollPageDown':
          controller.scrollPages(1);
          break;
        case 'terminal.scrollToTop':
          controller.scrollToTop();
          break;
        case 'terminal.scrollToBottom':
          controller.scrollToLiveBottom();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keybindings, activePanelId, activeKind]);

  return null;
}
