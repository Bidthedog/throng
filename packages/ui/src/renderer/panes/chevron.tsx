import { type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';

import { Icon } from '../common/icon.js';

/**
 * A chevron used by the pane collapse/expand controls. The direction encodes the action: a control
 * points the way the pane will move (FR-007).
 *
 * 018 / FR-014a — this WAS a hard-coded inline vector, while the theme has shipped a `chevron` icon
 * token all along. A pre-existing violation of the constitution's themeable-icon rule, in exactly the
 * class of defect this feature exists to sweep, and one the source issues never mentioned: it was
 * found by a guard that walks the tree rather than by anybody reading the code.
 *
 * The token's artwork points RIGHT, so every other direction is the same glyph rotated. Rotating a
 * themed icon keeps it themed; drawing a second one by hand would not. 068 FR-058 adds `down` and
 * `up` for the Notifications and Sub-workspaces panels, which sit at the bottom of their pane.
 */
export function Chevron({ dir, size = 14 }: { dir: 'left' | 'right' | 'down' | 'up'; size?: number }): ReactElement {
  return (
    <span
      className={`pane-chevron pane-chevron--${dir}`}
      style={{ fontSize: size, display: 'inline-flex' }}
      aria-hidden
    >
      <Icon token="chevron" />
    </span>
  );
}

/**
 * The minimise / restore control of a bottom-of-pane panel (068 FR-058): the side panes' chevron, pointing
 * down to minimise and up to restore, centred in its button. The action is named by the hover title and the
 * accessible name alone — the glyph is decorative, like every other themed icon control.
 */
export function MinimiseChevronButton({
  minimised,
  title,
  testId,
  onClick,
}: {
  minimised: boolean;
  title: string;
  testId: string;
  onClick: (event: ReactMouseEvent) => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="panel__action panel__action--icon panel__action--neutral panel__action--chevron"
      data-testid={testId}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Chevron dir={minimised ? 'up' : 'down'} />
    </button>
  );
}
