import { describe, expect, it } from 'vitest';
import { parseLaunchFolder } from '../../src/projects/launch-folder.js';

const POSIX_CWD = '/home/u/work';
const WIN_CWD = 'C:\\Users\\u\\work';

describe('parseLaunchFolder (067 FR-022, FR-023, FR-036)', () => {
  it('takes the first positional argument of a packaged launch', () => {
    expect(parseLaunchFolder(['/opt/throng', '/srv/project'], POSIX_CWD, true)).toBe('/srv/project');
  });
  it('resolves a relative path against the launching shell', () => {
    expect(parseLaunchFolder(['/opt/throng', 'sub/dir'], POSIX_CWD, true)).toBe('/home/u/work/sub/dir');
    expect(parseLaunchFolder(['/opt/throng', '.'], POSIX_CWD, true)).toBe('/home/u/work');
    expect(parseLaunchFolder(['/opt/throng', '../other'], POSIX_CWD, true)).toBe('/home/u/other');
  });
  it('resolves against a Windows shell', () => {
    expect(parseLaunchFolder(['C:\\throng.exe', 'sub\\dir'], WIN_CWD, true)).toBe('C:\\Users\\u\\work\\sub\\dir');
    expect(parseLaunchFolder(['C:\\throng.exe', '.'], WIN_CWD, true)).toBe('C:\\Users\\u\\work');
    expect(parseLaunchFolder(['C:\\throng.exe', 'D:\\elsewhere'], WIN_CWD, true)).toBe('D:\\elsewhere');
    expect(parseLaunchFolder(['C:\\throng.exe', '\\\\server\\share'], WIN_CWD, true)).toBe('\\\\server\\share');
  });
  it('skips Chromium and Electron switches', () => {
    expect(parseLaunchFolder(['/opt/throng', '--no-sandbox', '--flag=1', '/srv/p'], POSIX_CWD, true)).toBe('/srv/p');
  });
  it('skips the app entry of a development launch', () => {
    expect(parseLaunchFolder(['/electron', '.', '/srv/p'], POSIX_CWD, false)).toBe('/srv/p');
    expect(parseLaunchFolder(['/electron', '.'], POSIX_CWD, false)).toBeNull();
  });
  it('skips the app entry when a switch comes before it, as npm start passes --ozone-platform', () => {
    const entry = 'packages/ui/dist/main/main.js';
    expect(parseLaunchFolder(['/electron', '--ozone-platform=x11', entry], POSIX_CWD, false)).toBeNull();
    expect(parseLaunchFolder(['/electron', '--ozone-platform=x11', entry, '/srv/p'], POSIX_CWD, false)).toBe('/srv/p');
  });
  it('answers null with no positional argument', () => {
    expect(parseLaunchFolder(['/opt/throng', '--no-sandbox'], POSIX_CWD, true)).toBeNull();
  });
  it('keeps spaces and non-ASCII', () => {
    expect(parseLaunchFolder(['/opt/throng', 'my données/世界'], POSIX_CWD, true)).toBe('/home/u/work/my données/世界');
  });
});
