import { useEffect, useState, type ReactElement } from 'react';
import './modal-blocker.css';

/**
 * The window beneath a modal Print Preview, on Linux (075 FR-071; maintainer, 2026-11-22).
 *
 * A natively modal child disables its parent, and on Wayland a disabled window never sets its cursor when the
 * pointer enters it: the resize cursor from the preview's edge stayed on screen over the whole parent. So on Linux
 * main keeps the parent enabled and says when a modal window is open; this layer then covers the window, taking
 * every click and wheel with the ordinary arrow cursor, and main hands focus straight back to the modal window.
 * Elsewhere the platform's own modality is used and this never shows.
 */
export function ModalBlocker(): ReactElement | null {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => window.throng?.window?.onModalBlock?.((on) => setBlocked(on)), []);
  if (!blocked) return null;
  const swallow = (e: { preventDefault(): void; stopPropagation(): void }): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      className="modal-blocker"
      data-testid="modal-blocker"
      aria-hidden="true"
      onMouseDown={swallow}
      onClick={swallow}
      onDoubleClick={swallow}
      onContextMenu={swallow}
      onWheel={(e) => e.stopPropagation()}
    />
  );
}
