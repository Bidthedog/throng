/**
 * 032 T008 — two writers, one document, nothing lost (FR-001/FR-002/FR-003, G2/G3).
 *
 * This is the layer the guarantee actually lives at. The E2E reproduction proves the defect is
 * reachable through the product; this proves the property holds deterministically, without needing
 * to win a ~45 ms race with a Playwright click.
 *
 * The tests below are written so that a REGRESSION IS UNAMBIGUOUS. Each one asserts on the final
 * document rather than on the return values, because every one of these writes reports success even
 * when the change it carried has been silently reverted — that is precisely what made #249 and #260
 * so hard to see.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { writeConfigDoc, writeConfigPatch } from '../../src/main/config-write-ipc.js';

const tempDirs: string[] = [];

function freshStore(seed: unknown): { store: FileConfigStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-write-concurrency-'));
  tempDirs.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'settings.json'), `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  return { store: new FileConfigStore(root), root };
}

function readSettings(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')) as Record<string, unknown>;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('two windows, different keys (G2 — the #249 shape)', () => {
  it('both changes survive', async () => {
    // The literal reproduction: the Preferences window changes a notification mode while the main
    // window persists the folder it just used for a project.
    // Real values from `DISPLAY_MODES`, not plausible-looking ones. An unrecognised mode would be
    // substituted by the bounds guard and the test would be asserting the guard's behaviour rather
    // than the write's.
    const { store, root } = freshStore({
      notifications: { error: { mode: 'dismiss' } },
      newProject: { lastProjectFolder: 'D:/old' },
    });

    await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['notifications', 'error', 'mode'], value: 'never' },
      ]),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['newProject', 'lastProjectFolder'], value: 'D:/new' },
      ]),
    ]);

    const after = readSettings(root) as {
      notifications: { error: { mode: string } };
      newProject: { lastProjectFolder: string };
    };
    expect(after.notifications.error.mode).toBe('never');
    expect(after.newProject.lastProjectFolder).toBe('D:/new');
  });

  it('survives the reverse arrival order too', async () => {
    const { store, root } = freshStore(DEFAULT_APP_SETTINGS);
    await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['newProject', 'lastProjectFolder'], value: 'D:/second' },
      ]),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'Matrix' },
      ]),
    ]);
    const after = readSettings(root) as {
      appearance: { theme: string };
      newProject: { lastProjectFolder: string };
    };
    expect(after.appearance.theme).toBe('Matrix');
    expect(after.newProject.lastProjectFolder).toBe('D:/second');
  });

  it('survives many writers at once, each owning one key', async () => {
    /*
     * A map-shaped setting is what makes this test possible with REAL keys.
     * `editor.languageByExtension` is a `Record<string, string>` of user extension→language
     * mappings, shipped EMPTY and open to any key — so it is a place forty distinct, genuine
     * settings paths exist, and the exercise runs through exactly the parse-and-normalise the
     * product runs rather than through synthetic keys the schema would strip.
     */
    const { store, root } = freshStore(DEFAULT_APP_SETTINGS);
    const extensions = Array.from({ length: 40 }, (_, i) => `.ext${i}`);

    await Promise.all(
      extensions.map((extension, i) =>
        writeConfigPatch(store, { kind: 'settings' }, [
          { path: ['editor', 'languageByExtension', extension], value: `language-${i}` },
        ]),
      ),
    );

    const after = readSettings(root) as {
      editor: { languageByExtension: Record<string, string> };
    };
    for (const [i, extension] of extensions.entries()) {
      expect(after.editor.languageByExtension[extension], `${extension} was lost`).toBe(
        `language-${i}`,
      );
    }
  });
});

describe('two windows, the same key (G3, disk half)', () => {
  it('resolves to the later CALLER, not the luckier scheduler', async () => {
    const { store, root } = freshStore(DEFAULT_APP_SETTINGS);
    await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'First' },
      ]),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'Second' },
      ]),
    ]);
    expect((readSettings(root) as { appearance: { theme: string } }).appearance.theme).toBe('Second');
  });

  it('never produces a value neither writer asked for', async () => {
    const { store, root } = freshStore(DEFAULT_APP_SETTINGS);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        writeConfigPatch(store, { kind: 'settings' }, [
          { path: ['appearance', 'theme'], value: `Theme${i}` },
        ]),
      ),
    );
    const theme = (readSettings(root) as { appearance: { theme: string } }).appearance.theme;
    expect(theme).toMatch(/^Theme\d+$/);
  });
});

describe('mixed channels (G12)', () => {
  it('a patch and a whole-document write do not interleave', async () => {
    // Revert All writes settings by patch and keybindings/themes wholesale, so mixing the two
    // channels is a real thing the product does — not a synthetic case.
    const { store, root } = freshStore(DEFAULT_APP_SETTINGS);
    const wholeDocument = {
      ...DEFAULT_APP_SETTINGS,
      appearance: { theme: 'FromDocument' },
      newProject: { ...DEFAULT_APP_SETTINGS.newProject, lastProjectFolder: 'D:/from-document' },
    };

    await Promise.all([
      writeConfigDoc(store, { kind: 'settings' }, JSON.stringify(wholeDocument)),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'FromPatch' },
      ]),
    ]);

    const after = readSettings(root) as {
      appearance: { theme: string };
      newProject: { lastProjectFolder: string };
    };

    /*
     * Two whole outcomes are acceptable; a blend is not.
     *
     * `lastProjectFolder` is the tell. If the patch ran second it must have read the DOCUMENT
     * writer's result, so the folder is `D:/from-document` either way. A folder of `''` — the
     * seeded default — would mean the patch read the original file and wrote it back over a
     * document that had already replaced it, which is the interleave.
     */
    expect(after.newProject.lastProjectFolder).toBe('D:/from-document');
    expect(['FromPatch', 'FromDocument']).toContain(after.appearance.theme);
  });
});

describe('the guarantee under a corrupt file', () => {
  it('a refused patch does not disturb a concurrent one', async () => {
    // Both patches read the same corrupt base, so both must refuse — and neither may write the
    // document it could not read.
    const { store, root } = freshStore({});
    writeFileSync(join(root, 'settings.json'), '{ broken', 'utf8');

    const results = await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'Matrix' },
      ]),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['newProject', 'lastProjectFolder'], value: 'D:/work' },
      ]),
    ]);

    expect(results).toEqual([
      { ok: false, error: 'read-failed' },
      { ok: false, error: 'read-failed' },
    ]);
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe('{ broken');
  });
});
