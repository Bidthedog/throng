import { describe, expect, it } from 'vitest';
import { THRONG_THEME } from '../../src/config/theme.js';
import { THEME_TOKEN_COPY } from '../../src/config/theme-copy.js';
import { SHIPPED_DEFAULTS_VERSION } from '../../src/config/shipped-defaults.js';

/**
 * 060 T007 (research R10) — two icon tokens for two new controls on the Find in Files panel.
 *
 * `busy` is the cancel control while a scan runs (FR-001): no "work in progress" glyph existed, and
 * `refresh` means "re-read now", so borrowing it would give one glyph two meanings. `groupFolderTree` is
 * the Folder structure grouping control (FR-018): the two existing grouping controls already draw `file`
 * and `folderOpen`, and a new action takes a new token rather than a reused glyph.
 */
const TOKENS_060 = ['busy', 'groupFolderTree'] as const;

describe('060 icon tokens', () => {
  it.each(TOKENS_060)('%s ships a glyph and editor copy', (token) => {
    const icons = THRONG_THEME.icons as Record<string, string>;
    expect(typeof icons[token]).toBe('string');
    expect(icons[token]!.length).toBeGreaterThan(0);
    const copy = THEME_TOKEN_COPY[`icons.${token}`];
    expect(copy?.label).toBeTruthy();
    expect(copy?.description).toBeTruthy();
  });

  it('gives each a glyph of its own, not one another control already draws', () => {
    const icons = THRONG_THEME.icons as Record<string, string>;
    expect(icons.busy).not.toBe(icons.refresh);
    expect(icons.groupFolderTree).not.toBe(icons.folderOpen);
    expect(icons.groupFolderTree).not.toBe(icons.file);
  });

  it('bumps the shipped-defaults version so existing installs receive them', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(27);
  });
});
