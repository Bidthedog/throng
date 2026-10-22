/**
 * A reset must survive the same momentary file hold an ordinary edit survives (#341; 032 FR-009).
 *
 * Layer: integration — the defect is in which of the store's two real write paths retries a refused
 * rename; only the real store, the real service and real files show the reset never reaching disk.
 *
 * ══ WHAT THE USER SEES ══
 *
 * Toggle a setting, then press its reset (or the Settings editor's Reset to Defaults). The toggle
 * lands. The reset does not: `settings.json` keeps the toggled value, and it never changes again.
 * That is `preferences-reset.e2e.ts:204` and `:367` on a hosted runner — a poll for `false` that
 * reads `true` for its whole thirty-second budget, passing on retry with no code change.
 *
 * ══ WHY ONE WRITE SURVIVES AND THE OTHER DOES NOT ══
 *
 * Both are completed by renaming a staged file over `settings.json`, and on Windows that rename
 * fails with EPERM while anything holds a handle on the target without share-delete — Defender, the
 * indexer, our own watcher reading the file the previous write just changed. #75 gave the ordinary
 * write (`FileConfigStore.commit`) a bounded retry for exactly that, and 032 FR-009 made it a
 * requirement of EVERY write completed by replacing the target. The resets do not go through
 * `commit`: they go through `writeFilesAtomic` (010 FR-012), whose rename was never given the retry.
 * So the write that comes straight after another write — which is precisely when a scanner is
 * looking at the file — was the one write with no tolerance for it. It failed, rolled back, and
 * nothing ever re-applied it.
 *
 * ══ HOW THE HOLD IS FORCED ══
 *
 * A real handle releases on the operating system's schedule, so a test holding one would be racing
 * it. Instead the rename onto the held path fails with a genuine-shaped EPERM for its first few
 * attempts and then succeeds — the shape of a scanner letting go — which makes the ordering exact:
 * the toggle has landed, the reset is issued, the hold is in place for the reset's rename.
 * (`config-store-retry-exhaustion.test.ts` covers the PERMANENT case with a real directory.)
 *
 * The ordinary write is driven through the SAME hold as a control. Without it, a hold that broke
 * every write would make the reset assertions pass or fail for a reason unrelated to the reset path.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, buildShippedDefaults } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';
import { writeConfigPatch } from '../../src/main/config-write-ipc.js';

/** Destination path → renames still to refuse. Empty means nothing is held. */
const held = vi.hoisted(() => new Map<string, number>());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { resolve: resolvePath } = await import('node:path');
  const rename = async (from: string, to: string): Promise<void> => {
    const key = resolvePath(String(to));
    const remaining = held.get(key) ?? 0;
    if (remaining > 0) {
      held.set(key, remaining - 1);
      throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), {
        code: 'EPERM',
        errno: -4048,
        syscall: 'rename',
      });
    }
    return actual.rename(from, to);
  };
  return { ...actual, rename, default: { ...actual, rename } };
});

const SHIPPED = buildShippedDefaults();

/**
 * Three refusals, then success. `renameWithRetry` waits 20 ms between attempts, so the hold lasts
 * ~60 ms — far inside its 1 s budget, and the same order as a scanner's handle (tens of ms).
 */
const SCANNER_HOLD_ATTEMPTS = 3;

const tempDirs: string[] = [];
afterEach(() => {
  held.clear();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A seeded config root where the user has already toggled `editor.autoSave` on, as the E2E does. */
async function toggledRoot(): Promise<{
  settingsPath: string;
  store: FileConfigStore;
  service: ShippedDefaultsService;
}> {
  const root = mkdtempSync(join(tmpdir(), 'throng-reset-hold-'));
  tempDirs.push(root);
  const store = new FileConfigStore(root);
  const service = new ShippedDefaultsService(store, SHIPPED);
  expect((await service.seed()).ok).toBe(true);
  // The toggle, through the same channel the Settings tab uses (032 FR-001).
  const toggled = await writeConfigPatch(store, { kind: 'settings' }, [
    { path: ['editor', 'autoSave'], value: true },
  ]);
  expect(toggled.ok).toBe(true);
  const settingsPath = store.pathOf({ kind: 'settings' });
  expect(autoSaveOnDisk(settingsPath)).toBe(true);
  return { settingsPath, store, service };
}

function autoSaveOnDisk(settingsPath: string): unknown {
  return (JSON.parse(readFileSync(settingsPath, 'utf8')) as { editor?: { autoSave?: unknown } }).editor
    ?.autoSave;
}

function holdForAScanner(settingsPath: string): void {
  held.set(resolve(settingsPath), SCANNER_HOLD_ATTEMPTS);
}

describe('a momentary hold on settings.json (032 FR-009)', () => {
  it('control: an ordinary edit rides it out and lands', async () => {
    const { settingsPath, store } = await toggledRoot();
    holdForAScanner(settingsPath);

    const res = await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['editor', 'autoSave'], value: false },
    ]);

    expect(res.ok).toBe(true);
    expect(autoSaveOnDisk(settingsPath)).toBe(false);
    expect(held.get(resolve(settingsPath))).toBe(0); // the hold was actually met, not bypassed
  });

  it('the per-tab Reset to Defaults rides it out and lands (preferences-reset.e2e.ts:204)', async () => {
    const { settingsPath, service } = await toggledRoot();
    holdForAScanner(settingsPath);

    const res = await service.resetSettings();

    expect(res).toEqual({ ok: true });
    expect(autoSaveOnDisk(settingsPath)).toBe(DEFAULT_APP_SETTINGS.editor.autoSave);
  });

  it('a single-setting reset rides it out and lands, sparing its sibling (preferences-reset.e2e.ts:367)', async () => {
    const { settingsPath, store, service } = await toggledRoot();
    // The sibling edit the E2E makes before resetting.
    const sibling = await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['editor', 'autoSaveDebounceMs'], value: 900 },
    ]);
    expect(sibling.ok).toBe(true);
    holdForAScanner(settingsPath);

    const res = await service.resetSetting('editor.autoSave');

    expect(res).toEqual({ ok: true });
    expect(autoSaveOnDisk(settingsPath)).toBe(DEFAULT_APP_SETTINGS.editor.autoSave);
    const doc = JSON.parse(readFileSync(settingsPath, 'utf8')) as { editor: { autoSaveDebounceMs: number } };
    expect(doc.editor.autoSaveDebounceMs).toBe(900);
  });

  it('Reset All Preferences rides it out and lands', async () => {
    const { settingsPath, service } = await toggledRoot();
    holdForAScanner(settingsPath);

    const res = await service.resetEverything();

    expect(res).toEqual({ ok: true });
    expect(autoSaveOnDisk(settingsPath)).toBe(DEFAULT_APP_SETTINGS.editor.autoSave);
  });
});
