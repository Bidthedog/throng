import { type HTMLAttributes, type ReactElement, type Ref } from 'react';
import { markCountLabel } from '@throng/core';
import type { HolderMark } from './use-attention.js';

/**
 * The mark a panel, tab, project row or category header wears while a panel needs the user (057 FR-003,
 * FR-010 – FR-013, FR-015 – FR-017). One component, so every holder is the SAME mark; the call sites are
 * pinned by `attention-mark-call-sites.test.ts`, the unsaved dot's precedent.
 *
 * ══ ONE CIRCLE (FR-135, round 13) ══
 *
 * A solid disc in the theme's `attentionMark`, drawn by CSS: no glyph, and the same for an Attention and a
 * Failed mark. The kind is told in words — the accessible name is the holder's full tooltip text, one line
 * per marked panel, reason and kind included (FR-015). No holder repeats it as a native `title` (FR-123): a
 * panel header needs none (FR-096), and every other holder opens a popover on hover (FR-097, FR-098; the
 * tab's own popover). `data-kind` stays for tests and the popover, never for the look.
 *
 * ══ BESIDE THE UNSAVED DOT (FR-017) ══
 *
 * It shares nothing with the unsaved-changes dot — a different class, a larger disc in its own colour, a
 * slower blink (FR-138) — so a header showing both reads as two marks. (The source guards that find the dot by its class name
 * read this file too, so the name is deliberately not spelled here.)
 */
export function AttentionMark({
  mark,
  testId,
  blockAncestorTitle = false,
  showCount = false,
  ref,
  ...rest
}: {
  mark: HolderMark;
  testId: string;
  /**
   * Draw the number of marked panels beneath the holder inside the circle (FR-131, FR-136), `9+` above
   * nine. A project row, a tab chip and a category header ask for it; a panel header's circle carries none.
   * The digits are the circle's own text, in the black or white derived for its fill, and are hidden from
   * assistive tech, the accessible name already listing every panel.
   */
  showCount?: boolean;
  /**
   * Render an EMPTY `title`, which stops an ancestor's native tooltip applying over this mark. A project
   * row's mark sits inside the switch button ("Double-click to rename"), and that tooltip would show on
   * top of the popover (FR-097).
   */
  blockAncestorTitle?: boolean;
  ref?: Ref<HTMLSpanElement>;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'title' | 'className'>): ReactElement {
  return (
    <span
      {...rest}
      ref={ref}
      className="throng-attention-mark"
      data-testid={testId}
      data-kind={mark.kind}
      role="img"
      title={blockAncestorTitle ? '' : undefined}
      aria-label={mark.label}
      data-numbered={showCount ? 'true' : undefined}
    >
      {showCount ? <Count label={markCountLabel(mark.count)} /> : null}
    </span>
  );
}

/** "9+" is two characters in a 14 px disc, so it is drawn a size smaller (`data-wide`). */
function Count({ label }: { label: string }): ReactElement {
  return (
    <span className="throng-attention-mark__count" aria-hidden="true" data-wide={label.length > 1 ? 'true' : undefined}>
      {label}
    </span>
  );
}
