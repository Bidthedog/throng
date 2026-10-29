/**
 * The monitor's help (055 FR-093, FR-119): the "?" button and the panel it opens — a short disclaimer (the
 * figures are representative of how throng's parts compare, not exact) and a line or two each on the
 * toolbar, the filter, the left column, the right column and the hierarchy. Anything that needs more has a
 * small "?" helper of its own (`info-helper.tsx`); every word is in one table (`helper-copy.ts`).
 *
 * ══ THE APP'S POPOVER STYLE ══
 *
 * The panel wears the surface `.attention-popover` defines — one rule in the stylesheet shared by the
 * status-bar popover, the helpers and this — rather than a look of its own. (It used to carry a glow.)
 *
 * ══ A FLOATING SURFACE, ON THE SHARED RULES ══
 *
 * The panel hangs under its button and uses `clampToViewport` — the positioner the context menu, the
 * colour picker and the tab popover share — measured in a layout effect and held `visibility: hidden`
 * until placed, so it never paints in the wrong place first. It is registered in
 * `unit/floating-surfaces.test.ts` as the guard requires.
 *
 * ══ FOCUS ══
 *
 * Opening moves focus into the panel; closing from the keyboard (Esc) or by pressing the button again puts
 * it back on the button. Closing by a click elsewhere leaves focus where that click put it — the user
 * went somewhere on purpose. Esc is HANDLED here (default prevented), so the window's own Esc, which
 * closes the window, leaves it alone (`monitor-app.tsx`).
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type RefObject } from 'react';
import { clampToViewport } from '../common/clamp-to-viewport.js';
import { IconButton } from '../common/icon-button.js';
import { HELP_DISCLAIMER, HELP_SECTIONS } from './helper-copy.js';

/** The gap between the button and the panel hanging from it. */
const GAP = 6;

export interface HelpButtonProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly nodeRef: (element: HTMLButtonElement | null) => void;
}

/** The "?" control. The toolbar owns whether the panel is open; this is only the button. */
export function HelpButton({ open, onToggle, nodeRef }: HelpButtonProps): ReactElement {
  return (
    <IconButton
      token="help"
      title="Help"
      testId="monitor-help"
      className="icon-button monitor-controls__button"
      ariaPressed={open}
      nodeRef={nodeRef}
      onClick={onToggle}
    />
  );
}

export interface HelpPanelProps {
  /** The button the panel hangs from. */
  readonly anchor: RefObject<HTMLElement | null>;
  /** `returnFocus`: whether focus goes back to the button (Esc) or stays where the user's click put it. */
  readonly onClose: (returnFocus: boolean) => void;
}

export function HelpPanel({ anchor, onClose }: HelpPanelProps): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  // Placed before paint: below the button, right-aligned to it where the window's edge would cut it off,
  // above it near the bottom, clamped to what remains. Focus goes in at the same moment.
  useLayoutEffect(() => {
    const el = ref.current;
    const host = anchor.current;
    if (el === null || host === null) return;
    const a = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setPlace(
      clampToViewport(
        { left: a.left, right: a.right, top: a.top - GAP, bottom: a.bottom + GAP },
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    el.focus();
  }, [anchor]);

  // Click-away closes. The button's own press toggles, so it is not "away".
  useLayoutEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target) === true || anchor.current?.contains(target) === true) return;
      onClose(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [anchor, onClose]);

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // Handled: the window's Esc (which closes the window) skips an event that is already handled.
    e.preventDefault();
    e.stopPropagation();
    onClose(true);
  };

  return (
    <div
      ref={ref}
      className="monitor-help"
      data-testid="monitor-help-panel"
      role="dialog"
      aria-label="About the Resource Monitor"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={place === null ? { visibility: 'hidden' } : { left: place.left, top: place.top }}
    >
      <p className="monitor-help__disclaimer" data-testid="monitor-help-disclaimer">
        {HELP_DISCLAIMER}
      </p>
      {HELP_SECTIONS.map((section) => (
        <section key={section.id} className="monitor-help__section" data-testid={`monitor-help-section-${section.id}`}>
          <h4 className="monitor-help__heading">{section.title}</h4>
          <p>{section.text}</p>
        </section>
      ))}
    </div>
  );
}
