import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { readConfigOnce } from '../../src/main/config-watcher.js';

/**
 * A settings-named theme that is not there (021 / #6).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/theme-tokens.e2e.ts:137` (035 T056) — `test('a non-existent
 * settings theme falls back to defaults and writes no file (#6)')`.
 *
 * ══ WHY IT WAS AT E2E, AND WHY IT DOES NOT NEED TO BE ══
 *
 * The migrated test launched its own Electron app against a seeded config root to make two
 * assertions: the default accent is on `<html>`, and no `themes/Ghost.json` was created. The second
 * is a filesystem fact and never needed a window. The first was reading, through a real cascade, the
 * end of a chain whose every other link is now proven separately:
 *
 *   the read falls back      → this file
 *   the payload reaches the renderer → `integration/config-broadcast-latency.test.ts`
 *   `ThemeProvider` writes the tokens onto `<html>` → `component/theme-provider.test.ts`
 *
 * ══ THE `create: false` IS THE WHOLE OF #6 ══
 *
 * `FileConfigStore.read` normally CREATES a missing document from the default it was handed — which
 * is right for `settings.json` and wrong here, because the default is throng's own theme and
 * creating it would materialise a file called `Ghost.json` containing throng's palette. The user
 * would then have a theme they never made, named after a typo, and it would look correct.
 *
 * So the assertion that nothing is written is not a tidiness check. It is the requirement.
 */

const tempDirs: string[] = [];

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-theme-fallback-'));
  mkdirSync(root, { recursive: true });
  tempDirs.push(root);
  return root;
}

const writeSettings = (root: string, settings: unknown): void =>
  writeFileSync(join(root, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');

/** The theme files that exist under a config root — `[]` when the folder was never created. */
const themeFiles = (root: string): string[] =>
  existsSync(join(root, 'themes')) ? readdirSync(join(root, 'themes')) : [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('a settings-named theme that does not exist (#6)', () => {
  it('falls back to the shipped throng theme', async () => {
    const root = freshRoot();
    writeSettings(root, { appearance: { theme: 'Ghost' } });

    const { payload } = await readConfigOnce(new FileConfigStore(root));

    expect(payload.theme.name).toBe(THRONG_THEME.name);
    expect(payload.theme.colours.accent).toBe(THRONG_THEME.colours.accent);
  });

  it('writes NO file for it — the user must not acquire a theme they never made', async () => {
    const root = freshRoot();
    writeSettings(root, { appearance: { theme: 'Ghost' } });

    await readConfigOnce(new FileConfigStore(root));

    expect(themeFiles(root), 'a stray Ghost.json is #6 itself').not.toContain('Ghost.json');
  });

  it('leaves the SETTING alone rather than correcting it behind the user', async () => {
    /*
     * The fallback is a reading decision, not an edit. A user who is mid-way through creating
     * `Ghost` — the file not yet written — must find their setting still saying `Ghost` when they
     * come back, not silently reset to `throng` because the app looked once and did not find it.
     */
    const root = freshRoot();
    writeSettings(root, { appearance: { theme: 'Ghost' } });

    const { payload } = await readConfigOnce(new FileConfigStore(root));

    expect(payload.settings.appearance.theme).toBe('Ghost');
  });

  it('still READS a theme that does exist, so the fallback is a fallback', async () => {
    // Without this, a resolver that ignored `appearance.theme` entirely and always returned the
    // shipped theme would pass every assertion above.
    const root = freshRoot();
    mkdirSync(join(root, 'themes'), { recursive: true });
    writeFileSync(
      join(root, 'themes', 'Daylight.json'),
      JSON.stringify({ name: 'Daylight', colours: { accent: '#00ff41' } }),
      'utf8',
    );
    writeSettings(root, { appearance: { theme: 'Daylight' } });

    const { payload } = await readConfigOnce(new FileConfigStore(root));

    expect(payload.theme.name).toBe('Daylight');
    expect(payload.theme.colours.accent).toBe('#00ff41');
  });

  it('refuses a name that would read off-tree — with a real file there to be read', async () => {
    /*
     * `isValidThemeName` confines the name to one path segment BEFORE it becomes a path, because
     * `appearance.theme` is hand-editable and `../x` would otherwise resolve outside the config root
     * entirely.
     *
     * THE FIRST DRAFT OF THIS TEST PROVED NOTHING, and the reason is worth keeping: it pointed the
     * setting off-tree and asserted the fallback — but there was no file at the traversed path, so a
     * build with the guard REMOVED fell back too, for the wrong reason. An escape test that does not
     * put something outside the fence is a test of what happens when you escape into an empty field.
     *
     * So a real theme is planted where `<root>/themes/../<name>.json` lands, and the assertion is
     * that it was NOT read.
     */
    const root = freshRoot();
    const planted = join(root, 'off-tree.json');
    writeFileSync(
      planted,
      JSON.stringify({ name: 'OffTree', colours: { accent: '#ff00ff' } }),
      'utf8',
    );
    writeSettings(root, { appearance: { theme: '../off-tree' } });

    const { payload } = await readConfigOnce(new FileConfigStore(root));

    expect(payload.theme.name, 'the traversal was refused before it became a path').toBe(
      THRONG_THEME.name,
    );
    expect(payload.theme.colours.accent).toBe(THRONG_THEME.colours.accent);
  });
});
