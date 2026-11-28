/**
 * The **Copy as** submenu: one builder for every menu that offers a copy in a named format, so the rows read the same
 * wherever they appear. It is the menu's only copy row (v1 review, 2026-11-28: it replaces the plain *Copy* rather than
 * sitting beside it). It offers each format by name, and the format the preference picks (`preferred`) shows the
 * copy key, which copies in that format (constitution VI: a preference picks the default; the menu offers every
 * variant).
 *
 * The leaves are named for the format alone ("Rich Text", "Plain Text"), because the parent already says what they do.
 * Every row copies, so each carries the `copy` glyph, as Copy Path's leaves do. A leaf keeps the test id the flat row
 * it replaced had (`menu-item-Copy as Rich Text`), so a test reaching it only adds opening the submenu.
 */
import type { PreviewCopyFormat } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import { fixedShortcut } from './fixed-shortcut.js';

export const COPY_AS_LABEL = 'Copy as';

const FORMAT_LABEL: Record<PreviewCopyFormat, string> = { rich: 'Rich Text', plain: 'Plain Text' };
const FORMAT_ORDER: readonly PreviewCopyFormat[] = ['rich', 'plain'];

export interface CopyAsArgs {
  section: MenuAction['section'];
  /** The clipboard group the menu's Cut / Copy / Paste rows share. Absent: no group. */
  group?: string;
  /** Disables the parent and every leaf: nothing to copy. */
  disabled?: boolean;
  /** The format the copy key copies in (the preference's): its leaf shows that key. */
  preferred?: PreviewCopyFormat;
  copy: (format: PreviewCopyFormat) => void;
}

export function copyAsSubmenu(args: CopyAsArgs): MenuAction {
  const { section, group, disabled } = args;
  const shared = { section, ...(group !== undefined ? { group } : {}), ...(disabled === true ? { disabled } : {}) };
  return {
    label: COPY_AS_LABEL,
    icon: 'copy',
    ...shared,
    submenu: FORMAT_ORDER.map((format) => ({
      label: FORMAT_LABEL[format],
      icon: 'copy',
      testId: `menu-item-${COPY_AS_LABEL} ${FORMAT_LABEL[format]}`,
      ...shared,
      ...(format === args.preferred ? { shortcut: fixedShortcut('copy') } : {}),
      onClick: () => args.copy(format),
    })),
  };
}
