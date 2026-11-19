/**
 * A preview panel's status bar (044 FR-015a, FR-015c, FR-015d, FR-015e; contracts/menus-and-controls.md §8).
 *
 * ══ THE EDITOR'S BAR ══
 *
 * The same element and classes as the editor's status strip (`editor/status-strip.tsx`), so the two bars
 * look, dim and theme as one; the panel shows it under the same `editor.showStatusBar` setting.
 *
 * ══ ITS READOUTS (#637, FR-118a – FR-118c, superseding FR-118's "one readout") ══
 *
 * The leading group holds, in the editor strip's order and forms (`preview-readouts.ts`): while text is selected,
 * the source line(s) it spans where the rendered selection maps back, and its character count; then the document's
 * line, character and word counts. They are drawn with the editor's readout class, labels, short forms and announced
 * names, filtered by the same two preferences (`editor.statusBar.showCursorPosition` for the line,
 * `editor.statusBar.showCounts` for the counts), and fitted to the width by the editor's own rules — measured on a
 * hidden ruler (`useStripMeasure`) and decided by `fitReadouts`: every label shortens before anything hides, then
 * `words → chars → lines → selected → line`. The hovered or focused link's target (FR-118) keeps its place after
 * them, unfitted and clipped by the same ellipsis rule as the editor's link readout.
 *
 * ══ THE CONTROLS ══
 *
 * The trailing group holds the scroll-sync toggle (FR-122c) and the preview's route back to its source, in the
 * mirror image of the editor's Open Preview button:
 *
 * | Preview is | Button (token `editorPanel`)          | Click                                         |
 * |------------|---------------------------------------|-----------------------------------------------|
 * | standalone | *Open in Editor*, `aria-pressed=false` | an editor to the preview's left (FR-015c)     |
 * | parented   | *Go to Editor*, `aria-pressed=true`    | the parent, its tab and window focused (FR-015d) |
 *
 * The group is measured whole and subtracted before the readouts are fitted, so width never hides either control.
 * A binary provider has no editor to route to and no text to count (FR-015e), and a bar holding nothing is not
 * drawn: the panel does not render this component for one, and this component renders nothing if asked anyway.
 *
 * Every panel action has a menu item (Principle VI): the route is on the body menu's and the header menu's Navigate
 * section, the toggle is their *Synchronise Scrolling*, and each calls the one function the panel hands in.
 */
import { useRef, type ReactElement } from 'react';
import { FOCUS_MODE_STRIP_CLASS, FocusModeBadge, usePanelInFocusMode } from '../workspace/focus-mode-badge.js';
import type { PreviewProviderKind } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { LinkTargetReadout } from '../common/link-target-readout.js';
import { SyncScrollButton } from './sync-scroll-button.js';
import { BAR_GAP, readoutText, type Readout } from '../editor/status-strip.js';
import { fitReadouts, labelShortens, type LabelForm, type ReadoutId, type SegmentId, type SegmentWidth } from '../editor/status-strip-fit.js';
import { useStripMeasure } from '../editor/status-strip-measure.js';
import type { DocumentMetrics } from '../editor/document-metrics-store.js';
import { previewReadouts, type PreviewSelectionReadout } from './preview-readouts.js';
import '../editor/editor.css';

export interface PreviewStatusBarProps {
  panelId: string;
  /** A binary provider's preview has no route to an editor, and so no bar (FR-015e). */
  providerKind: PreviewProviderKind;
  /** Parented → *Go to Editor*, pressed; standalone → *Open in Editor*. */
  parented: boolean;
  /** The preview's editor route (`runPreviewEditorRoute`), shared with both menus (FR-015b). */
  onEditorRoute: () => void;
  /** 050 R26 — the file moved to another project: the route is unavailable. */
  editorRouteDisabled?: boolean;
  /** FR-122c — `editor.previews.syncScroll` as the window holds it, shown as the toggle's pressed state. */
  syncScroll: boolean;
  /** FR-122 — the toggle's click: the panel's `toggleSyncScroll` call, shared with its body menu row. */
  onToggleSyncScroll: () => void;
  /** 054 — `false` for a provider that draws one picture (Mermaid): no scroll-sync toggle. Absent reads `true`. */
  showSyncScroll?: boolean;
  /**
   * 073 FR-036b — a provider whose grid edits long cells in a dialog: whether that is on for THIS panel, and the
   * toggle's click. Absent for every other provider, which draws no such control.
   */
  cellDialog?: { on: boolean; onToggle: () => void };
  /** 073 FR-013 — a provider whose grid wraps its cells: whether wrapping is on for THIS panel, and the toggle's click. */
  wrap?: { on: boolean; onToggle: () => void };
  /** 073 FR-039a — a provider whose grid locks its first row / column: whether each is on for THIS panel, and the toggle's click. */
  lockFirstRow?: { on: boolean; onToggle: () => void };
  lockFirstColumn?: { on: boolean; onToggle: () => void };
  /** FR-118 — the hovered or focused link's target; omitted, `null` or empty shows nothing. */
  readout?: string | null;
  /** FR-118a — the drawn document's counts, or `null` until they settle (no counts are drawn). */
  metrics?: DocumentMetrics | null;
  /** FR-118b — the selection's readouts, or `null` with nothing selected. */
  selection?: PreviewSelectionReadout | null;
  /** The editor's two readout preferences (040 FR-030, FR-031). Absent reads both on. */
  readoutPrefs?: { showCursorPosition: boolean; showCounts: boolean };
}

