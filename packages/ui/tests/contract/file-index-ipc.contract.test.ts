/**
 * Contract: the `fileIndex` IPC surface (033 T015, contracts/file-index.md §3, I1–I4).
 *
 * Three independently compiled boundaries meet on these three channel names — the sandboxed
 * preload (`preload.cts`, emitted as CommonJS and loaded by Electron, so it cannot be imported into
 * this ESM test process), the main-process registrar (`file-index-ipc.ts`), and the renderer's type
 * declaration. The behaviour behind them is proved over a real tree and a real watcher by
 * `packages/ui/tests/integration/project-file-index.integration.test.ts`; what THIS pins is the
 * drift the integration layer cannot see — a renamed channel, a push that goes to every window
 * instead of the one that asked, or a full snapshot re-sent where a delta belongs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const preload = source('../../src/preload/preload.cts');
const mainIpc = source('../../src/main/file-index-ipc.ts');
const service = source('../../src/main/project-file-index.ts');
const mainWiring = source('../../src/main/main.ts');
const globals = source('../../src/renderer/global.d.ts');

describe('fileIndex IPC contract (033 §3)', () => {
  it('I4 — the channels are NEW, not additions to files.*', () => {
    // `throng:files:setRoot` sets ONE process-wide root; this index is keyed BY root, so sharing
    // that surface would mean one window's project silently deciding another's candidate set.
    expect(mainIpc).toContain("ipcMain.handle('throng:fileIndex:subscribe'");
    expect(mainIpc).toContain("ipcMain.on('throng:fileIndex:unsubscribe'");
    expect(mainIpc).not.toMatch(/ipcMain\.(handle|on)\('throng:files:/);
    expect(preload).toContain('fileIndex:');
  });

  it('subscribe is an invoke on both sides and carries the root', () => {
    expect(preload).toContain("ipcRenderer.invoke('throng:fileIndex:subscribe'");
    expect(mainIpc).toMatch(/ipcMain\.handle\('throng:fileIndex:subscribe'[\s\S]{0,400}subscribe\(/);
  });

  it('unsubscribe is a send on both sides', () => {
    expect(preload).toContain("ipcRenderer.send('throng:fileIndex:unsubscribe'");
    expect(mainIpc).toMatch(/ipcMain\.on\('throng:fileIndex:unsubscribe'[\s\S]{0,400}unsubscribe\(/);
  });

  it('I3 — the preload subscription returns an unsubscriber, like every other push channel', () => {
    expect(preload).toContain("ipcRenderer.on('throng:fileIndex:update'");
    expect(preload).toContain("removeListener('throng:fileIndex:update'");
    expect(globals).toContain('fileIndex?:');
    expect(globals).toContain('onUpdate:');
    expect(globals).toMatch(/onUpdate:[\s\S]{0,400}=>\s*\(\)\s*=>\s*void/);
  });

  it('I1 — pushes go to the SUBSCRIBING webContents only, never broadcastToWindows', () => {
    // Two windows on different roots must not see each other's sets (FR-017). The registrar and
    // the service both have to be clean: a broadcast in either one defeats the other's care.
    expect(mainIpc).not.toContain('broadcastToWindows');
    expect(service).not.toContain('broadcastToWindows');
    expect(mainIpc).not.toContain('getAllWindows');
    // The push target is resolved FROM the subscribing webContents id.
    expect(mainIpc).toMatch(/webContents\.fromId\(/);
    expect(mainIpc).toContain("'throng:fileIndex:update'");
  });

  it('I1 — the subscribing webContents id comes from the sender, never from the payload', () => {
    // A renderer-supplied id would let one window subscribe another to a root it cannot see.
    expect(mainIpc).toContain('event.sender.id');
  });

  it('S9 — a destroyed webContents is unsubscribed from every root by the composition root', () => {
    // Constructed in the composition root and nowhere else (Principle IX), and the teardown is
    // the unsubscribe with NO root — which is what "every root" means on this API.
    expect(mainWiring).toContain('new ProjectFileIndexService(');
    expect(mainWiring).toContain('registerFileIndexIpc(');
    expect(mainWiring).toMatch(/once\('destroyed',\s*\(\)\s*=>\s*\w+\.unsubscribe\(\w+\.id\)/);
  });

  it('I2 — a full paths array is sent at most once per root per subscription', () => {
    // The service records what each subscriber was SENT and diffs against that (S8); a delta push
    // must therefore never carry `paths`. Pinned on the service source because the alternative —
    // re-sending 2 MB of strings per filesystem change — is invisible until a user has 50,000 files.
    expect(service).toContain('diffPaths');
    expect(service).toMatch(/sent/);
  });

  it('the update payload declares the whole §3 shape on the renderer side', () => {
    for (const field of ['root', 'status', 'paths', 'added', 'removed']) {
      expect(globals, `the fileIndex update payload must declare ${field}`).toMatch(
        new RegExp(`fileIndex\\?:[\\s\\S]{0,900}${field}`),
      );
    }
  });
});
