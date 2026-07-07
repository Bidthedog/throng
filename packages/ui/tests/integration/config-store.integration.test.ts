/**
 * Integration tests for the UI-main {@link FileConfigStore} (T033 / contract
 * os-config-store.md). Runs the shared IConfigStore contract suite against the
 * real filesystem (temp dir) plus first-run / path-layout assertions.
 */
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { runConfigStoreContract } from '@throng/core/testing';
import type { ConfigDocId } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';

const made: string[] = [];
function tempRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  made.push(d);
  return d;
}
afterEach(() => {
  while (made.length) rmSync(made.pop() as string, { recursive: true, force: true });
});

runConfigStoreContract('FileConfigStore', async () => {
  const store = new FileConfigStore(tempRoot());
  return {
    store,
    async seedRaw(doc: ConfigDocId, raw: string) {
      const p = store.pathOf(doc);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, raw, 'utf8');
    },
  };
});

describe('FileConfigStore first-run + layout', () => {
  it('creates the defaults file on disk when it is absent', async () => {
    const store = new FileConfigStore(tempRoot());
    const doc: ConfigDocId = { kind: 'settings' };
    expect(existsSync(store.pathOf(doc))).toBe(false);

    const defaults = { version: 1 };
    const read = await store.read(doc, defaults, (r) => (r as typeof defaults) ?? defaults);
    expect(read).toEqual(defaults);
    expect(existsSync(store.pathOf(doc))).toBe(true);
    expect(JSON.parse(readFileSync(store.pathOf(doc), 'utf8'))).toEqual(defaults);
  });

  it('leaves a malformed file intact for the user (no overwrite)', async () => {
    const root = tempRoot();
    const store = new FileConfigStore(root);
    const doc: ConfigDocId = { kind: 'settings' };
    mkdirSync(root, { recursive: true });
    writeFileSync(store.pathOf(doc), '{ broken', 'utf8');

    await store.read(doc, { version: 1 }, (r) => r as { version: number });
    expect(readFileSync(store.pathOf(doc), 'utf8')).toBe('{ broken'); // untouched
  });

  it('places settings/keybindings at the root and themes under themes/', () => {
    const root = tempRoot();
    const store = new FileConfigStore(root);
    expect(store.pathOf({ kind: 'settings' })).toBe(join(root, 'settings.json'));
    expect(store.pathOf({ kind: 'keybindings' })).toBe(join(root, 'keybindings.json'));
    expect(store.pathOf({ kind: 'theme', name: 'throng' })).toBe(join(root, 'themes', 'throng.json'));
  });
});
