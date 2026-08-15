/**
 * 032 T010a — the serialisation point is SHARED, across channels (FR-002a, G11, G12).
 *
 * ══ THE FAILURE THIS EXISTS TO CATCH ══
 *
 * A per-channel lock passes every test in `config-write-concurrency.test.ts`. Two patches would
 * serialise correctly, two document writes would serialise correctly, and the feature would look
 * finished — while a patch and a `resetSetting` still interleaved as read-A, read-B, write-A,
 * write-B, because they arrive over different IPC channels and would hold different locks.
 *
 * That is not hypothetical: it is precisely the shape the round-three analysis found, where the fix
 * would have RELOCATED the defect from the renderer into main rather than removing it. So these
 * tests deliberately pair writers that have nothing in common except the file they write.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildShippedDefaults, DEFAULT_APP_SETTINGS } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { writeConfigDoc, writeConfigPatch } from '../../src/main/config-write-ipc.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

const tempDirs: string[] = [];

function fresh(seed: unknown): {
  store: FileConfigStore;
  svc: ShippedDefaultsService;
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'throng-write-serialisation-'));
  tempDirs.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'settings.json'), `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  const store = new FileConfigStore(root);
  return { store, svc: new ShippedDefaultsService(store, buildShippedDefaults()), root };
}

function readSettings(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')) as Record<string, unknown>;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('a patch and a reset — different channels, one document (G11/G12)', () => {
  it('the reset does not revert the patch', async () => {
    const seeded = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
    (seeded.appearance as Record<string, unknown>).theme = 'Matrix';
    const { store, svc, root } = fresh(seeded);

    // The reset resets ONE leaf. The patch changes a DIFFERENT one. Both must survive whichever
    // order they land in — the reset reads the whole document and writes the whole document, so
    // without a shared lock its write reverts whatever the patch did in between.
    await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['newProject', 'lastProjectFolder'], value: 'D:/kept' },
      ]),
      svc.resetSetting('appearance.theme'),
    ]);

    const after = readSettings(root) as {
      appearance: { theme: string };
      newProject: { lastProjectFolder: string };
    };
    expect(after.appearance.theme).toBe(DEFAULT_APP_SETTINGS.appearance.theme);
    expect(after.newProject.lastProjectFolder).toBe('D:/kept');
  });

  it('the later caller reads the earlier caller\u2019s result (G11)', async () => {
    /*
     * The defining property of a serialisation point: section two must OBSERVE section one, not
     * merely follow it.
     *
     * `newProject.lastProjectFolder` is the probe, and it must be a MODELLED key. An earlier
     * revision used a hand-written `handWritten` key, reasoning that only a genuine
     * read-modify-write could carry it through the reset's whole-document write. That was true —
     * and it also asserted that an unmodelled key survives a write, which contradicts 007 FR-023
     * (#95, C1): every settings write in this application normalises through the parse and drops
     * unmodelled keys. The test was pinning a requirement nobody had, against one that shipped two
     * releases earlier.
     *
     * A modelled key proves the same thing just as tightly. The reset writes the whole document
     * computed from what it READ, so the patch's value can only be present if the reset read the
     * patch's result.
     */
    const { store, svc, root } = fresh(DEFAULT_APP_SETTINGS);

    const patch = writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['newProject', 'lastProjectFolder'], value: 'D:/written-by-the-patch' },
    ]);
    const reset = svc.resetSetting('appearance.theme');
    await Promise.all([patch, reset]);

    const after = readSettings(root) as { newProject: { lastProjectFolder: string } };
    expect(after.newProject.lastProjectFolder).toBe('D:/written-by-the-patch');
  });
});

describe('a patch and a whole-document write — different channels, one document', () => {
  it('produces one writer\u2019s document, never a blend', async () => {
    const { store, root } = fresh(DEFAULT_APP_SETTINGS);
    const wholeDocument = {
      ...DEFAULT_APP_SETTINGS,
      appearance: { theme: 'FromDocument' },
      newProject: { ...DEFAULT_APP_SETTINGS.newProject, lastProjectFolder: 'D:/from-document' },
      editor: { ...DEFAULT_APP_SETTINGS.editor, saveAllScope: 'all' as const },
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
      editor: { saveAllScope: string };
    };
    // The two keys the PATCH never mentioned prove which document was its base. Finding the seeded
    // defaults there would mean the patch read the ORIGINAL file and wrote it back over the
    // document write — the exact interleave.
    expect(after.newProject.lastProjectFolder).toBe('D:/from-document');
    expect(after.editor.saveAllScope).toBe('all');
    expect(['FromPatch', 'FromDocument']).toContain(after.appearance.theme);
  });
});

describe('the lock does not over-serialise', () => {
  it('a keybindings reset runs alongside a settings patch', async () => {
    // Per DOCUMENT, not global. A theme or keybinding write has no reason to wait behind a settings
    // write, and a global lock would serialise the whole configuration subsystem to prevent a
    // collision that cannot happen — different files.
    const { store, svc, root } = fresh(DEFAULT_APP_SETTINGS);

    const [patch, reset] = await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'Matrix' },
      ]),
      svc.resetBinding('tabs.openPicker'),
    ]);

    expect(patch).toEqual({ ok: true });
    expect(reset.ok || reset.reason === 'no-default').toBe(true);
    expect((readSettings(root) as { appearance: { theme: string } }).appearance.theme).toBe('Matrix');
  });

  it('a failed section releases the lock for the next one', async () => {
    // A lock that survived a failure would wedge every later write to that document for the life of
    // the process, and the user's report would be "preferences stopped saving" with nothing in the
    // log — strictly worse than the bug this file is about.
    const { store, root } = fresh(DEFAULT_APP_SETTINGS);

    const refused = await writeConfigPatch(store, { kind: 'settings' }, [{ path: [], value: 1 }]);
    expect(refused).toEqual({ ok: false, error: 'invalid-path' });

    const after = await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['appearance', 'theme'], value: 'StillWorks' },
    ]);
    expect(after).toEqual({ ok: true });
    expect((readSettings(root) as { appearance: { theme: string } }).appearance.theme).toBe(
      'StillWorks',
    );
  });
});
