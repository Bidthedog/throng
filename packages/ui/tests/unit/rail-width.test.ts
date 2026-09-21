/**
 * #381 — a collapsed rail is sized around its collapse control, which grows with `sizes.iconPx`.
 *
 * The rail used to be a fixed 32px around a fixed 22px control. The control now derives from the
 * icon size, so a fixed rail would clip it at the largest sizes the Themes editor offers (32).
 */
import { describe, expect, it } from 'vitest';
import {
  PANE_COLLAPSE_INSET_PX,
  paneCollapseBoxPx,
  railWidthPx,
} from '../../src/renderer/panes/rail-width.js';

describe('the collapsed rail (#381)', () => {
  it('is what it always was at the default icon size', () => {
    expect(paneCollapseBoxPx(16)).toBe(22);
    expect(railWidthPx(16)).toBe(32);
  });

  it('holds the control with an equal inset on both sides at every icon size the editor offers', () => {
    for (let iconPx = 10; iconPx <= 32; iconPx++) {
      expect(railWidthPx(iconPx) - paneCollapseBoxPx(iconPx)).toBe(PANE_COLLAPSE_INSET_PX * 2);
      expect(paneCollapseBoxPx(iconPx)).toBeGreaterThan(iconPx);
    }
  });
});
