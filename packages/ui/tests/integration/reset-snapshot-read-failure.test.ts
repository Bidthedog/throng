/**
 * A failed multi-file reset must leave every file as it was — never delete one (010 FR-012/012a).
 *
 * Layer: integration — the defect is in the real store's before-snapshot and rollback against real
 * files; only real files show a document that existed before the reset being gone after it.
 *
 * ══ WHAT THE USER SEES ══
 *
 * Reset All Preferences writes `settings.json`, `keybindings.json` and every built-in theme as one
 * operation. Something has `settings.json` open at the moment the reset snapshots it, so that read
 * fails; something else holds `keybindings.json` for longer than the rename retry budget, so that
 * rename fails and the reset rolls back. The user is told nothing was changed — and `settings.json`
 * is GONE. The next read recreates it from the shipped defaults, so every setting the user had made
 * is silently lost.
 *
 * ══ WHY ══
 *
 * The before-snapshot treated ANY read error as "this file did not exist", and the rollback deletes
 * files that did not exist. Only ENOENT means absent. A file the snapshot could not read is a file
 * the reset has no way to put back, so the reset must not replace it.
 *
 * ══ HOW THE HOLDS ARE FORCED ══
 *
 * As in `reset-transient-sharing.test.ts`: the snapshot read of `settings.json` fails with a
 * genuine-shaped EBUSY for a set number of attempts, and the rename onto `keybindings.json` fails
 * with EPERM for longer than the retry budget, so the ordering is exact and owes nothing to the
 * operating system's scheduling.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildShippedDefaults } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';
import { writeConfigPatch } from '../../src/main/config-write-ipc.js';

/** Path → failures still to inject. */
const heldReads = vi.hoisted(() => new Map<string, number>());
const heldRenames = vi.hoisted(() => new Map<string, number>());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { resolve: resolvePath } = await import('node:path');
  const fail = (code: string, syscall: string, path: string): Error =>
    Object.assign(new Error(`${code}: resource busy or locked, ${syscall} '${path}'`), { code, syscall });
  const take = (map: Map<string, number>, path: string): boolean => {
    const key = resolvePath(path);
    const remaining = map.get(key) ?? 0;
    if (remaining <= 0) return false;
    map.set(key, remaining - 1);
    return true;
  };
  const readFile = (async (path: unknown, ...rest: unknown[]) => {
    if (typeof path === 'string' && take(heldReads, path)) throw fail('EBUSY', 'open', path);
    return (actual.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
  }) as typeof actual.readFile;
  const rename = async (from: string, to: string): Promise<void> => {
    if (take(heldRenames, String(to))) throw fail('EPERM', 'rename', String(to));
    return actual.rename(from, to);
  };
  return { ...actual, readFile, rename, default: { ...actual, readFile, rename } };
});

const SHIPPED = buildShippedDefaults();

/** Longer than any retry budget: the rename never succeeds. */
const PERMANENT = Number.MAX_SAFE_INTEGER;

const tempDirs: string[] = [];
afterEach(() => {
  heldReads.clear();
  heldRenames.clear();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A seeded root where the user has toggled `editor.autoSave` on — a choice a reset must not lose. */
async function customisedRoot(): Promise<{
  settingsPath: string;
  keybindingsPath: string;
  before: { settings: string; keybindings: string };
  service: ShippedDefaultsService;
}> {
  const root = mkdtempSync(join(tmpdir(), 'throng-reset-snapshot-'));
  tempDirs.push(root);
  const store = new FileConfigStore(root);
  const service = new ShippedDefaultsService(store, SHIPPED);
  expect((await service.seed()).ok).toBe(true);
  const toggled = await writeConfigPatch(store, { kind: 'settings' }, [
    { path: ['editor', 'autoSave'], value: !SHIPPED.settings.editor.autoSave },
  ]);
  expect(toggled.ok).toBe(true);
  const settingsPath = store.pathOf({ kind: 'settings' });
  const keybindingsPath = store.pathOf({ kind: 'keybindings' });
  return {
    settingsPath,
    keybindingsPath,
    before: { settings: readFileSync(settingsPath, 'utf8'), keybindings: readFileSync(keybindingsPath, 'utf8') },
    service,
  };
}

describe('Reset All Preferences with settings.json held at its snapshot (010 FR-012/012a)', () => {
  it('a momentary hold on the snapshot read: the failed reset rolls settings.json back, not away', async () => {
    const { settingsPath, keybindingsPath, before, service } = await customisedRoot();
    heldReads.set(resolve(settingsPath), 1);
    heldRenames.set(resolve(keybindingsPath), PERMANENT);

    const res = await service.resetEverything();

    expect(res.ok).toBe(false);
    expect(existsSync(settingsPath)).toBe(true);
    expect(readFileSync(settingsPath, 'utf8')).toBe(before.settings);
    expect(readFileSync(keybindingsPath, 'utf8')).toBe(before.keybindings);
  });

  it('a hold that outlasts the snapshot read: the reset fails before writing anything', async () => {
    const { settingsPath, keybindingsPath, before, service } = await customisedRoot();
    heldReads.set(resolve(settingsPath), PERMANENT);

    const res = await service.resetEverything();

    expect(res).toMatchObject({ ok: false, failedPath: settingsPath });
    expect(existsSync(settingsPath)).toBe(true);
    expect(readFileSync(settingsPath, 'utf8')).toBe(before.settings);
    expect(readFileSync(keybindingsPath, 'utf8')).toBe(before.keybindings);
  });
});
