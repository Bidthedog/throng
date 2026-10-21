import { type HTMLAttributes, type ReactElement, type Ref } from 'react';
import { Icon } from '../common/icon.js';
import type { HolderMark } from './use-attention.js';

/**
 * The mark a panel, tab, project row or category header wears while a panel needs the user (057 FR-003,
 * FR-010 – FR-013, FR-015 – FR-017). One component, so every holder is the SAME mark; the call sites are
 * pinned by `attention-mark-call-sites.test.ts`, the unsaved dot's precedent.
 *
 * ══ NOT COLOUR ALONE (FR-016) ══
 *
 * The kind is carried by the ICON (`attention` or `attentionFailed`, each a theme token and so
 * replaceable by an icon pack) as well as by the colour, so the two kinds still differ for a user who
 * cannot tell the colours apart. The accessible name is the holder's full tooltip text, one line per
 * marked panel (FR-015). No holder repeats it as a native `title` (FR-123): a panel header needs none
 * (FR-096), and every other holder opens a popover on hover (FR-097, FR-098; the tab's own popover).
 *
 * ══ BESIDE THE UNSAVED DOT (FR-017) ══
 *
 * It shares nothing with the unsaved-changes dot — a different class, a glyph and not a disc, no pulse —
 * so a header showing both reads as two marks. (The source guards that find the dot by its class name
 * read this file too, so the name is deliberately not spelled here.)
 */
export function AttentionMark({
  mark,
  testId,
  blockAncestorTitle = false,
  ref,
  ...rest
}: {
  mark: HolderMark;
  testId: string;
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
      className={`throng-attention-mark throng-attention-mark--${mark.kind}`}
      data-testid={testId}
      data-kind={mark.kind}
      role="img"
      title={blockAncestorTitle ? '' : undefined}
      aria-label={mark.label}
    >
      <Icon token={mark.kind === 'failed' ? 'attentionFailed' : 'attention'} />
    </span>
  );
}
