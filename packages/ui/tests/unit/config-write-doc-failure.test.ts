import { describe, expect, it, vi } from 'vitest';
import type { IConfigStore, WriteOutcome } from '@throng/core';

// `config-write-ipc.ts` imports `ipcMain` at module load; `writeConfigDoc` itself never touches it.
vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }));

const { writeConfigDoc } = await import('../../src/main/config-write-ipc.js');

/**
 * Issue #75 — `writeConfigDoc` reports what the store did, never `{ok:true}` of its own accord.
 *
 * It used to hardcode success, so a write that never reached disk was announced as applied: the
 * renderer showed the new value and the edit was gone. The store's own failure (a real failing
 * rename) is asserted in config-store-retry-exhaustion.test.ts; this proves the wrapper passes the
 * store's outcome through, with a fake store so it costs no retry budget.
 */
function fakeStore(outcome: WriteOutcome): IConfigStore {
  return {
    pathOf: (id: { kind: string }) => `C:\\cfg\\${id.kind}.json`,
    write: async () => outcome,
  } as unknown as IConfigStore;
}

describe('writeConfigDoc', () => {
  it('reports the failure instead of claiming success when the store cannot write', async () => {
    const result = await writeConfigDoc(
      fakeStore({ ok: false, error: 'It is a folder.', detail: 'EPERM' }),
      { kind: 'settings' },
      '{"editor":{"autoSaveDebounceMs":1500}}',
    );

    expect(result, "the store's failure is returned as it is, never replaced by ok:true").toEqual({
      ok: false,
      error: 'It is a folder.',
      detail: 'EPERM',
    });
  });

  it('reports success when the store wrote', async () => {
    const result = await writeConfigDoc(fakeStore({ ok: true }), { kind: 'settings' }, '{}');

    expect(result, 'the control: a store that wrote is reported as having written').toEqual({ ok: true });
  });
});
