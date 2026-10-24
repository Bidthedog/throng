/**
 * The monitor's help (055 FR-093): the "?" button and the panel it opens, explaining what Components and
 * Projects are, how the two columns work, what the rows are ordered by and what a bar's colour means, what the
 * list shows (Hide ended, the Total row, dropped columns, "-" and "~"), Activate, the divider, the
 * mouse, the keys, and what amber and red mean with the thresholds that are set right now.
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
import { COMPONENT_DESCRIPTIONS, formatGrouped, type ComponentId, type UsageThresholds } from '@throng/core';
import { clampToViewport } from '../common/clamp-to-viewport.js';
import { Icon } from '../common/icon.js';
import { IconButton } from '../common/icon-button.js';
import { FIGURE_LABEL, type FigureId } from './figures.js';
import { useView } from './monitor-session.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

/** The gap between the button and the panel hanging from it. */
const GAP = 6;

/** What each metric's bar colour is a share of (FR-094), in words. */
const SHARE_OF: Readonly<Record<FigureId, string>> = {
  cpu: 'all of the machine’s processors',
  memory: 'installed memory',
  gpu: 'the GPU',
  io: 'the highest I/O rate throng has reached since this window opened',
  network: 'the highest network rate throng has reached since this window opened',
};

const pct = (n: number): string => `${formatGrouped(n)}%`;

/** The four components, in the order the top level lists them when nothing is ordered (FR-103). */
const COMPONENTS: readonly (readonly [ComponentId, string])[] = [
  ['ui', 'UI'],
  ['daemon', 'Daemon'],
  ['helpers', 'Helpers'],
  ['projects', 'Projects'],
];

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
  const { thresholds } = useResourceMonitorSettings();
  const { metric } = useView();

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
      <HelpBody thresholds={thresholds} metric={metric} />
    </div>
  );
}

function HelpBody({ thresholds, metric }: { thresholds: UsageThresholds; metric: FigureId }): ReactElement {
  return (
    <>
      <h4 className="monitor-help__heading">Components and Projects</h4>
      <p>
        <strong>Components</strong> are throng itself, by part; <strong>Projects</strong> are your work — what each project is running,
        down through its tabs and panels to the processes in its terminals. Rest the pointer on a component, or on one of throng’s own
        processes, to read what it is for.
      </p>
      {/* The same words as each component row's hover title (FR-102): one source, `descriptions.ts`. */}
      <ul data-testid="monitor-help-components">
        {COMPONENTS.map(([id, name]) => (
          <li key={id}>
            <strong>{name}</strong> — {COMPONENT_DESCRIPTIONS[id]}
          </li>
        ))}
      </ul>

      <h4 className="monitor-help__heading">Two columns</h4>
      <p>
        The <strong>left</strong> column lists things. The top level lists only the four components; open Projects to see your projects,
        and open any row to see what it holds. The <strong>right</strong> column is about the one you have selected — what it is made of,
        every figure of each part, and a graph of each figure over time. With nothing selected it describes the level on the left. The
        right column changes nothing when you click in it: select on the left.
      </p>

      <h4 className="monitor-help__heading">Order by</h4>
      <p data-testid="monitor-help-sorted-by">
        Rows and bars are ranked by the figure chosen under Order by in the toolbar — now <strong>{FIGURE_LABEL[metric]}</strong>. Or click
        a column’s name over the rows to order by it. A bar’s length is that item’s share of the one it belongs to.
      </p>

      <h4 className="monitor-help__heading">What the list shows</h4>
      <ul>
        <li>
          <strong>Hide idle</strong> leaves out processes doing nothing; <strong>Hide ended</strong>, on to begin with, leaves out processes
          that have ended. Turn it off to see them greyed where they were.
        </li>
        <li>The Total row at the foot of the list adds up the whole level, including anything a filter or a hide leaves out.</li>
        <li>
          A narrow window drops figure columns from the right, the Order-by one last; » marks that some are hidden — widen the list or the
          window to see them.
        </li>
        <li data-testid="monitor-help-marks">
          “-” stands for a figure that is not measured (rest the pointer on it to read why); “~” before a memory figure marks an estimate.
        </li>
      </ul>

      <h4 className="monitor-help__heading">Going to it</h4>
      <p data-testid="monitor-help-activate">
        Go to <Icon token="activate" />, beside the name at the top of the right column and in a row’s menu, takes you to that project,
        tab or panel — or a process’s panel — in the window that holds it, switching project first if it has to. The monitor stays open.
      </p>

      <h4 className="monitor-help__heading">The divider</h4>
      <p>
        Drag the divider between the columns to give either more room, or Tab to it and use Left and Right. It stays where you leave it.
      </p>

      <h4 className="monitor-help__heading">Bar colour</h4>
      <p data-testid="monitor-help-bar-colour">
        Colour is how much of the machine something takes, whatever its length: its share of {SHARE_OF[metric]}. It runs from green,
        through amber at the warning threshold, to red at the critical one. Something with nothing to measure is grey. The key under the
        bars shows the scale.
      </p>

      <h4 className="monitor-help__heading">The mouse</h4>
      <ul>
        <li>Click a row to select it; the right column follows. Click it again, or empty space, to let go.</li>
        <li>Double-click a row to open it.</li>
        <li>
          Back <Icon token="navigateBack" />, or a name in the path above, goes up. Right-click or Shift+F10 opens the actions for a node.
        </li>
        <li>Rows and bars hold still while the pointer is over them, and catch up when it leaves.</li>
      </ul>

      <h4 className="monitor-help__heading">The keys</h4>
      <ul>
        <li>Up, Down, Home and End move between rows.</li>
        <li>Enter or Right opens a row; Left or Backspace goes up a level.</li>
        <li>
          Tab moves through the filter, the toolbar, the path, the list, the divider and the right column. Esc closes this panel, then the
          window.
        </li>
      </ul>

      <h4 className="monitor-help__heading">Amber and red</h4>
      <p data-testid="monitor-help-bands">
        A figure turns amber at its warning threshold and red at its critical one — CPU (and GPU) from {pct(thresholds.cpuWarning)} and{' '}
        {pct(thresholds.cpuCritical)} of the machine, memory from {pct(thresholds.memoryWarning)} and {pct(thresholds.memoryCritical)} of
        installed memory. Both are set in Preferences.
      </p>
    </>
  );
}
