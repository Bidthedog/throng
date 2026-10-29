/**
 * A small "?" beside something that needs a sentence or two of explanation (055 FR-119): Order by, Hide
 * idle, Hide ended, the capture interval, Held folders, the Total row and the "-" / "~" markers. Its words
 * are `helper-copy.ts`'s, the same table the help panel draws from.
 *
 * It is a themeable icon control (the existing `help` token, small): a hover title and an accessible name,
 * no text label. It opens on click, Enter or Space; it closes on Esc, a second click or a click elsewhere
 * [derived]. Opening one closes another, because pressing the second is "elsewhere".
 *
 * ══ A FLOATING SURFACE ══
 *
 * Portaled to the body (Held folders and the list scroll and clip), placed by `useAnchoredPosition`, and
 * held `visibility: hidden` until placed. It is registered in `unit/floating-surfaces.test.ts`. Esc is
 * handled in the capture phase and stopped, so the window's own Esc — which closes the window — never sees it.
 */
import { useEffect, useId, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../common/icon-button.js';
import { useAnchoredPosition } from '../common/use-anchored-position.js';
import { HELPER_COPY, type HelperTopic } from './helper-copy.js';

function HelperPopover({ anchor, id, text, onClose }: { anchor: HTMLButtonElement; id: string; text: string; onClose: (returnFocus: boolean) => void }): ReactElement {
  const { ref, pos } = useAnchoredPosition<HTMLDivElement>(anchor, text);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // Handled: the window's Esc (which closes the window) skips an event that is already handled.
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    };
    const onDown = (e: PointerEvent): void => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      // The helper's own press toggles; anything else is "elsewhere".
      if (anchor.contains(target) || ref.current?.contains(target) === true) return;
      onClose(false);
    };
    // It is placed once, from the helper's rect then: when anything it could sit in scrolls (scroll does not
    // bubble, hence capture) or the window resizes, it would hang where the helper no longer is. Close it.
    const onMove = (e: Event): void => {
      if (e.target instanceof Node && ref.current?.contains(e.target) === true) return;
      onClose(false);
    };
    // A press in another throng window blurs this one; a hidden page has nothing to explain.
    const onLeave = (): void => onClose(false);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') onClose(false);
    };
    // The title bar is a drag region: the OS takes a press there and the page sees nothing, and it does not
    // blur the window. While a helper is open the window says so, and title-bar.css gives the region up.
    document.documentElement.setAttribute('data-helper-open', '');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('blur', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.documentElement.removeAttribute('data-helper-open');
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [anchor, onClose, ref]);

  return createPortal(
    <div
      ref={ref}
      id={id}
      className="info-helper-popover"
      data-testid="info-helper-popover"
      role="note"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {text}
    </div>,
    document.body,
  );
}

export function InfoHelper({ topic }: { topic: HelperTopic }): ReactElement {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const id = useId();
  const copy = HELPER_COPY[topic];

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) anchor?.focus();
  };

  return (
    <>
      <IconButton
        token="help"
        title={copy.title}
        testId={`info-helper-${topic}`}
        className="icon-button info-helper"
        noTitle
        ariaExpanded={open}
        ariaDescribedBy={open ? id : undefined}
        nodeRef={setAnchor}
        onClick={() => setOpen((o) => !o)}
      />
      {open && anchor !== null ? <HelperPopover anchor={anchor} id={id} text={copy.text} onClose={close} /> : null}
    </>
  );
}
