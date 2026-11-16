import { describe, expect, it } from 'vitest';
import {
  backupName,
  classifySeededFolder,
  ICON_SET_UPGRADE_VERSION,
  iconSetBackupNoticeText,
  planThemeIconSetUpgrade,
} from '../../src/icons/icon-set-upgrade.js';
import { isIconSetBackupName } from '../../src/icons/icon-set-name.js';
import { SEEDED_ICON_HISTORY } from '../../src/icons/seeded-icon-history.generated.js';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { THRONG_THEME } from '../../src/config/theme.js';

/** 069 FR-017, FR-018, FR-020 — the theme half of the icon set upgrade. Layer: unit, pure. */
const legacy = (name: string): Record<string, unknown> => ({
  ...structuredClone(THRONG_THEME),
  name,
  icons: { destroy: '✕', folder: '📁' },
  iconOverrides: { destroy: { glyph: 'x' }, folder: { image: 'folder.svg' } },
  iconPack: 'throng-svg',
});

describe('planThemeIconSetUpgrade (069)', () => {
  it('removes icons, iconOverrides and iconPack from a user theme', () => {
    const plan = planThemeIconSetUpgrade(legacy('Mine'), 33);
    expect(plan).not.toBeNull();
    expect(plan!.removed).toEqual(['icons', 'iconOverrides', 'iconPack']);
    for (const key of ['icons', 'iconOverrides', 'iconPack']) expect(key in plan!.theme).toBe(false);
  });

  it('does it the same for a built-in theme', () => {
    for (const name of Object.keys(ALL_DEFAULT_THEMES)) {
      const plan = planThemeIconSetUpgrade({ ...structuredClone(ALL_DEFAULT_THEMES[name]!), icons: { a: 'b' }, iconPack: 'throng' }, 33);
      expect(plan?.removed, name).toEqual(['icons', 'iconPack']);
    }
  });

  it('carries every other token across untouched', () => {
    const before = legacy('Mine');
    const plan = planThemeIconSetUpgrade(before, 33)!;
    const { icons: _i, iconOverrides: _o, iconPack: _p, ...rest } = before;
    expect(plan.theme).toEqual(rest);
  });

  it('does not mutate its input', () => {
    const before = legacy('Mine');
    const snapshot = JSON.stringify(before);
    planThemeIconSetUpgrade(before, 33);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('plans nothing for a theme that carries none of the three', () => {
    expect(planThemeIconSetUpgrade(structuredClone(THRONG_THEME), 33)).toBeNull();
  });

  it('plans nothing the second time (FR-020)', () => {
    const once = planThemeIconSetUpgrade(legacy('Mine'), 33)!;
    expect(planThemeIconSetUpgrade(once.theme, 33)).toBeNull();
  });

  it('removes a key whose value is empty or null too', () => {
    const plan = planThemeIconSetUpgrade({ ...structuredClone(THRONG_THEME), icons: {}, iconPack: null }, 33);
    expect(plan?.removed).toEqual(['icons', 'iconPack']);
  });

  /*
   * Review finding (2026-11-15): upgrade() runs on EVERY shipped-defaults bump, so a step that always
   * dropped `iconPack` would wipe the set a user chose after the 069 upgrade at the next release.
   */
  it(`keeps the theme's chosen set once the configuration is at ${ICON_SET_UPGRADE_VERSION} or later (FR-014, FR-020)`, () => {
    const mine = { ...structuredClone(THRONG_THEME), iconPack: 'mine' };
    expect(planThemeIconSetUpgrade(mine, ICON_SET_UPGRADE_VERSION)).toBeNull();
    expect(planThemeIconSetUpgrade(mine, ICON_SET_UPGRADE_VERSION + 1)).toBeNull();
    expect(planThemeIconSetUpgrade(mine, ICON_SET_UPGRADE_VERSION - 1)?.removed).toEqual(['iconPack']);
  });

  it('still drops a stray glyph map or override map at any version, keeping the set', () => {
    const plan = planThemeIconSetUpgrade({ ...structuredClone(THRONG_THEME), icons: { a: 'b' }, iconPack: 'mine' }, ICON_SET_UPGRADE_VERSION + 1);
    expect(plan?.removed).toEqual(['icons']);
    expect(plan?.theme).toHaveProperty('iconPack', 'mine');
  });

  it('is the version the shipped defaults record reached with 069', () => {
    expect(ICON_SET_UPGRADE_VERSION).toBe(34);
  });
});

describe('isIconSetBackupName (069 FR-037)', () => {
  it.each(['old.bak', 'old.bak.2', 'Old.BAK', 'x.Bak.12'])('treats %s as a backup', (name) => {
    expect(isIconSetBackupName(name)).toBe(true);
  });

  it.each(['mine', 'bak', 'old.bak.x', 'old.backup'])('treats %s as a set', (name) => {
    expect(isIconSetBackupName(name)).toBe(false);
  });
});

/** What a seeded folder holds, as the upgrade reads it: file names and the hash of each. */
const asFiles = (files: Readonly<Record<string, string>>): { name: string; sha256: string }[] =>
  Object.entries(files).map(([name, sha256]) => ({ name, sha256 }));

describe('classifySeededFolder (069 FR-036)', () => {
  const alpha16 = (folder: 'throng' | 'throng-svg') => SEEDED_ICON_HISTORY[folder].find((v) => v.tags.includes('v1.0.0-alpha16'))!;
  const alpha1 = (folder: 'throng' | 'throng-svg') => SEEDED_ICON_HISTORY[folder].find((v) => v.tags.includes('v1.0.0-alpha1'))!;

  it('knows both seeded folders for every tag', () => {
    for (const folder of ['throng', 'throng-svg'] as const) {
      const tags = SEEDED_ICON_HISTORY[folder].flatMap((v) => v.tags);
      expect(tags).toHaveLength(16);
      expect(new Set(tags).size).toBe(16);
    }
  });

  it.each(['throng', 'throng-svg'] as const)('calls %s uncustomised when it is exactly what alpha16 seeded', (folder) => {
    expect(classifySeededFolder(folder, asFiles(alpha16(folder).files))).toBe('uncustomised');
  });

  it.each(['throng', 'throng-svg'] as const)('calls %s uncustomised when it is exactly what alpha1 seeded', (folder) => {
    expect(classifySeededFolder(folder, asFiles(alpha1(folder).files))).toBe('uncustomised');
  });

  it('does not depend on the order of the files', () => {
    const files = asFiles(alpha16('throng-svg').files).reverse();
    expect(classifySeededFolder('throng-svg', files)).toBe('uncustomised');
  });

  it('calls it customised when a file was edited', () => {
    const files = asFiles(alpha16('throng-svg').files);
    files[1] = { ...files[1]!, sha256: '0'.repeat(64) };
    expect(classifySeededFolder('throng-svg', files)).toBe('customised');
  });

  it('calls it customised when a file throng never seeded was added', () => {
    const files = [...asFiles(alpha16('throng-svg').files), { name: 'mine.svg', sha256: '1'.repeat(64) }];
    expect(classifySeededFolder('throng-svg', files)).toBe('customised');
  });

  it('calls it customised when a seeded file is missing', () => {
    const files = asFiles(alpha16('throng-svg').files).slice(1);
    expect(classifySeededFolder('throng-svg', files)).toBe('customised');
  });

  it('calls it customised when it mixes files from two releases, though each file was once seeded', () => {
    const a = asFiles(alpha1('throng-svg').files);
    const b = asFiles(alpha16('throng-svg').files);
    const mixed = [...a.slice(0, 5), ...b.slice(5)];
    // Same names as one release (or a union), hashes from two: no single release wrote it.
    expect(a.map((f) => f.name).sort()).not.toEqual(b.map((f) => f.name).sort());
    expect(classifySeededFolder('throng-svg', mixed)).toBe('customised');
  });

  it('calls an empty folder customised, because no release seeded an empty one', () => {
    expect(classifySeededFolder('throng', [])).toBe('customised');
  });

  it('calls a folder that is not one of the two seeded names customised, whatever it holds', () => {
    expect(classifySeededFolder('mine', asFiles(alpha16('throng').files))).toBe('customised');
  });

  it('does not take one folder\'s files for the other\'s', () => {
    expect(classifySeededFolder('throng', asFiles(alpha16('throng-svg').files))).toBe('customised');
  });
});

describe('backupName (069 FR-019)', () => {
  it('adds .bak', () => {
    expect(backupName('mine', [])).toBe('mine.bak');
    expect(backupName('mine', ['other', 'other.bak'])).toBe('mine.bak');
  });

  it('takes .bak.2 when .bak is taken, then .3', () => {
    expect(backupName('throng-svg', ['throng-svg.bak'])).toBe('throng-svg.bak.2');
    expect(backupName('throng-svg', ['throng-svg.bak', 'throng-svg.bak.2'])).toBe('throng-svg.bak.3');
  });

  it('takes the first free number, not the next after the highest', () => {
    expect(backupName('x', ['x.bak', 'x.bak.3'])).toBe('x.bak.2');
  });

  it('compares taken names ignoring case, as Windows does', () => {
    expect(backupName('Mine', ['mine.BAK'])).toBe('Mine.bak.2');
  });

  it('is not misled by a different set that merely starts the same', () => {
    expect(backupName('x', ['x.bakery', 'xx.bak'])).toBe('x.bak');
  });
});

describe('iconSetBackupNoticeText (069 FR-038)', () => {
  it('says the folders hold icons from before the upgrade, that nothing was converted, and what to do', () => {
    const { title, message } = iconSetBackupNoticeText(3);
    expect(title.length).toBeGreaterThan(0);
    expect(message).toMatch(/before the upgrade/i);
    expect(message).toMatch(/nothing was converted/i);
    expect(message).toMatch(/new icon set/i);
    expect(message).toMatch(/delete the backups or move them out of the folder/i);
  });

  it('counts the folders and agrees with the number', () => {
    expect(iconSetBackupNoticeText(1).message).toMatch(/\b1 folder\b/);
    expect(iconSetBackupNoticeText(1).message).not.toMatch(/folders\b.*\bhold\b/);
    expect(iconSetBackupNoticeText(12).message).toMatch(/\b12 folders\b/);
  });

  it('groups large counts like every other displayed quantity', () => {
    expect(iconSetBackupNoticeText(1234).message).toContain(new Intl.NumberFormat().format(1234));
  });

  it('says "icon set", never "pack", and uses generic OS wording', () => {
    for (const n of [1, 2]) {
      const { title, message } = iconSetBackupNoticeText(n);
      expect(`${title} ${message}`).not.toMatch(/pack/i);
      expect(`${title} ${message}`).not.toMatch(/explorer|finder|nautilus/i);
    }
  });
});
