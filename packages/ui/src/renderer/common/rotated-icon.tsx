import { type ReactElement } from 'react';
import { type IconKey } from '@throng/core';

import { Icon } from './icon.js';

/**
 * A themed icon turned by any angle (069 FR-040). Rotating the one key keeps it themed and
 * overridable by a user set; a second, pre-turned drawing of the same art would not be.
 *
 * `degrees` turns clockwise, as CSS `rotate()` does: 90 turns art that points down to point left.
 */
export function RotatedIcon({
  token,
  degrees,
  size,
}: {
  token: IconKey;
  degrees: number;
  size?: number;
}): ReactElement {
  return (
    <span
      className="rotated-icon"
      data-rotation={degrees}
      style={{
        display: 'inline-flex',
        fontSize: size,
        transform: degrees === 0 ? undefined : `rotate(${degrees}deg)`,
      }}
      aria-hidden
    >
      <Icon token={token} />
    </span>
  );
}
