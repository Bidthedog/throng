/**
 * macOS's `open-file` (070 FR-024, research R19): a folder dropped on the Dock icon or opened with Finder's Open With
 * reaches throng as an `open-file` event, running or not. A directory joins the open-folder queue (067); a file is
 * ignored, since throng opens folders as projects.
 */
import { describe, expect, it, vi } from 'vitest';
import { openFileHandler } from '../../src/main/open-file.js';

function setup(kinds: Record<string, 'folder' | 'file' | 'missing'>) {
  const push = vi.fn();
  const bringForward = vi.fn();
  const handler = openFileHandler({ kindOf: (p) => kinds[p] ?? 'missing', push, bringForward });
  const event = { preventDefault: vi.fn() };
  return { handler, push, bringForward, event };
}

describe('openFileHandler', () => {
  it('queues a folder and brings throng forward', () => {
    const { handler, push, bringForward, event } = setup({ '/Users/me/code/app': 'folder' });
    handler(event, '/Users/me/code/app');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/Users/me/code/app');
    expect(bringForward).toHaveBeenCalledTimes(1);
  });

  it('ignores a file, and a path that is gone, but still claims the event so macOS shows no error', () => {
    const { handler, push, bringForward, event } = setup({ '/Users/me/notes.txt': 'file' });
    handler(event, '/Users/me/notes.txt');
    handler(event, '/Users/me/gone');
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
    expect(bringForward).not.toHaveBeenCalled();
  });
});
