/**
 * Save and Save As in an editor panel's title bar (067 FR-069 to FR-074).
 *
 * Two themeable icon controls at the head of the panel's action group, then a separator, then the common
 * panel icons the caller draws. They are accelerators over the panel menu's Save and Save As: each runs
 * the same editor action the chord and the menu item run (`getEditorActions`), so there is no second
 * save path (FR-071), and each is disabled exactly when its menu item is, with the reason in the tooltip
 * (FR-073).
 *
 * ══ NARROW HEADERS (FR-069a) ══
 *
 * Save As hides first, then Save together with the separator, and widening restores them. The width is
 * the header's own, measured with a ResizeObserver; before it has been measured everything shows, so a
 * header that never reports a width (a test, a first paint) is not left without its controls. Both
 * actions stay on the panel menu and on their chords whatever the width.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { firstBinding, type Keybindings } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { chordTitled } from '../navigation/back-forward-buttons.js';
import { getEditorActions } from '../editor/editor-actions.js';

/** Below this header width Save As is hidden. */
export const SAVE_AS_MIN_HEADER_WIDTH = 360;
/** Below this header width Save and the separator are hidden too. */
export const SAVE_MIN_HEADER_WIDTH = 280;

export interface SaveIconsFit {
  save: boolean;
  saveAs: boolean;
  separator: boolean;
}

/** Which of the controls fit a header `width` pixels wide. `0` means "not measured yet": all of them. */
export function saveIconsFit(width: number): SaveIconsFit {
  if (width <= 0) return { save: true, saveAs: true, separator: true };
  const saveAs = width >= SAVE_AS_MIN_HEADER_WIDTH;
  const save = width >= SAVE_MIN_HEADER_WIDTH;
  return { save, saveAs, separator: save };
}

/** The width of the title bar this element sits in, kept current while it is mounted. */
function useHeaderWidth(anchor: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const header = anchor.current?.closest<HTMLElement>('.panel-box__header');
    if (!header || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const w = entries.find((e) => e.target === header)?.contentRect.width ?? entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.floor(w));
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, [anchor]);
  return width;
}

const stopDrag = (e: ReactPointerEvent): void => {
  // The header is the panel's drag handle (4 px activation): pressing a button must not start a move.
  e.stopPropagation();
};

export function PanelHeaderSaveIcons({
  panelId,
  keybindings,
  movedOut,
}: {
  panelId: string;
  keybindings: Keybindings;
  /** 050 FR-036 — the file moved to another project: Save is refused, Save As stays. */
  movedOut: boolean;
}): ReactElement {
  const anchor = useRef<HTMLSpanElement>(null);
  const width = useHeaderWidth(anchor);
  const fit = saveIconsFit(width);

  const saveTitle = chordTitled('Save', firstBinding(keybindings, 'editor.save'));
  const saveAsTitle = chordTitled('Save As', firstBinding(keybindings, 'editor.saveAs'));

  return (
    <>
      {/* A zero-size anchor so the hook can find the header whichever controls are currently drawn. */}
      <span ref={anchor} hidden aria-hidden="true" />
      {fit.save ? (
        <IconButton
          token="save"
          title={
            movedOut
              ? `${saveTitle} is unavailable: this file moved to another project. Use Save As.`
              : saveTitle
          }
          disabled={movedOut}
          className=""
          testId={`panel-save-${panelId}`}
          onPointerDown={stopDrag}
          onClick={() => void getEditorActions(panelId)?.save()}
        />
      ) : null}
      {fit.saveAs ? (
        <IconButton
          token="saveAs"
          title={saveAsTitle}
          className=""
          testId={`panel-save-as-${panelId}`}
          onPointerDown={stopDrag}
          onClick={() => void getEditorActions(panelId)?.saveAs()}
        />
      ) : null}
      {fit.separator ? (
        <span
          className="panel-box__actions-separator"
          role="separator"
          aria-orientation="vertical"
          data-testid={`panel-save-separator-${panelId}`}
        />
      ) : null}
    </>
  );
}
