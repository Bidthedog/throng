/**
 * A preview panel's status bar (044 FR-015a, FR-015c, FR-015d, FR-015e; contracts/menus-and-controls.md §8).
 *
 * ══ THE EDITOR'S BAR, WITH ONE CONTROL ══
 *
 * The same element and classes as the editor's status strip (`editor/status-strip.tsx`), so the two bars
 * look, dim and theme as one; the panel shows it under the same `editor.showStatusBar` setting. A rendered
 * document has no caret to report, so its leading group holds ONE readout only (iteration 2026-09-15, FR-118,
 * superseding FR-015a's "no readouts" for it alone): the full target of the link under the pointer or holding
 * keyboard focus, and nothing otherwise. The group also keeps the one control trailing, exactly where the
 * editor's Open Preview button sits.
 *
 * That control is the preview's route back to its source, in the mirror image of the editor's button:
 *
 * | Preview is | Button (token `editorPanel`)          | Click                                         |
 * |------------|---------------------------------------|-----------------------------------------------|
 * | standalone | *Open in Editor*, `aria-pressed=false` | an editor to the preview's left (FR-015c)     |
 * | parented   | *Go to Editor*, `aria-pressed=true`    | the parent, its tab and window focused (FR-015d) |
 *
 * It sits in the controls group, which is never fitted against anything, so width never hides it. A
 * binary provider has no editor to route to (FR-015e), and a bar holding nothing is not drawn: the panel
 * does not render this component for one, and this component renders nothing if asked anyway.
 *
 * Every panel action has a menu item (Principle VI): the same route is on the body menu's and the header
 * menu's Navigate section, and all three call the one function the panel hands in.
 *
 * ══ AND THE SCROLL-SYNC TOGGLE (iteration 2026-09-16, FR-122c) ══
 *
 * Partly superseding "one control": the controls group now opens with the scroll-sync toggle
 * (`SyncScrollButton`, token `syncScroll`, pressed while `editor.previews.syncScroll` is on), immediately
 * before the route button, standalone and parented alike. It is never disabled and lives in the same
 * measured group, so neither width nor the readout hides it; only the whole bar going does. Its menu items
 * are the body and header menus' *Synchronise Scrolling*.
 */
import type { ReactElement } from 'react';
import type { PreviewProviderKind } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { SyncScrollButton } from './sync-scroll-button.js';
import '../editor/editor.css';

export interface PreviewStatusBarProps {
  panelId: string;
  /** A binary provider's preview has no route to an editor, and so no bar (FR-015e). */
  providerKind: PreviewProviderKind;
  /** Parented → *Go to Editor*, pressed; standalone → *Open in Editor*. */
  parented: boolean;
  /** The preview's editor route (`runPreviewEditorRoute`), shared with both menus (FR-015b). */
  onEditorRoute: () => void;
  /** FR-122c — `editor.previews.syncScroll` as the window holds it, shown as the toggle's pressed state. */
  syncScroll: boolean;
  /** FR-122 — the toggle's click: the panel's `toggleSyncScroll` call, shared with its body menu row. */
  onToggleSyncScroll: () => void;
  /** FR-118 — the hovered or focused link's target; omitted, `null` or empty shows nothing. */
  readout?: string | null;
}

export function PreviewStatusBar({
  panelId,
  providerKind,
  parented,
  onEditorRoute,
  syncScroll,
  onToggleSyncScroll,
  readout,
}: PreviewStatusBarProps): ReactElement | null {
  if (providerKind !== 'text') return null;
  const title = parented ? 'Go to Editor' : 'Open in Editor';
  return (
    <div className="editor-status-strip preview-status-bar" data-testid={`preview-status-bar-${panelId}`}>
      {/* The leading group keeps the control trailing under the strip's `space-between`, where the editor's own
          bar draws its controls. Its one readout (FR-118) is clipped with an ellipsis (`preview.css`); the
          controls group is measured whole, so the button is never hidden by it. */}
      <div className="editor-status-strip__group editor-status-strip__group--readouts">
        {readout ? (
          <span
            className="editor-status-strip__readout preview-status-bar__readout"
            data-testid={`preview-status-readout-${panelId}`}
          >
            {readout}
          </span>
        ) : null}
      </div>
      <div
        className="editor-status-strip__group editor-status-strip__group--controls"
        data-testid={`preview-status-controls-${panelId}`}
      >
        {/* FR-122c — the scroll-sync toggle, immediately before the route, on every text preview. */}
        <SyncScrollButton testId={`preview-sync-scroll-${panelId}`} on={syncScroll} onToggle={onToggleSyncScroll} />
        <IconButton
          token="editorPanel"
          className="editor-status-strip__preview"
          testId={`preview-editor-${panelId}`}
          title={title}
          ariaPressed={parented}
          onClick={onEditorRoute}
        />
      </div>
    </div>
  );
}
