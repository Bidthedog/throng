import { describe, expect, it } from 'vitest';
import { macosStartupRefusal } from '../../src/macos-simple-services.js';

const INSTALLED = '/Applications/throng.app/Contents/MacOS/throng';
const TRANSLOCATED = '/private/var/folders/ab/T/AppTranslocation/1C2D-3E4F/d/throng.app/Contents/MacOS/throng';
const MOVE = 'Quit throng, drag it to Applications, then open it again.';

describe('macOS startup refusal (070 FR-007, FR-019, research R10, R15)', () => {
  it('refuses root with the shared POSIX words', () => {
    expect(macosStartupRefusal({ uid: 0, execPath: INSTALLED, env: {} })).toMatch(/normal user.*sudo inside a terminal/);
  });

  it('refuses a copy macOS is running from a translocated folder, saying what to do', () => {
    expect(macosStartupRefusal({ uid: 501, execPath: TRANSLOCATED, env: {} })).toBe(MOVE);
  });

  it('refuses through the test seam, so a package check can launch the installed app as if translocated', () => {
    expect(macosStartupRefusal({ uid: 501, execPath: INSTALLED, env: { THRONG_TEST_EXEC_PATH: TRANSLOCATED } })).toBe(MOVE);
  });

  it('cannot be talked out of a refusal by the seam', () => {
    expect(macosStartupRefusal({ uid: 501, execPath: TRANSLOCATED, env: { THRONG_TEST_EXEC_PATH: INSTALLED } })).toBe(MOVE);
  });

  it('refuses nothing else', () => {
    expect(macosStartupRefusal({ uid: 501, execPath: INSTALLED, env: {} })).toBeNull();
    expect(macosStartupRefusal({ uid: 501, execPath: '/Users/dev/throng/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', env: {} })).toBeNull();
    expect(macosStartupRefusal({ uid: undefined, execPath: INSTALLED, env: {} })).toBeNull();
  });
});
