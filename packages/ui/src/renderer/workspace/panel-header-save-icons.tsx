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
 * actions stay on the panel menu and on their chords whatever the width. The steps, and the rest of the
 * header's (FR-069b), are `panel-header-fit.ts`'s.
 */
import { useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { firstBinding, type Keybindings } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { chordTitled } from '../navigation/back-forward-buttons.js';
import { getEditorActions } from '../editor/editor-actions.js';
import { headerControlsFit, useHeaderWidth } from './panel-header-fit.js';

export { SAVE_AS_MIN_HEADER_WIDTH, SAVE_MIN_HEADER_WIDTH } from './panel-header-fit.js';

export interface SaveIconsFit {
  save: boolean;
  saveAs: boolean;
  separator: boolean;
}

/** Which of the controls fit a header `width` pixels wide. `0` means "not measured yet": all of them. */
export function saveIconsFit(width: number): SaveIconsFit {
  const { save, saveAs, separator } = headerControlsFit(width);
  return { save, saveAs, separator };
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
