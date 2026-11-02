import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, DEFAULT_KEYBINDINGS, buildShippedDefaults } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

/**
 * Single-item resets (010, US3/US4). The positive paths (one binding, one leaf, reset everything) are
 * proven through the channel in reset-ipc.test.ts, which is a one-line pass-through to this service;
 * what only the service can show is that a refusal writes NOTHING.
 */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-reset-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SHIPPED = buildShippedDefaults();
function makeService(root: string): { store: FileConfigStore; service: ShippedDefaultsService } {
  const store = new FileConfigStore(root);
  return { store, service: new ShippedDefaultsService(store, SHIPPED) };
}

describe('ShippedDefaultsService.resetBinding', () => {
  it('reports no-default for an unknown action and writes nothing', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await store.write({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS);
    const before = readFileSync(join(root, 'keybindings.json'), 'utf8');
    const res = await service.resetBinding('no.such.action');
    expect(res).toEqual({ ok: false, reason: 'no-default' });
    expect(readFileSync(join(root, 'keybindings.json'), 'utf8')).toBe(before);
  });
});

describe('ShippedDefaultsService.resetSetting', () => {
  it('reports no-default for an unknown path and writes nothing', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await store.write({ kind: 'settings' }, DEFAULT_APP_SETTINGS);
    const before = readFileSync(join(root, 'settings.json'), 'utf8');
    const res = await service.resetSetting('editor.doesNotExist');
    expect(res).toEqual({ ok: false, reason: 'no-default' });
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(before);
  });
});
