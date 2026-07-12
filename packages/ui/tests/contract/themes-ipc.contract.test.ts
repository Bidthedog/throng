import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * Contract: feature 014's theme-restore IPC surface spans two independently
 * compiled boundaries — the sandboxed preload (`preload.cts`, emitted as CommonJS
 * and loaded by Electron, so it cannot be imported into this ESM test process) and
 * the main-process handler registry (`config-write-ipc.ts`). The contract between
 * them is the CHANNEL NAME, and the real failure mode is drift: renaming or
 * mistyping a channel on one side silently breaks the control at runtime.
 *
 * This test pins that parity — every 014 channel must be both INVOKED by the
 * preload bridge and HANDLED by the main registrar. The behaviour behind the
 * channels is verified by the service integration tests (restore-theme.test.ts,
 * shipped-defaults-restore.test.ts) and end-to-end by preferences-themes.e2e.ts.
 */
function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const preload = source('../../src/preload/preload.cts');
const mainIpc = source('../../src/main/config-write-ipc.ts');

/** The channels feature 014 adds, and the bridge method that must invoke each. */
const CHANNELS = [
  { channel: 'throng:config:restoreAllThemes', method: 'restoreAllThemes' },
  { channel: 'throng:config:restoreTheme', method: 'restoreTheme' },
] as const;

describe('theme-restore IPC contract (014)', () => {
  for (const { channel, method } of CHANNELS) {
    it(`preload exposes ${method}() and invokes '${channel}'`, () => {
      expect(preload).toContain(`${method}:`);
      expect(preload).toContain(`ipcRenderer.invoke('${channel}'`);
    });

    it(`main registers a handler for '${channel}'`, () => {
      expect(mainIpc).toContain(`ipcMain.handle('${channel}'`);
    });
  }

  it('the main handlers delegate to feature 010\'s ShippedDefaultsService (no re-implementation)', () => {
    expect(mainIpc).toContain('deps.shippedDefaults.restoreAllThemes()');
    expect(mainIpc).toContain('deps.shippedDefaults.restoreTheme(name)');
  });

  it('the renderer type declaration exposes both methods', () => {
    const globals = source('../../src/renderer/global.d.ts');
    expect(globals).toContain('restoreAllThemes?:');
    expect(globals).toContain('restoreTheme?:');
  });
});
