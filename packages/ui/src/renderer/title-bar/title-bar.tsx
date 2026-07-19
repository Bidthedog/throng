import { type ReactElement } from 'react';
import { WindowControls } from './window-controls.js';
import { CogMenu } from './cog-menu.js';
import { ThrongMark } from './throng-mark.js';
import './title-bar.css';

/**
 * The application-drawn full-width title bar (007, FR-001/003/004/006). Replaces
 * the OS chrome: it carries the brand mark + window-identity (left), an extensible action area
 * (currently the cog — main window only), and the window controls (right). The
 * empty area is the OS drag handle (`-webkit-app-region: drag`, title-bar.css);
 * double-clicking it toggles maximise/restore (FR-004). Sub-workspace windows use
 * the same bar with `showCog={false}` (FR-007).
 */
export interface TitleBarProps {
  /** Window-identity text: `throng — <project · context>` or a sub-workspace name. */
  identity: string;
  /** Dominant colour accent (active project / sub-workspace), shown as a dot. */
  colour?: string;
  /** Render the cog action + preferences entry point — main window only (FR-005/007). */
  showCog?: boolean;
  /** Render only the close control (no minimise/maximise) — fixed-size dialogs (020, FR-003). */
  closeOnly?: boolean;
}

export function TitleBar({
  identity,
  colour,
  showCog = false,
  closeOnly = false,
}: TitleBarProps): ReactElement {
  // A fixed-size dialog has nothing to maximise; double-clicking its bar must be inert.
  const onDoubleClick = (): void => {
    if (!closeOnly) window.throng?.window?.maximize?.();
  };

  return (
    <header className="title-bar" data-testid="title-bar">
      <div className="title-bar__drag-zone" onDoubleClick={onDoubleClick}>
        <div className="title-bar__identity" data-testid="title-bar-identity">
          <ThrongMark />
          {colour ? (
            <span className="title-bar__dot" style={{ background: colour }} aria-hidden />
          ) : null}
          <span className="title-bar__identity-text">{identity}</span>
        </div>
      </div>
      <div className="title-bar__actions">
        {showCog ? <CogMenu /> : null}
        <WindowControls closeOnly={closeOnly} />
      </div>
    </header>
  );
}
