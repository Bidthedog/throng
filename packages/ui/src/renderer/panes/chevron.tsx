import { type ReactElement } from 'react';

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
 * The token's artwork points RIGHT, so the left-facing control is the same glyph rotated. Rotating a
 * themed icon keeps it themed; drawing a second one by hand would not.
 */
export function Chevron({ dir, size = 14 }: { dir: 'left' | 'right'; size?: number }): ReactElement {
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
