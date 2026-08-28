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
import { buildShippedDefaults, DEFAULT_APP_SETTINGS, DEFAULT_KEYBINDINGS } from '@throng/core';
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

/**
 * The keybindings counterpart of {@link fresh}: seeds `keybindings.json` rather than
 * `settings.json`, because the pairing below writes the keybindings document from both channels.
 */
function freshKeybindings(): { store: FileConfigStore; svc: ShippedDefaultsService; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-write-serialisation-kb-'));
  tempDirs.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'keybindings.json'),
    `${JSON.stringify(DEFAULT_KEYBINDINGS, null, 2)}\n`,
    'utf8',
  );
  const store = new FileConfigStore(root);
  return { store, svc: new ShippedDefaultsService(store, buildShippedDefaults()), root };
}

function readKeybindings(root: string): { bindings: Record<string, string[]> } {
  return JSON.parse(readFileSync(join(root, 'keybindings.json'), 'utf8')) as {
    bindings: Record<string, string[]>;
  };
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

describe('a whole-document write and a reset — one KEYBINDINGS document (#333)', () => {
  /*
   * ══ THE GAP THIS CLOSES ══
   *
   * The pairings above cover a patch against a document write, and a patch against a reset — both
   * on SETTINGS — plus a keybindings reset against a settings patch, which shares no file and so
   * proves only that the lock is per-document.
   *
   * Nothing paired the two channels that the Key Bindings tab actually mixes on ONE file. Removing
   * a chord goes through `writeConfig`, which serialises the WHOLE keybindings document from the
   * renderer's replica; clicking Reset goes through `resetBinding`, a different IPC that reads and
   * rewrites the same file. Those are exactly the "nothing in common except the file they write"
   * pair this suite exists for, and they were the one combination missing.
   */
  it('the reset wins, restoring the FULL shipped chord set (#333)', async () => {
    const { store, svc, root } = freshKeybindings();
    const shipped = DEFAULT_KEYBINDINGS.bindings['zoom.in'];
    expect(shipped.length).toBeGreaterThan(1);

    // What removing chord 0 from `zoom.in` sends: the whole document, minus that one chord.
    const edited = {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'zoom.in': shipped.slice(1) },
    };

    // The user's order: remove, then reset. The reset is issued second, so it must land second —
    // if the document write lands after it, `zoom.in` keeps the edited value and the Reset control
    // silently did nothing, which is the reported symptom.
    const write = writeConfigDoc(store, { kind: 'keybindings' }, JSON.stringify(edited));
    const reset = svc.resetBinding('zoom.in');
    await Promise.all([write, reset]);

    expect(readKeybindings(root).bindings['zoom.in']).toEqual(shipped);
  });

  it('the reset reads the earlier write’s result, so a sibling edit survives it (G11)', async () => {
    const { store, svc, root } = freshKeybindings();
    const shippedIn = DEFAULT_KEYBINDINGS.bindings['zoom.in'];
    const shippedOut = DEFAULT_KEYBINDINGS.bindings['zoom.out'];

    // Both actions edited in one document write, then only `zoom.in` reset. `zoom.out` is the
    // probe: the reset writes the whole document computed from what it READ, so the edited
    // `zoom.out` can only be present if the reset observed the write rather than merely following
    // it. Finding the shipped value there means the reset read the ORIGINAL file.
    const edited = {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: {
        ...DEFAULT_KEYBINDINGS.bindings,
        'zoom.in': shippedIn.slice(1),
        'zoom.out': shippedOut.slice(1),
      },
    };

    const write = writeConfigDoc(store, { kind: 'keybindings' }, JSON.stringify(edited));
    const reset = svc.resetBinding('zoom.in');
    await Promise.all([write, reset]);

    const after = readKeybindings(root).bindings;
    expect(after['zoom.in']).toEqual(shippedIn);
    expect(after['zoom.out']).toEqual(shippedOut.slice(1));
  });
});
