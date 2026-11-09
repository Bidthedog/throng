import { describe, expect, it, vi } from 'vitest';
import { TerminalOutputRoutes } from '../../src/main/terminal-output-routes.js';

function contents(id: number) {
  const self = {
    id,
    destroyed: false,
    isDestroyed: () => self.destroyed,
    send: vi.fn(),
  };
  return self;
}

const delivery = (panelId: string) => ({ panelId, sessionId: 1, data: 'x', end: 1 });
const CHANNEL = 'throng:terminal:output';

describe('TerminalOutputRoutes (061 FR-001, FR-006, FR-062)', () => {
  it('sends output only to a window showing that terminal', () => {
    const routes = new TerminalOutputRoutes();
    const shows = contents(1);
    const other = contents(2);
    routes.add(shows, 'a', 'v1');
    routes.add(other, 'b', 'v2');

    routes.send(delivery('a'));

    expect(shows.send).toHaveBeenCalledExactlyOnceWith(CHANNEL, delivery('a'));
    expect(other.send).not.toHaveBeenCalled();
  });

  it('sends nothing for a terminal no window shows', () => {
    const routes = new TerminalOutputRoutes();
    const win = contents(1);
    routes.add(win, 'a', 'v1');
    routes.send(delivery('elsewhere'));
    expect(win.send).not.toHaveBeenCalled();
  });

  it('sends once to a window with two views of the terminal, until the last view goes', () => {
    const routes = new TerminalOutputRoutes();
    const win = contents(1);
    routes.add(win, 'a', 'v1');
    routes.add(win, 'a', 'v2');

    routes.send(delivery('a'));
    expect(win.send).toHaveBeenCalledTimes(1);

    routes.remove(win, 'a', 'v1');
    routes.send(delivery('a'));
    expect(win.send).toHaveBeenCalledTimes(2);

    routes.remove(win, 'a', 'v2');
    routes.send(delivery('a'));
    expect(win.send).toHaveBeenCalledTimes(2);
  });

  it('keeps delivering to a mirror when the other window lets go (FR-005)', () => {
    const routes = new TerminalOutputRoutes();
    const first = contents(1);
    const mirror = contents(2);
    routes.add(first, 'a', 'v1');
    routes.add(mirror, 'a', 'v2');

    routes.remove(first, 'a', 'v1');
    routes.send(delivery('a'));

    expect(first.send).not.toHaveBeenCalled();
    expect(mirror.send).toHaveBeenCalledTimes(1);
  });

  it('releases everything a window held when it is destroyed (FR-004)', () => {
    const routes = new TerminalOutputRoutes();
    const win = contents(1);
    routes.add(win, 'a', 'v1');
    routes.add(win, 'b', 'v2');

    routes.releaseWindow(win.id);

    expect(routes.viewsForSubscribe()).toEqual([]);
  });

  it('skips a window already destroyed and keeps delivering to the others', () => {
    const routes = new TerminalOutputRoutes();
    const dying = contents(1);
    const alive = contents(2);
    dying.send.mockImplementation(() => {
      throw new TypeError('Object has been destroyed');
    });
    routes.add(dying, 'a', 'v1');
    routes.add(alive, 'a', 'v2');

    routes.send(delivery('a'));

    expect(alive.send).toHaveBeenCalledTimes(1);
  });

  it('lists every view it routes, for a reconnect (FR-005a)', () => {
    const routes = new TerminalOutputRoutes();
    routes.add(contents(1), 'a', 'v1');
    routes.add(contents(2), 'a', 'v2');
    routes.add(contents(3), 'b');

    expect(routes.viewsForSubscribe()).toEqual([
      { panelId: 'a', viewId: 'v1' },
      { panelId: 'a', viewId: 'v2' },
      { panelId: 'b' },
    ]);
  });
});
