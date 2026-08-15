/**
 * 032 T007 / T010 — the `throng:config:writePatch` contract.
 *
 * One test per numbered step of `contracts/config-write.md`, plus the guarantees the steps exist to
 * produce. Two of them are worth naming here because they look like defensiveness and are not:
 *
 *   - **An unparseable base is REFUSED** (`read-failed`), never treated as `{}`. Applying a change
 *     on top of an empty base would write a document containing only the key being patched, which
 *     replaces every setting the user has — a larger instance of the exact loss this feature exists
 *     to prevent (FR-006a, G10). Without this test the fix destroys settings rather than protecting
 *     them, and it would do so silently.
 *   - **An ABSENT document is not the same thing** and reads as `{}`. There is nothing to lose, so
 *     refusing would make first-run configuration impossible.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { writeConfigPatch, writeConfigDoc } from '../../src/main/config-write-ipc.js';

const tempDirs: string[] = [];

function freshStore(): { store: FileConfigStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-patch-contract-'));
  tempDirs.push(root);
  return { store: new FileConfigStore(root), root };
}

/** Seed `settings.json` with exact text (including deliberately broken text). */
function seedRaw(root: string, text: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'settings.json'), text, 'utf8');
}

function readSettings(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')) as Record<string, unknown>;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('step 1 — confine', () => {
  it('refuses a theme name that climbs out of the config root', async () => {
    const { store } = freshStore();
    const res = await writeConfigPatch(store, { kind: 'theme', name: '../../settings' }, [
      { path: ['a'], value: 1 },
    ]);
    expect(res).toEqual({ ok: false, error: 'path-escape' });
  });
});

describe('step 2 — unsupported document kinds', () => {
  it.each([
    ['keybindings', { kind: 'keybindings' as const }],
    ['theme', { kind: 'theme' as const, name: 'Matrix' }],
  ])('refuses a patch addressed to %s', async (_label, id) => {
    const { store } = freshStore();
    const res = await writeConfigPatch(store, id, [{ path: ['a'], value: 1 }]);
    // Refused, not quietly accepted: an unsupported write that appears to work is how scope creep
    // becomes a defect.
    expect(res).toEqual({ ok: false, error: 'unsupported-doc' });
  });
});

describe('step 3 — patch validation', () => {
  it('refuses an empty patch', async () => {
    const { store } = freshStore();
    expect(await writeConfigPatch(store, { kind: 'settings' }, [])).toEqual({
      ok: false,
      error: 'empty-patch',
    });
  });

  it.each([
    ['an empty path', [] as string[]],
    ['an empty segment', ['appearance', '']],
    ['__proto__', ['__proto__', 'x']],
    ['constructor', ['constructor']],
    ['prototype', ['a', 'prototype']],
  ])('refuses %s', async (_label, path) => {
    const { store } = freshStore();
    expect(
      await writeConfigPatch(store, { kind: 'settings' }, [{ path, value: 1 }]),
    ).toEqual({ ok: false, error: 'invalid-path' });
  });

  it('writes NOTHING when the patch is refused (G4)', async () => {
    const { store, root } = freshStore();
    seedRaw(root, JSON.stringify({ appearance: { theme: 'Matrix' } }));
    await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['appearance', 'theme'], value: 'Gothic' },
      { path: [], value: 1 },
    ]);
    // Not even the first, valid change landed.
    expect(readSettings(root)).toEqual({ appearance: { theme: 'Matrix' } });
  });
});

describe('step 4 — reading the base', () => {
  it('treats an ABSENT document as {} and writes the patch', async () => {
    const { store, root } = freshStore();
    const res = await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['appearance', 'theme'], value: 'Matrix' },
    ]);
    expect(res).toEqual({ ok: true });
    // The written document is a COMPLETE settings document — the parse fills the rest from the
    // shipped defaults, exactly as every other settings write in the application does.
    const after = readSettings(root) as { appearance: { theme: string } };
    expect(after.appearance.theme).toBe('Matrix');
  });

  it('REFUSES an unparseable base and writes nothing (G10, FR-006a)', async () => {
    const { store, root } = freshStore();
    const corrupt = '{ "appearance": { "theme": "Matrix" ';
    seedRaw(root, corrupt);

    const res = await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['appearance', 'theme'], value: 'Gothic' },
    ]);

    expect(res).toEqual({ ok: false, error: 'read-failed' });
    // THE POINT: the user's broken file is left exactly as it was, for them to repair. Applying the
    // patch to `{}` would have written `{"appearance":{"theme":"Gothic"}}` and destroyed everything
    // else they had configured.
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(corrupt);
  });

  it('refuses a base that parses to something other than an object', async () => {
    const { store, root } = freshStore();
    seedRaw(root, '[1, 2, 3]');
    const res = await writeConfigPatch(store, { kind: 'settings' }, [{ path: ['a'], value: 1 }]);
    expect(res).toEqual({ ok: false, error: 'not-an-object' });
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe('[1, 2, 3]');
  });
});

