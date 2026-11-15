/**
 * Close and quit on macOS (070 FR-028, contracts/app-lifecycle-macos.md *Close and quit*, research R18).
 *
 * Closing the last window leaves throng running in the Dock without the quit flow; Dock activation shows it again;
 * a quit (Cmd+Q, the menu, the Dock, logout) runs the same shutdown the window close runs on Windows and Linux, and
 * only its finish lets the app go.
 */
import { describe, expect, it } from 'vitest';
import { createMacLifecycle } from '../../src/main/mac-lifecycle.js';

describe('the macOS close/quit state machine', () => {
  it('hides the main window on close while no quit is in progress, and runs no quit flow', () => {
    const lc = createMacLifecycle();
    expect(lc.onMainWindowClose()).toBe('hide');
    expect(lc.quitting).toBe(false);
  });

  it('shows the hidden window again on activate, and does nothing when it was not hidden', () => {
    const lc = createMacLifecycle();
    expect(lc.onActivate()).toBe('none');
    lc.onMainWindowClose();
    expect(lc.onActivate()).toBe('show');
    expect(lc.onActivate()).toBe('none');
  });

  it('turns a quit into the shutdown: before-quit is held, and the window close runs the close flow', () => {
    const lc = createMacLifecycle();
    expect(lc.onBeforeQuit()).toBe('start-shutdown');
    expect(lc.quitting).toBe(true);
    expect(lc.onMainWindowClose()).toBe('close-flow');
  });

  it('starts one shutdown however often the quit is asked for', () => {
    const lc = createMacLifecycle();
    expect(lc.onBeforeQuit()).toBe('start-shutdown');
    expect(lc.onBeforeQuit()).toBe('wait');
  });

  it('lets the quit go once the shutdown has finished', () => {
    const lc = createMacLifecycle();
    lc.onBeforeQuit();
    lc.onShutdownFinished();
    expect(lc.onBeforeQuit()).toBe('allow');
    expect(lc.onMainWindowClose()).toBe('close-flow');
  });

  it('keeps running when the shutdown is cancelled: the next close hides, the next quit starts again', () => {
    const lc = createMacLifecycle();
    lc.onBeforeQuit();
    lc.onShutdownCancelled();
    expect(lc.quitting).toBe(false);
    expect(lc.onMainWindowClose()).toBe('hide');
    expect(lc.onBeforeQuit()).toBe('start-shutdown');
  });

  it('a reload during a quit leaves the next Cmd+Q able to start one, and the red button hiding again', () => {
    // The renderer that held the quit prompt is gone (a reload, a crash), so that quit can never finish or be cancelled.
    const lc = createMacLifecycle();
    lc.onBeforeQuit();
    lc.onRendererReloaded();
    expect(lc.quitting).toBe(false);
    expect(lc.onMainWindowClose()).toBe('hide');
    expect(lc.onBeforeQuit()).toBe('start-shutdown');
  });

  it('a reload after the shutdown finished does not take the finished quit back', () => {
    const lc = createMacLifecycle();
    lc.onBeforeQuit();
    lc.onShutdownFinished();
    lc.onRendererReloaded();
    expect(lc.onBeforeQuit()).toBe('allow');
  });

  it('a quit asked for while the window is hidden shows it, so the closing progress is seen', () => {
    const lc = createMacLifecycle();
    lc.onMainWindowClose();
    expect(lc.onBeforeQuit()).toBe('start-shutdown');
    expect(lc.hidden).toBe(false);
  });
});
