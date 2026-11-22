/**
 * An OS window opens over every throng window (maintainer, 2026-11-22: "When I click 'Save as PDF', the OS 'Save As'
 * dialog is showing behind the print preview … Any OS windows should show on top of any throng window"). A throng
 * window kept on top (Print Preview, 075 FR-071) would stay above the dialog, so it stands down while the dialog is
 * open and goes back on top once it closes, however the dialog ends.
 */
import { describe, expect, it } from 'vitest';
import { aboveThrong, type LayeredWindow } from '../../src/main/os-dialog-above.js';

function window(onTop: boolean): LayeredWindow & { log: boolean[] } {
  const w = {
    onTop,
    log: [] as boolean[],
    destroyed: false,
    isDestroyed: () => w.destroyed,
    isAlwaysOnTop: () => w.onTop,
    setAlwaysOnTop: (flag: boolean) => {
      w.onTop = flag;
      w.log.push(flag);
    },
  };
  return w;
}

describe('an OS dialog opened from throng', () => {
  it('opens with no throng window on top, and puts back the ones that were', async () => {
    const preview = window(true);
    const main = window(false);
    let duringDialog: boolean[] = [];
    const answer = await aboveThrong([preview, main], () => {
      duringDialog = [preview.isAlwaysOnTop(), main.isAlwaysOnTop()];
      return Promise.resolve('/tmp/out.pdf');
    });
    expect(answer).toBe('/tmp/out.pdf');
    expect(duringDialog).toEqual([false, false]);
    expect(preview.isAlwaysOnTop()).toBe(true);
    expect(main.log).toEqual([]);
  });

  it('puts them back when the dialog fails too', async () => {
    const preview = window(true);
    await expect(aboveThrong([preview], () => Promise.reject(new Error('no portal')))).rejects.toThrow('no portal');
    expect(preview.isAlwaysOnTop()).toBe(true);
  });

  it('leaves alone a window that closed while the dialog was open', async () => {
    const preview = window(true);
    await aboveThrong([preview], () => {
      preview.destroyed = true;
      return Promise.resolve(null);
    });
    expect(preview.log).toEqual([false]);
  });
});
