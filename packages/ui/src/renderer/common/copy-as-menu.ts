/**
 * The **Copy as** submenu: one builder for every menu that offers a copy in a named format, so the rows read the same
 * wherever they appear. The menu's plain *Copy* runs the preference's format; this submenu offers each format by name
 * (constitution: a preference picks the default, the menu offers every variant). It sits straight after *Copy*, in the
 * same section and group.
 *
 * The leaves are named for the format alone ("Rich Text", "Plain Text"), because the parent already says what they do.
 * Every row copies, so each carries the `copy` glyph, as Copy Path's leaves do. A leaf keeps the test id the flat row
 * it replaced had (`menu-item-Copy as Rich Text`), so a test reaching it only adds opening the submenu.
 */
import type { PreviewCopyFormat } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';

export const COPY_AS_LABEL = 'Copy as';

const FORMAT_LABEL: Record<PreviewCopyFormat, string> = { rich: 'Rich Text', plain: 'Plain Text' };
const FORMAT_ORDER: readonly PreviewCopyFormat[] = ['rich', 'plain'];

export interface CopyAsArgs {
  section: MenuAction['section'];
  /** The clipboard group the menu's Cut / Copy / Paste rows share. Absent: no group. */
  group?: string;
  /** Disables the parent and every leaf, as the plain Copy beside it is disabled. */
  disabled?: boolean;
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
      onClick: () => args.copy(format),
    })),
  };
}
