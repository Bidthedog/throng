/**
 * Whether this copy was installed rather than unpacked from an archive (067 FR-036), on macOS too (070 FR-005,
 * research R12/R32): an app in `/Applications` or `~/Applications` is installed; one run from Downloads or a mounted
 * disk image is not. Before 070 darwin fell through to the Windows check.
 */
import { describe, expect, it } from 'vitest';
import { isInstalledCopy } from '../../src/main/installed-copy.js';

const HOME = { HOME: '/Users/me' };
const exe = (app: string): string => `${app}/throng.app/Contents/MacOS/throng`;

describe('isInstalledCopy on macOS', () => {
  it('is installed under /Applications or the user’s own Applications folder', () => {
    expect(isInstalledCopy(exe('/Applications'), 'darwin', true, HOME)).toBe(true);
    expect(isInstalledCopy(exe('/Users/me/Applications'), 'darwin', true, HOME)).toBe(true);
  });

  it('is not installed anywhere else, nor under a folder that merely starts with the same letters', () => {
    expect(isInstalledCopy(exe('/Users/me/Downloads'), 'darwin', true, HOME)).toBe(false);
    expect(isInstalledCopy(exe('/Volumes/throng 1.0'), 'darwin', true, HOME)).toBe(false);
    expect(isInstalledCopy(exe('/ApplicationsOld'), 'darwin', true, HOME)).toBe(false);
    expect(isInstalledCopy(exe('/Users/me/Applications'), 'darwin', true, {})).toBe(false);
  });

  it('is never installed unpackaged', () => {
    expect(isInstalledCopy(exe('/Applications'), 'darwin', false, HOME)).toBe(false);
  });
});

describe('isInstalledCopy on Linux is unchanged (FR-039)', () => {
  it('is installed under /opt/throng-versions only', () => {
    expect(isInstalledCopy('/opt/throng-versions/1.0.0/throng', 'linux', true, HOME)).toBe(true);
    expect(isInstalledCopy('/home/me/throng/throng', 'linux', true, HOME)).toBe(false);
  });
});
