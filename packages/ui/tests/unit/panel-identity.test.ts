import { describe, it, expect } from 'vitest';
import { PanelIdentityRegistry } from '../../src/main/panel-identity.js';

/**
 * 029 FR-013 / FR-013a — naming the panel that holds a folder, across more than one window.
 *
 * The interesting cases here are all about MULTIPLE WINDOWS, because the single-window case is a map
 * lookup and cannot go wrong. Two things can:
 *
 *   • one window's publication erasing another's, which turns a nameable panel into
 *     "throng could not identify which panel" for no reason the user could ever guess;
 *   • naming the sub-workspace when the user is already looking at it, which is noise dressed as
 *     orientation.
 */

const MAIN = 1;
const SUB = 2;

describe('PanelIdentityRegistry (029 FR-013)', () => {
  it('keeps each window’s panels — a second window must not erase the first', () => {
    const reg = new PanelIdentityRegistry();
    reg.publish(MAIN, 'throng', [{ panelId: 'a', panelTitle: 'Build' }]);
    reg.publish(SUB, 'Deploy', [{ panelId: 'b', panelTitle: 'Logs' }]);

    const all = reg.identities(MAIN);

    // The defect this pins: a flat map cleared on every publish leaves only `b`, and panel `a`
    // becomes unnameable the moment a sub-workspace exists.
    expect(all.get('a')?.panelTitle).toBe('Build');
    expect(all.get('b')?.panelTitle).toBe('Logs');
  });

  it('names the OTHER window and stays quiet about the reporting one (FR-013a)', () => {
    const reg = new PanelIdentityRegistry();
    reg.publish(MAIN, 'throng', [{ panelId: 'a', panelTitle: 'Build' }]);
    reg.publish(SUB, 'Deploy', [{ panelId: 'b', panelTitle: 'Logs' }]);

    const asMain = reg.identities(MAIN);

    // "The terminal Build" — the user is looking at that window, so saying which window it is adds
    // a clause and no information.
    expect(asMain.get('a')?.windowTitle).toBeUndefined();
    // "The terminal Logs, in the sub-workspace Deploy" — here it is the whole point.
    expect(asMain.get('b')?.windowTitle).toBe('Deploy');
  });

  it('is symmetric — the same panel is "elsewhere" or not depending on who asks', () => {
    const reg = new PanelIdentityRegistry();
    reg.publish(MAIN, 'throng', [{ panelId: 'a', panelTitle: 'Build' }]);
    reg.publish(SUB, 'Deploy', [{ panelId: 'b', panelTitle: 'Logs' }]);

    const asSub = reg.identities(SUB);

    // The mirror image of the test above. Asserted because a registry that simply flagged
    // "sub-workspaces get a window title" would pass that one and fail this.
    expect(asSub.get('b')?.windowTitle).toBeUndefined();
    expect(asSub.get('a')?.windowTitle).toBe('throng');
  });

  it('reports a window as new exactly once, so teardown is subscribed once', () => {
    const reg = new PanelIdentityRegistry();

    // The renderer republishes on every layout change — a panel renamed, moved, added. A caller that
    // attached a `closed` listener per message would accumulate them for the life of the window and
    // trip Node's max-listeners warning, which then gets diagnosed as something else entirely.
    expect(reg.publish(MAIN, 'throng', [{ panelId: 'a', panelTitle: 'Build' }])).toBe(true);
    expect(reg.publish(MAIN, 'throng', [{ panelId: 'a', panelTitle: 'Build' }])).toBe(false);
    expect(reg.publish(SUB, 'Deploy', [])).toBe(true);

    // And a window that closed and came back is new again — its teardown was consumed.
    reg.forget(MAIN);
    expect(reg.publish(MAIN, 'throng', [])).toBe(true);
  });

  it('replaces a window’s own panels rather than accumulating them', () => {
    const reg = new PanelIdentityRegistry();
    reg.publish(MAIN, 'throng', [{ panelId: 'a', panelTitle: 'Build' }]);
    reg.publish(MAIN, 'throng', [{ panelId: 'a', panelTitle: 'Build (renamed)' }]);

    // A window is authoritative about itself: a closed or renamed panel must not linger under its
    // old title, or the notice names something the user cannot find.
    expect(reg.identities(MAIN).get('a')?.panelTitle).toBe('Build (renamed)');
    expect(reg.identities(MAIN).size).toBe(1);
  });

  it('forgets a window that has closed, rather than naming panels that are gone', () => {
    const reg = new PanelIdentityRegistry();
    reg.publish(MAIN, 'throng', [{ panelId: 'a', panelTitle: 'Build' }]);
    reg.publish(SUB, 'Deploy', [{ panelId: 'b', panelTitle: 'Logs' }]);

    reg.forget(SUB);

    expect(reg.identities(MAIN).has('b')).toBe(false);
    expect(reg.identities(MAIN).has('a')).toBe(true);
  });

  it('names no window at all when the caller has none', () => {
    const reg = new PanelIdentityRegistry();
    reg.publish(SUB, 'Deploy', [{ panelId: 'b', panelTitle: 'Logs' }]);

    // A caller with no window (a background path) gets the single-window answer rather than every
    // panel labelled as being somewhere else, which would be true and useless.
    expect(reg.identities().get('b')?.windowTitle).toBeUndefined();
  });

  it('ignores malformed entries instead of publishing an undefined title', () => {
    const reg = new PanelIdentityRegistry();
    reg.publish(MAIN, 'throng', [
      { panelId: 'a', panelTitle: 'Build' },
      { panelId: 'b' } as unknown as { panelId: string; panelTitle: string },
    ]);

    // The list crosses IPC from a sandboxed renderer, so it is input. A half-formed entry that got
    // through would surface as the string "undefined" inside a sentence shown to the user.
    expect(reg.identities(MAIN).size).toBe(1);
    expect(reg.identities(MAIN).has('b')).toBe(false);
  });
});
