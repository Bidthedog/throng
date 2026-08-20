import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getExplorerCommands,
  registerExplorerCommands,
  unregisterExplorerCommands,
  type ExplorerCommands,
} from '../../src/renderer/explorer/explorer-commands.js';

/**
 * The Files & Folders pane's command registry (024 US3, #85 follow-up).
 *
 * MIGRATED IN PART FROM `fileop-undo.e2e.ts:117` — *"undo works from anywhere in the pane, not only
 * with a row focused"*. That test made a real project on disk, launched Electron, renamed a file
 * through the context menu, clicked the pane's HEADER (inside Files & Folders but not on a row or in
 * the tree), pressed Ctrl+Z, and then polled `existsSync` until the old name came back.
 *
 * ══ WHAT IT WAS ACTUALLY ABOUT ══
 *
 * Not the rename, and not the filesystem. The tree's own keydown handler fires only while a DOM
 * element inside the tree holds focus, and "working in the Files & Folders pane" is broader than
 * that — the toolbar, the pane container after a context-menu action, nowhere in particular after a
 * dialog closed. Ctrl+Z stopped working in exactly those moments, which reads as *undo is
 * unreliable* rather than as *focus is somewhere unexpected*.
 *
 * This module is the fix: the pane registers its commands here, and the WINDOW-level handler
 * dispatches them whenever the active pane is Files & Folders. The E2E's click-the-header was a way
 * of putting focus outside the tree; the registry is what makes that work, and it had no test at any
 * layer.
 *
 * ══ THE GUARD NOTHING ASKED ABOUT ══
 *
 * `unregisterExplorerCommands` clears only its OWN registration, and its comment says why: a project
 * switch MOUNTS the new tree before the old one unmounts, so an unguarded clear on unmount would
 * wipe the live registration and leave Ctrl+Z dead in the new project until something re-registered.
 * That ordering is invisible from an E2E — both trees look the same — and it is the last test below.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 * `fileop-undo.e2e.ts`'s other four tests, which verify a real rename, a real two-step move, a
 * collision refused by the daemon, and a delete undone while an editor holds the file dirty. Those
 * are filesystem claims and they keep their filesystem.
 */

const commands = (undo = vi.fn(), redo = vi.fn()): ExplorerCommands => ({
  undoFileOp: undo,
  redoFileOp: redo,
});

afterEach(() => {
  // Module-level state, shared by every test in the process: a registration left behind would let
  // the next test's `getExplorerCommands()` return a stranger's spy.
  const live = getExplorerCommands();
  if (live) unregisterExplorerCommands(live);
});

describe('the pane publishes its commands for the window-level handler', () => {
  it('starts with nothing registered, so a chord before the pane mounts is a no-op', () => {
    // The window handler calls `getExplorerCommands()?.undoFileOp()`. Null is what makes the `?.`
    // load-bearing, and it is the state before any project is open.
    expect(getExplorerCommands()).toBeNull();
  });

  it('hands back exactly what was registered', () => {
    const undo = vi.fn();
    const c = commands(undo);
    registerExplorerCommands(c);

    expect(getExplorerCommands()).toBe(c);
    getExplorerCommands()?.undoFileOp();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('replaces an earlier registration rather than accumulating', () => {
    // Two panes never coexist, so the registry is a slot and not a list. A registry that appended
    // would fire undo twice per chord after a project switch.
    const first = commands();
    const second = commands();
    registerExplorerCommands(first);
    registerExplorerCommands(second);

    expect(getExplorerCommands()).toBe(second);
  });

  it('clears on unregister, so a chord after the pane unmounts is a no-op again', () => {
    const c = commands();
    registerExplorerCommands(c);
    unregisterExplorerCommands(c);

    expect(getExplorerCommands()).toBeNull();
  });
});

describe('a project switch mounts the new tree BEFORE the old one unmounts', () => {
  it('does not let the outgoing pane wipe the incoming registration', () => {
    /*
     * The whole reason `unregisterExplorerCommands` takes an argument at all.
     *
     * React mounts the replacement before unmounting the original, so the real order is
     * register(new) → unregister(old). An unguarded `current = null` on unmount would clear the NEW
     * pane's registration, and Ctrl+Z would be dead in the project the user just switched to —
     * until something happened to re-register it, which is what makes the symptom intermittent.
     *
     * Invisible from an E2E: both trees render identically, and the failure is a chord that does
     * nothing.
     */
    const outgoingUndo = vi.fn();
    const incomingUndo = vi.fn();
    const outgoing = commands(outgoingUndo);
    const incoming = commands(incomingUndo);

    registerExplorerCommands(outgoing);
    registerExplorerCommands(incoming); // the new tree mounts…
    unregisterExplorerCommands(outgoing); // …and only then does the old one unmount

    expect(getExplorerCommands()).toBe(incoming);

    getExplorerCommands()?.undoFileOp();
    expect(incomingUndo).toHaveBeenCalledTimes(1);
    expect(outgoingUndo).not.toHaveBeenCalled();
  });

  it('still clears when the LAST pane unmounts, in the ordinary order', () => {
    // The other side of the same guard: closing the only project must leave nothing behind, or a
    // chord would call into an unmounted tree's closures.
    const c = commands();
    registerExplorerCommands(c);
    unregisterExplorerCommands(c);

    expect(getExplorerCommands()).toBeNull();
  });
});
