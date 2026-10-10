/**
 * Contract (054 T022): `throng:preview:toggleTask` (contracts/preview-ipc-054.md).
 *
 * Driven through the handler `registerPreviewIpc` registers, on a fake `ipcMain`: what reaches the
 * toggle service, the validation that refuses malformed input as `io` without reaching it, and that a
 * throw comes back as a value. The service behind the wire is `task-toggle.integration.test.ts`'s.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TaskToggleRequest, TaskToggleResponse } from '@throng/core';
import { registerPreviewIpc, type PreviewIpcMain, type PreviewIpcService } from '../../src/main/preview-ipc.js';

type Listener = (event: unknown, payload: unknown) => unknown;

function wire(toggle: (req: TaskToggleRequest) => Promise<TaskToggleResponse>): Listener {
  const handles = new Map<string, Listener>();
  const ipc: PreviewIpcMain = {
    handle: (channel, listener) => void handles.set(channel, listener as Listener),
    on: () => {},
  };
  registerPreviewIpc(ipc, {} as PreviewIpcService, { toggle });
  return handles.get('throng:preview:toggleTask') as Listener;
}

const event = { sender: { id: 1 } };
const VALID = { panelId: 'pv', filePath: 'D:/p/a.md', line: 3, expectChecked: false, itemText: 'buy milk' };

describe('throng:preview:toggleTask', () => {
  it('forwards a well-formed request exactly and returns the answer', async () => {
    const seen: TaskToggleRequest[] = [];
    const handler = wire(async (req) => {
      seen.push(req);
      return { ok: true, savedToDisk: false };
    });
    expect(await handler(event, { ...VALID, extra: 'dropped' })).toEqual({ ok: true, savedToDisk: false });
    expect(seen).toEqual([VALID]);
  });

  it.each([
    ['no panelId', { ...VALID, panelId: '' }],
    ['no filePath', { ...VALID, filePath: 7 }],
    ['a negative line', { ...VALID, line: -1 }],
    ['a fractional line', { ...VALID, line: 1.5 }],
    ['a line past 1,000,000', { ...VALID, line: 1_000_001 }],
    ['a non-boolean expectChecked', { ...VALID, expectChecked: 'false' }],
    ['a non-string itemText', { ...VALID, itemText: null }],
    ['an itemText over 1 KiB', { ...VALID, itemText: 'x'.repeat(1025) }],
    ['an occurrence index past its count', { ...VALID, occurrence: { index: 2, of: 2 } }],
    ['a non-integer occurrence', { ...VALID, occurrence: { index: 0.5, of: 2 } }],
    ['an occurrence that is not an object', { ...VALID, occurrence: 3 }],
    ['no payload', undefined],
  ])('refuses %s as io without calling the service', async (_name, payload) => {
    let called = false;
    const handler = wire(async () => {
      called = true;
      return { ok: true, savedToDisk: true };
    });
    expect(await handler(event, payload)).toEqual({ ok: false, reason: 'io' });
    expect(called).toBe(false);
  });

  it('forwards a valid occurrence (FR-027)', async () => {
    const seen: TaskToggleRequest[] = [];
    const handler = wire(async (req) => {
      seen.push(req);
      return { ok: true, savedToDisk: true };
    });
    await handler(event, { ...VALID, occurrence: { index: 1, of: 2 } });
    expect(seen).toEqual([{ ...VALID, occurrence: { index: 1, of: 2 } }]);
  });

  it('accepts an empty itemText and line 0', async () => {
    const handler = wire(async () => ({ ok: true, savedToDisk: true }));
    expect(await handler(event, { ...VALID, line: 0, itemText: '' })).toEqual({ ok: true, savedToDisk: true });
  });

  it('answers a throwing service with io rather than a rejection', async () => {
    const handler = wire(async () => {
      throw new Error('boom');
    });
    expect(await handler(event, VALID)).toEqual({ ok: false, reason: 'io' });
  });

  it('the preload and the renderer declaration expose it', () => {
    const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    expect(read('../../src/preload/preload.cts')).toContain("ipcRenderer.invoke('throng:preview:toggleTask'");
    expect(read('../../src/renderer/global.d.ts')).toMatch(
      /toggleTask: \(\s*request: import\('@throng\/core'\)\.TaskToggleRequest,\s*\) => Promise<import\('@throng\/core'\)\.TaskToggleResponse>/,
    );
  });
});
