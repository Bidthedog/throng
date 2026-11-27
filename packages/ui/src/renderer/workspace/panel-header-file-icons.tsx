/**
 * Open in OS Default Program and Find in File Explorer in an editor's or preview's title bar (081 FR-040 – FR-043).
 *
 * Two themeable icon controls at the head of the panel's action group, then the separator Save and Save As use.
 * They are accelerators over the panel menu's rows of the same names: the caller hands in the handlers the menu
 * rows run, so there is no second code path (FR-041), and `panelFileActionState` decides for both whether they
 * can act and what the hover says when they cannot. The default-program button follows
 * `explorer.showOpenInOsDefaultProgram`, as its row does.
 *
 * They give way first on a narrow header, before Save As (FR-043; the step is `panel-header-fit.ts`'s). Both actions
 * stay on the panel menu at every width.
 */
import { useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { IconButton } from '../common/icon-button.js';
import { headerControlsFit, useHeaderWidth } from './panel-header-fit.js';
import {
  FIND_IN_FILE_EXPLORER_LABEL,
  OPEN_IN_DEFAULT_PROGRAM_LABEL,
  type PanelFileActionState,
} from './panel-header-menu.js';

const stopDrag = (e: ReactPointerEvent): void => {
  // The header is the panel's drag handle (4 px activation): pressing a button must not start a move.
  e.stopPropagation();
};

export function PanelHeaderFileIcons({
  panelId,
  state,
  showOpenInDefaultProgram,
  onOpenInDefaultProgram,
  onFindInFileExplorer,
}: {
  panelId: string;
  state: PanelFileActionState;
  showOpenInDefaultProgram: boolean;
  /** The panel menu's Open in OS Default Program action. */
  onOpenInDefaultProgram: () => void;
  /** The panel menu's Find in File Explorer action. */
  onFindInFileExplorer: () => void;
}): ReactElement {
  const anchor = useRef<HTMLSpanElement>(null);
  const width = useHeaderWidth(anchor);
  const shown = headerControlsFit(width).fileIcons;

  return (
    <>
      {/* A zero-size anchor so the hook can find the header whichever controls are currently drawn. */}
      <span ref={anchor} hidden aria-hidden="true" />
      {shown && showOpenInDefaultProgram ? (
        <IconButton
          token="openInDefaultProgram"
          title={state.titleFor(OPEN_IN_DEFAULT_PROGRAM_LABEL)}
          disabled={state.disabled}
          className=""
          testId={`panel-open-default-${panelId}`}
          onPointerDown={stopDrag}
          onClick={onOpenInDefaultProgram}
        />
      ) : null}
      {shown ? (
        <IconButton
          token="findInFileExplorer"
          title={state.titleFor(FIND_IN_FILE_EXPLORER_LABEL)}
          disabled={state.disabled}
          className=""
          testId={`panel-find-in-explorer-${panelId}`}
          onPointerDown={stopDrag}
          onClick={onFindInFileExplorer}
        />
      ) : null}
      {shown ? (
        <span
          className="panel-box__actions-separator"
          role="separator"
          aria-orientation="vertical"
          data-testid={`panel-file-separator-${panelId}`}
        />
      ) : null}
    </>
  );
}
