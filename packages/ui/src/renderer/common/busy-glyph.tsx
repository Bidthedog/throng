import { type ReactElement } from 'react';
import { Icon } from './icon.js';
import './busy-glyph.css';

/**
 * The application's one busy indicator (060 FR-001a, FR-001b): the theme's `busy` glyph, turning.
 *
 * It is the BOX that rotates, not the glyph. The glyph character is not centred in its em box, so
 * turning it directly wobbles; the box is a square with the glyph flex-centred in it, which turns
 * about its own centre (`busy-glyph.css`). Decorative — the enclosing control or status carries the
 * accessible name.
 */
export function BusyGlyph({ className }: { className?: string }): ReactElement {
  return (
    <span className={className ? `busy-glyph ${className}` : 'busy-glyph'} aria-hidden="true">
      <Icon token="busy" />
    </span>
  );
}