describe('step 5 — application', () => {
  it('preserves every MODELLED key the patch did not name (G1)', async () => {
    const { store, root } = freshStore();
    seedRaw(
      root,
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS,
        appearance: { theme: 'Matrix' },
        newProject: { ...DEFAULT_APP_SETTINGS.newProject, lastProjectFolder: 'D:/work' },
      }),
    );

    await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['appearance', 'theme'], value: 'Gothic' },
    ]);

    const after = readSettings(root) as {
      appearance: { theme: string };
      newProject: { lastProjectFolder: string };
    };
    expect(after.appearance.theme).toBe('Gothic');
    // THE GUARANTEE THE WHOLE FEATURE EXISTS FOR — the other window's key, written by the project
    // list, surviving a Preferences write that never mentioned it.
    expect(after.newProject.lastProjectFolder).toBe('D:/work');
  });

  it('applies several changes in array order, later wins', async () => {
    const { store, root } = freshStore();
    await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['appearance', 'theme'], value: 'One' },
      { path: ['editor', 'autoSave'], value: true },
      { path: ['appearance', 'theme'], value: 'Two' },
    ]);
    const after = readSettings(root) as {
      appearance: { theme: string };
      editor: { autoSave: boolean };
    };
    expect(after.appearance.theme).toBe('Two');
    expect(after.editor.autoSave).toBe(true);
  });

  it('STRIPS a key the schema does not model, as every settings write does (007 FR-023, #95)', async () => {
    /*
     * The inverse of what an earlier revision of this test asserted, and the earlier one was wrong.
     *
     * It required an unmodelled key to survive, reasoning from G1 — "a key absent from `changes` has
     * the same value after the write as it had on disk". But G1 is about the keys ANOTHER WINDOW
     * changed, and every one of those is modelled; `newProject.lastProjectFolder`, the key this
     * whole feature exists to protect, is in the schema.
     *
     * Meanwhile 007 FR-023 and `preferences-settings.e2e.ts` (#95, C1) require the opposite for
     * unmodelled keys — "the key simply does not survive a parse, so the first ordinary write drops
     * it" — and that shipped two releases before this feature. A patch is still an ordinary write.
     */
    const { store, root } = freshStore();
    seedRaw(root, JSON.stringify({ ...DEFAULT_APP_SETTINGS, handAdded: 'strip me' }));

    await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['appearance', 'theme'], value: 'Matrix' },
    ]);

    const after = readSettings(root) as { handAdded?: string; appearance: { theme: string } };
    expect(after.handAdded).toBeUndefined();
    expect(after.appearance.theme).toBe('Matrix');
  });
});

describe('step 6 — the bounds guard', () => {
  it('clamps an out-of-range value rather than rejecting the patch (031 FR-013a)', async () => {
    const { store, root } = freshStore();
    seedRaw(root, JSON.stringify(DEFAULT_APP_SETTINGS));

    const res = await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['panes', 'projects', 'maxWidth'], value: 99_999 },
    ]);

    expect(res).toEqual({ ok: true });
    const written = readSettings(root) as { panes: { projects: { maxWidth: number } } };
    // A patch must not be able to install a value a hand edit would have been clamped for.
    expect(written.panes.projects.maxWidth).toBeLessThan(99_999);
  });
});

describe('step 7 — atomic write, and the serialisation that makes it mean something', () => {
  it('two concurrent patches to DIFFERENT paths both survive (G2)', async () => {
    const { store, root } = freshStore();
    seedRaw(root, JSON.stringify(DEFAULT_APP_SETTINGS));

    // The literal #249 pair: a Preferences key and a main-window key, written at the same moment.
    await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'Matrix' },
      ]),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['newProject', 'lastProjectFolder'], value: 'D:/work' },
      ]),
    ]);

    // Whichever order they landed in. Without the lock this is read-A, read-B, write-A, write-B and
    // one of the two is gone.
    const after = readSettings(root) as {
      appearance: { theme: string };
      newProject: { lastProjectFolder: string };
    };
    expect(after.appearance.theme).toBe('Matrix');
    expect(after.newProject.lastProjectFolder).toBe('D:/work');
  });

  it('two concurrent patches to the SAME path resolve to the later caller (G3, disk half)', async () => {
    const { store, root } = freshStore();
    seedRaw(root, JSON.stringify(DEFAULT_APP_SETTINGS));

    await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'First' },
      ]),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'Second' },
      ]),
    ]);

    // Sections run in CALL order, so "last write wins" means the last caller — not whichever
    // promise the scheduler happened to resume first.
    expect((readSettings(root) as { appearance: { theme: string } }).appearance.theme).toBe('Second');
  });

  it('a patch cannot interleave with a WHOLE-DOCUMENT write (G12)', async () => {
    // The two channels share one serialisation point. A document write landing between a patch's
    // read and its write would be silently reverted by that patch.
    const { store, root } = freshStore();
    seedRaw(root, JSON.stringify(DEFAULT_APP_SETTINGS));

    const wholeDocument = { ...DEFAULT_APP_SETTINGS, appearance: { theme: 'FromDocument' } };

    await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'FromPatch' },
      ]),
      writeConfigDoc(store, { kind: 'settings' }, JSON.stringify(wholeDocument)),
    ]);

    // Whichever order they ran in, the theme is one of the two values a writer actually asked for —
    // never a third that neither did, which is what an interleave produces.
    const after = readSettings(root) as { appearance: { theme: string } };
    expect(['FromPatch', 'FromDocument']).toContain(after.appearance.theme);
  });
});

describe('error identifiers', () => {
  it('are stable identifiers, not sentences', async () => {
    // Wording for the user is chosen at the notice layer, which is what lets one failure read
    // differently in a notice and in the diagnostics log.
    const { store } = freshStore();
    const results = await Promise.all([
      writeConfigPatch(store, { kind: 'keybindings' }, [{ path: ['a'], value: 1 }]),
      writeConfigPatch(store, { kind: 'settings' }, []),
      writeConfigPatch(store, { kind: 'settings' }, [{ path: [], value: 1 }]),
    ]);
    expect(results.map((r) => (r.ok ? 'ok' : r.error))).toEqual([
      'unsupported-doc',
      'empty-patch',
      'invalid-path',
    ]);
  });
});
