import { describe, it, expect, vi } from 'vitest';
import type { Disposable, IFileWatcher } from '@throng/core';
import { TerminalReconnect } from '../../src/main/terminal-reconnect.js';

/*
 * 039 US3 (#237) — the main-process half: arming, batching, releasing and disposing watches.
 *
 * At the unit layer with a fake watcher and a fake filesystem, because every rule worth testing here
 * is about WHICH watches exist and WHEN they fire — not about whether Node's watcher works. Driving
 * a real filesystem event through Electron would test chokidar and prove nothing about this class.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * `fire()` throws if nothing is watching the directory it names. A test that armed nothing, or armed
 * the wrong path, therefore fails loudly instead of passing because no callback ran.
 */
function harness(existing: Set<string>) {
  const watched = new Map<string, () => void>();
  const disposed: string[] = [];
  const fileWatcher: IFileWatcher = {
    watch: (dir, onChange): Disposable => {
      watched.set(dir, () => onChange(dir));
      return {
        dispose: () => {
          disposed.push(dir);
          watched.delete(dir);
        },
      };
    },
  };
  const notify = vi.fn<(ids: string[]) => void>();
  const reconnect = new TerminalReconnect({
    fileWatcher,
    exists: (p) => existing.has(p),
    parentOf: (p) => {
      const i = p.lastIndexOf('/');
      return i <= 0 ? null : p.slice(0, i);
    },
    notify,
  });
  return {
    reconnect,
    notify,
    disposed,
    watchedDirs: (): string[] => [...watched.keys()],
    fire: (dir: string): void => {
      const cb = watched.get(dir);
      if (!cb) throw new Error(`nothing is watching ${dir} — the test armed nothing, or armed elsewhere`);
      cb();
    },
  };
}

describe('TerminalReconnect — arming (039 FR-030)', () => {
  it('watches the nearest EXISTING ancestor when the target is gone', () => {
    const h = harness(new Set(['C:/dev']));
    h.reconnect.arm('p1', 'A', 'C:/dev/proj/src');
    // Not `C:/dev/proj/src` — you cannot watch a directory that is not there, and the whole premise
    // is that it is not there.
    expect(h.watchedDirs()).toEqual(['C:/dev']);
  });

  it('places ONE watch for many panels resolving to the same directory (FR-033)', () => {
    const h = harness(new Set(['C:/dev']));
    h.reconnect.arm('p1', 'A', 'C:/dev/proj/src');
    h.reconnect.arm('p2', 'A', 'C:/dev/proj/lib');
    h.reconnect.arm('p3', 'A', 'C:/dev/proj');
    // Every terminal in a project whose root went away resolves to the same ancestor. N watches on
    // one directory would fire N times for one rename, which is how a per-panel notice happens.
    expect(h.watchedDirs()).toEqual(['C:/dev']);
  });

  it('arms nothing when no ancestor exists — ↻ Retry stays the route back (FR-039)', () => {
    const h = harness(new Set());
    h.reconnect.arm('p1', 'A', 'Z:/gone/deeper');
    expect(h.watchedDirs()).toEqual([]);
  });

  it('re-arming a panel replaces its entry rather than adding a second', () => {
    const h = harness(new Set(['C:/dev']));
    h.reconnect.arm('p1', 'A', 'C:/dev/proj/src');
    h.reconnect.arm('p1', 'A', 'C:/dev/proj/src');
    h.reconnect.disarm('p1');
    // One disarm must be enough. If arming twice had queued two entries, the watch would survive
    // here and the panel would be retried by a directory it is no longer waiting on.
    expect(h.watchedDirs()).toEqual([]);
  });
});

