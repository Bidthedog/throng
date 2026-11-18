// Layer: integration — surviving a restart, and a damaged file, are claims about the file on disk.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRINT_SETTINGS } from '@throng/core';
import { PrintSettingsStore } from '../../src/main/print-settings-store.js';

/** 075 FR-070 — the print settings persist across sessions in `print-settings.json`. */
const PRINTERS = [{ name: 'office', isDefault: true }, { name: 'home' }];

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'throng-print-settings-'));
  path = join(dir, 'print-settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('PrintSettingsStore (FR-070)', () => {
  it('starts from the defaults, with the default printer, when there is no file', async () => {
    expect(await new PrintSettingsStore(path).read(PRINTERS)).toEqual({ ...DEFAULT_PRINT_SETTINGS, printer: 'office' });
  });

  it('reads back, in a new store, what was written — the page range excepted', async () => {
    const chosen = { ...DEFAULT_PRINT_SETTINGS, printer: 'home', pageSize: 'Letter', copies: 2, pages: { all: false, ranges: '2' } } as const;
    await new PrintSettingsStore(path).write(chosen);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(1);
    expect(await new PrintSettingsStore(path).read(PRINTERS)).toEqual({ ...chosen, pages: { all: true } });
  });

  it('survives a damaged file, and the next write repairs it', async () => {
    writeFileSync(path, '{ not json');
    const store = new PrintSettingsStore(path);
    expect(await store.read(PRINTERS)).toEqual({ ...DEFAULT_PRINT_SETTINGS, printer: 'office' });
    await store.write({ ...DEFAULT_PRINT_SETTINGS, printer: 'home' });
    expect((await store.read(PRINTERS)).printer).toBe('home');
  });
});
