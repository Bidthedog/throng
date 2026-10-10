/**
 * 054 FR-070, FR-071, FR-074 — the maximise layer of one tab: where a SECTION target is drawn, and the
 * one Esc listener that steps a maximised tab back a level.
 *
 * Mounted inside `.tab-body`, after the split tree. A section target (a diagram's Full Pane, FR-046f)
 * registered its `render` with the maximise store; the layer draws the section on top of the stack over
 * the whole tab body — which, when the section is nested over a maximised panel, is exactly that panel's
 * area too. The section's own state lives in the component that registered it, above this, so moving it
 * here loses nothing (research R7). A whole-panel target is not drawn here at all: it stays in place in
 * the split tree, and `.tab-body[data-maximised]` lifts it.
 *
 * Esc restores ONE level (FR-074 nesting: diagram → maximised panel → layout), and only when nothing
 * else on screen uses it (contracts "Esc"): not from inside a terminal or an editor, which use Esc
 * themselves, and not while a find bar, a transient overlay, a menu or a dialog is open — each of those
 * closes on Esc, and one press must never do two things.
 */
import { useEffect, type ReactElement } from 'react';
import { transientOverlayOpen } from '../common/transient-overlay.js';
import { isTabGroupDragLive } from './drag-live.js';
import { restore, useTabMaximise } from './maximise-store.js';

/** An element a user types into: it uses Esc to cancel its own edit. */
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Whether something other than the maximise layer owns an Escape pressed now. */
function escapeBelongsElsewhere(): boolean {
  // A tab or panel drag is live: 048 FR-080 cancels it with this key, and must see it first.
  if (isTabGroupDragLive()) return true;
  const focused = document.activeElement;
  if (focused?.closest?.('.xterm, .cm-editor')) return true;
  // An inline editor outside the maximised target (an explorer / tab / project rename) or a focused
  // notice cancels or dismisses itself on Esc; the step back must not eat that press.
  if (focused?.closest?.('.notices')) return true;
  if (focused?.matches?.(EDITABLE) && !focused.closest('.maximise-layer, [data-maximised="true"]')) return true;
  if (transientOverlayOpen()) return true;
  // A find bar, menu or dialog inside a hidden (inert) panel cannot take Esc, so it does not count.
  for (const el of document.querySelectorAll('.find-bar, [role="menu"], [role="dialog"], [aria-modal="true"]')) {
    if (!el.closest('[inert]')) return true;
  }
  return false;
}

export function MaximiseLayer({ tabId }: { tabId: string }): ReactElement | null {
  const { isMaximised, topSection } = useTabMaximise(tabId);

  useEffect(() => {
    if (!isMaximised) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey || e.defaultPrevented) return;
      if (escapeBelongsElsewhere()) return;
      e.preventDefault();
      e.stopPropagation();
      restore(tabId);
    };
    // Capture phase, so the step back is taken before anything under the layer sees the key.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [tabId, isMaximised]);

  if (!topSection) return null;
  return (
    <div
      className="maximise-layer"
      data-testid="maximise-layer"
      data-panel-id={topSection.panelId}
      data-section-id={topSection.sectionId}
    >
      {topSection.render()}
    </div>
  );
}