describe('TerminalReconnect — releasing (039 FR-030/FR-032/FR-033/FR-037)', () => {
  it('releases every waiting panel in one notification, not one each (FR-032, FR-033)', () => {
    const existing = new Set(['C:/dev']);
    const h = harness(existing);
    h.reconnect.arm('p1', 'A', 'C:/dev/proj/src');
    h.reconnect.arm('p2', 'A', 'C:/dev/proj/lib');
    h.reconnect.arm('p3', 'A', 'C:/dev/proj');

    // The folder is renamed back: every target resolves again, in one filesystem moment.
    for (const p of ['C:/dev/proj', 'C:/dev/proj/src', 'C:/dev/proj/lib']) existing.add(p);
    h.fire('C:/dev');

    // ONE call carrying all three. FR-033 forbids a notice per recovered panel, and the SHAPE of the
    // callback is what makes that achievable — a per-panel callback would push batching onto whoever
    // consumes it, and the first consumer to forget would ship three notices.
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0]![0].sort()).toEqual(['p1', 'p2', 'p3']);
  });

  /*
   * FR-037 / Principle I. Two projects under one parent — a monorepo, `C:/dev/*` — watch the SAME
   * directory. Without the project filter, restoring one would start the other's terminals.
   */
  /*
   * BOTH targets are missing at arm time, which is the only way a panel ever reaches the arming
   * path. The first version of this test pre-created project A's directory — so A watched its own
   * folder rather than the shared parent, and the event under test never reached it.
   *
   * It passed. It would have kept passing however broken the project isolation was, because the
   * assertion was never reached by the code it was aimed at.
   *
   *   A FIXTURE DESCRIBING AN IMPOSSIBLE STATE IS A TEST THAT CANNOT FAIL, AND IT LOOKS IDENTICAL
   *   TO A PASSING ONE FROM EVERY ANGLE EXCEPT THE FIXTURE.
   *
   * Which is the part nobody re-reads. Worth remembering next time an assertion looks right and the
   * setup looks boring.
   */
  it('does not cross projects, even sharing one watched directory (FR-037)', () => {
    const existing = new Set(['C:/dev']);
    const h = harness(existing);
    h.reconnect.arm('a1', 'A', 'C:/dev/a/src');
    h.reconnect.arm('b1', 'B', 'C:/dev/b/src');
    expect(h.watchedDirs()).toEqual(['C:/dev']); // one watch, shared by two projects

    // Only project A's folder comes back.
    existing.add('C:/dev/a/src');
    h.fire('C:/dev');

    const released = h.notify.mock.calls.flatMap((c) => c[0]);
    expect(released).toContain('a1');
    expect(released).not.toContain('b1');
    // B is still waiting, so the shared watch must survive its neighbour's recovery.
    expect(h.watchedDirs()).toEqual(['C:/dev']);
  });

  it('does not release when the ancestor changed but the target is still missing (FR-035)', () => {
    const h = harness(new Set(['C:/dev']));
    h.reconnect.arm('p1', 'A', 'C:/dev/proj/src');
    // An unrelated sibling folder appeared under C:/dev. The target is still gone.
    h.fire('C:/dev');
    expect(h.notify).not.toHaveBeenCalled();
  });

  /*
   * FR-030 — bounded. One retry per failure, not a loop. The entry is removed BEFORE the caller is
   * told, so a notify that synchronously drove a restart which failed again cannot re-enter against
   * an entry still in the list.
   */
  it('releases a panel at most once — the second event finds nothing (FR-030)', () => {
    const existing = new Set(['C:/dev']);
    const h = harness(existing);
    h.reconnect.arm('p1', 'A', 'C:/dev/proj/src');
    existing.add('C:/dev/proj/src');
    h.fire('C:/dev');
    expect(h.notify).toHaveBeenCalledTimes(1);
    // The watch is gone with the last panel that needed it, so there is nothing left to fire.
    expect(h.watchedDirs()).toEqual([]);
  });
});

describe('TerminalReconnect — disposal (039 FR-042)', () => {
  it('drops the watch when its last panel disarms', () => {
    const h = harness(new Set(['C:/dev']));
    h.reconnect.arm('p1', 'A', 'C:/dev/proj/src');
    h.reconnect.arm('p2', 'A', 'C:/dev/proj/lib');
    h.reconnect.disarm('p1');
    // Still one panel waiting — removing the watch here would strand it.
    expect(h.watchedDirs()).toEqual(['C:/dev']);
    h.reconnect.disarm('p2');
    expect(h.watchedDirs()).toEqual([]);
    expect(h.disposed).toContain('C:/dev');
  });

  it('disarms a whole project when it closes, leaving other projects watching', () => {
    const h = harness(new Set(['C:/dev']));
    h.reconnect.arm('a1', 'A', 'C:/dev/a/src');
    h.reconnect.arm('b1', 'B', 'C:/dev/b/src');
    h.reconnect.disarmProject('A');
    // B is still waiting, so the shared watch must survive.
    expect(h.watchedDirs()).toEqual(['C:/dev']);
    h.reconnect.disarmProject('B');
    expect(h.watchedDirs()).toEqual([]);
  });

  it('disposes everything on shutdown', () => {
    const h = harness(new Set(['C:/dev', 'D:/other']));
    h.reconnect.arm('p1', 'A', 'C:/dev/proj/src');
    h.reconnect.arm('p2', 'B', 'D:/other/proj/src');
    h.reconnect.dispose();
    expect(h.watchedDirs()).toEqual([]);
    expect(h.disposed.sort()).toEqual(['C:/dev', 'D:/other']);
  });

  it('disarming an unknown panel is a no-op, not a throw', () => {
    const h = harness(new Set(['C:/dev']));
    expect(() => h.reconnect.disarm('never-armed')).not.toThrow();
  });
});
