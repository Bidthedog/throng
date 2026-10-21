/**
 * ISystemNotifier (057, contracts/app-attention.md): the no-op and the recording fake the E2E harness
 * ships in place of Electron's `Notification` (which cannot be observed from Playwright) both satisfy
 * the seam. The real Electron notifier is a thin adapter over `Notification` and is not contract-run
 * here: a native notification cannot be asserted from a unit process.
 */
import { describe, expect, it } from 'vitest';
import { NoSystemNotifier, type ISystemNotifier } from '@throng/core';
import { RecordingSystemNotifier, type OsCall } from '../../src/main/recording-attention-os.js';

const note = { id: 'panel-1', title: 'Build — throng', body: 'finished', kind: 'attention' as const };

describe.each<[string, () => ISystemNotifier]>([
  ['NoSystemNotifier', () => new NoSystemNotifier()],
  ['RecordingSystemNotifier', () => new RecordingSystemNotifier(() => undefined)],
])('%s satisfies ISystemNotifier', (_name, make) => {
  it('shows, replaces and closes without throwing', () => {
    const n = make();
    expect(() => {
      n.show(note);
      n.show({ ...note, body: 'again' });
      n.close(note.id);
    }).not.toThrow();
  });

  it('close of an id that is not shown is a no-op', () => {
    expect(() => make().close('never-shown')).not.toThrow();
  });

  it('accepts a click handler', () => {
    expect(() => make().onClick(() => undefined)).not.toThrow();
  });
});

describe('RecordingSystemNotifier', () => {
  function recorded() {
    const calls: OsCall[] = [];
    return { calls, n: new RecordingSystemNotifier((c) => calls.push(c)) };
  }

  it('records show, then close, in order', () => {
    const { calls, n } = recorded();
    n.show(note);
    n.close(note.id);
    expect(calls).toEqual([
      { target: 'notifier', op: 'show', ...note },
      { target: 'notifier', op: 'close', id: note.id },
    ]);
  });

  it('does not record a close for a notification that is not shown', () => {
    const { calls, n } = recorded();
    n.close('never-shown');
    expect(calls).toEqual([]);
  });

  it('shows one notification per id: a repeat show replaces, a close then drops it', () => {
    const { calls, n } = recorded();
    n.show(note);
    n.show({ ...note, body: 'again' });
    n.close(note.id);
    n.close(note.id);
    expect(calls.filter((c) => c.op === 'close')).toHaveLength(1);
  });

  it('round-trips a click to the registered handler with the id', () => {
    const { n } = recorded();
    const clicked: string[] = [];
    n.onClick((id) => clicked.push(id));
    n.show(note);
    n.activate(note.id);
    expect(clicked).toEqual([note.id]);
  });

  it('ignores a click on a notification that is not shown', () => {
    const { n } = recorded();
    const clicked: string[] = [];
    n.onClick((id) => clicked.push(id));
    n.activate('never-shown');
    expect(clicked).toEqual([]);
  });
});
