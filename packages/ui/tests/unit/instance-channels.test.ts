import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DIFFERENT_COPY_NOTICE_CHANNEL,
  DIFFERENT_COPY_READY_CHANNEL,
} from '../../src/main/instance-notice-channels.js';

/**
 * 058 FR-018 — the different-copy notice's two Electron channels are declared once, in
 * `main/instance-notice-channels.ts`, and main uses the constants. The sandboxed preload cannot
 * import it, so it spells the strings out; this holds the spelling equal, because a mismatch fails
 * silently — the notice is simply never shown. (`ipc-bridge-parity.test.ts` checks the channel is
 * named on both sides; this checks main actually SENDS and LISTENS through the constants.)
 */
const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('different-copy notice channels (058 FR-018)', () => {
  const preload = source('../../src/preload/preload.cts');
  const main = source('../../src/main/main.ts');

  it('the preload listens and announces on exactly the contract channels', () => {
    expect(preload).toContain(`ipcRenderer.on('${DIFFERENT_COPY_NOTICE_CHANNEL}'`);
    expect(preload).toContain(`ipcRenderer.send('${DIFFERENT_COPY_READY_CHANNEL}'`);
  });

  it('main sends and listens through the contract constants', () => {
    expect(main).toMatch(/\.send\(\s*DIFFERENT_COPY_NOTICE_CHANNEL\b/);
    expect(main).toMatch(/ipcMain\.on\(\s*DIFFERENT_COPY_READY_CHANNEL\b/);
  });
});