/** A readout's string at `form` — the line is always drawn alone here, so it ends in a full stop (067 FR-134). */
function textAt(r: Readout, form: LabelForm): string {
  return r.id === 'line' ? readoutText('line', r.figure, form, { comma: false }) : readoutText(r.id, r.figure, form);
}

const ALL_ON = { showCursorPosition: true, showCounts: true };

/** The cell dialog toggle's name: the setting's own label, so the control and the Preferences row read alike. */
const CELL_DIALOG_LABEL = 'Edit long cells in a dialog';
/** The Wrap toggle's name (FR-013). */
const WRAP_LABEL = 'Wrap cells';
/** The two lock toggles' names (FR-039a). */
const LOCK_ROW_LABEL = 'Lock first row';
const LOCK_COLUMN_LABEL = 'Lock first column';

export function PreviewStatusBar({
  panelId,
  providerKind,
  parented,
  onEditorRoute,
  editorRouteDisabled = false,
  syncScroll,
  onToggleSyncScroll,
  showSyncScroll = true,
  cellDialog,
  wrap,
  lockFirstRow,
  lockFirstColumn,
  readout,
  metrics = null,
  selection = null,
  readoutPrefs = ALL_ON,
}: PreviewStatusBarProps): ReactElement | null {
  // 054 FR-078 — Focus Mode is shown on the maximised panel's own strip. Every hook before the early return.
  const focusMode = usePanelInFocusMode(panelId);
  const barRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const measured = useStripMeasure(barRef, controlsRef, rulerRef);
  if (providerKind !== 'text') return null;

  // The preferences filter BEFORE the fit and the ruler: a readout switched off reserves no width (040 FR-014) and is
  // absent from the accessibility tree rather than hidden in it (FR-017).
  const wanted = (id: ReadoutId): boolean => (id === 'line' ? readoutPrefs.showCursorPosition : readoutPrefs.showCounts);
  const present = previewReadouts(selection, metrics).filter((r) => wanted(r.id));
  const fit = fitReadouts({
    available: measured.barWidth - measured.controls - BAR_GAP,
    widths: Object.fromEntries(
      present.filter((r) => measured.widths[r.id]).map((r) => [r.id, measured.widths[r.id]]),
    ) as Partial<Record<SegmentId, SegmentWidth>>,
    gap: BAR_GAP,
  });
  const forms = new Map(fit.segments.map((s) => [s.id, s.label]));
  const readouts = previewReadouts(selection, metrics, Object.fromEntries(forms) as Partial<Record<ReadoutId, LabelForm>>).filter(
    (r) => forms.has(r.id) && wanted(r.id),
  );

  const title = parented ? 'Go to Editor' : 'Open in Editor';
  return (
    <div
      className={`editor-status-strip preview-status-bar${focusMode ? ` ${FOCUS_MODE_STRIP_CLASS}` : ''}`}
      data-testid={`preview-status-bar-${panelId}`}
      ref={barRef}
    >
      <FocusModeBadge panelId={panelId} active={focusMode} />
      {/* The leading group keeps the controls trailing under the strip's `space-between`, where the editor's own
          bar draws its controls. */}
      <div className="editor-status-strip__group editor-status-strip__group--readouts">
        {readouts.map((r) => (
          <span
            key={r.id}
            className="editor-status-strip__readout"
            data-testid={`preview-status-${r.id}-${panelId}`}
            data-readout={r.id}
            data-label={forms.get(r.id) ?? 'full'}
            // Announced by its full name (040 FR-015), and never a live region (FR-016): it changes with every
            // selection move, and announcing each one would interrupt the reader.
            aria-label={r.accessibleName}
          >
            {r.text}
          </span>
        ))}
        {/* FR-118 — after the persistent readouts, so it never displaces them; unfitted, clipped by the ellipsis
            rule (`preview.css`), as the editor's link readout is. */}
        <LinkTargetReadout testId={`preview-status-readout-${panelId}`} target={readout} />
      </div>
      <div
        className="editor-status-strip__group editor-status-strip__group--controls"
        data-testid={`preview-status-controls-${panelId}`}
        // Measured whole: the readouts get whatever the controls do not take, so width never hides a control.
        ref={controlsRef}
      >
        {/* FR-122c — the scroll-sync toggle, immediately before the route, on every flowing text preview. */}
        {showSyncScroll ? (
          <SyncScrollButton testId={`preview-sync-scroll-${panelId}`} on={syncScroll} onToggle={onToggleSyncScroll} />
        ) : null}
        <IconButton
          token="editorPanel"
          className="editor-status-strip__preview"
          testId={`preview-editor-${panelId}`}
          title={title}
          ariaPressed={parented}
          disabled={editorRouteDisabled}
          onClick={onEditorRoute}
        />
        {/* 073 FR-036b — the cell dialog's per-panel switch, at the trailing end: pressed while the dialog is on
            for this panel. Present only for a provider that declares one. An accelerator over the header
            menu's checked *Edit Long Cells in Dialog* item (Principle VI). */}
        {/* 073 FR-013 — the grid's Wrap switch: pressed while this panel wraps its cells. An accelerator over the
            header menu's checked *Wrap* item (Principle VI). */}
        {/* 073 FR-039a — the grid's two lock switches, beside Wrap: pressed while the first row / column is locked for this
            panel. Accelerators over the header menu's checked *Lock First Row* / *Lock First Column* items (Principle VI). */}
        {lockFirstRow !== undefined ? (
          <IconButton
            token="lockFirstRow"
            className="editor-status-strip__preview"
            testId={`preview-lock-row-${panelId}`}
            title={LOCK_ROW_LABEL}
            ariaLabel={LOCK_ROW_LABEL}
            ariaPressed={lockFirstRow.on}
            onClick={lockFirstRow.onToggle}
          />
        ) : null}
        {lockFirstColumn !== undefined ? (
          <IconButton
            token="lockFirstColumn"
            className="editor-status-strip__preview"
            testId={`preview-lock-column-${panelId}`}
            title={LOCK_COLUMN_LABEL}
            ariaLabel={LOCK_COLUMN_LABEL}
            ariaPressed={lockFirstColumn.on}
            onClick={lockFirstColumn.onToggle}
          />
        ) : null}
        {wrap !== undefined ? (
          <IconButton
            token="wrapCells"
            className="editor-status-strip__preview"
            testId={`preview-wrap-${panelId}`}
            title={WRAP_LABEL}
            ariaLabel={WRAP_LABEL}
            ariaPressed={wrap.on}
            onClick={wrap.onToggle}
          />
        ) : null}
        {cellDialog !== undefined ? (
          <IconButton
            token="cellDialog"
            className="editor-status-strip__preview"
            testId={`preview-cell-dialog-${panelId}`}
            title={CELL_DIALOG_LABEL}
            ariaLabel={CELL_DIALOG_LABEL}
            ariaPressed={cellDialog.on}
            onClick={cellDialog.onToggle}
          />
        ) : null}
      </div>
      {/* The ruler (040 FR-021, FR-022a): every present readout in each label form it has, drawn where it can be
          measured and nowhere it can be seen or heard — so the fit is decided in one pass. */}
      <div className="editor-status-strip__ruler" aria-hidden="true" ref={rulerRef}>
        {present.flatMap((r) =>
          (labelShortens(r.id) ? (['full', 'short'] as const) : (['full'] as const)).map((form) => (
            <span key={`${r.id}:${form}`} className="editor-status-strip__readout" data-measure={`${r.id}:${form}`}>
              {textAt(r, form)}
            </span>
          )),
        )}
      </div>
    </div>
  );
}
