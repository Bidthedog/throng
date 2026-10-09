import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureTerminalCommandBridge,
  forgetTerminalCommand,
  peekProgramTitle,
} from '../../src/renderer/terminal/command-store.js';
import { clearTerminalTitle, setTerminalTitle } from '../../src/renderer/terminal/title-store.js';

/**
 * 053 FR-003 — a program that titles itself once, as it starts, keeps that title in the panel's name.
 *
 * Layer: component (jsdom) — the decision is the renderer's command store reading the title store; the bridge the
 * daemon's observations arrive on is stubbed, so the two can be delivered in the order the race produces.
 *
 * Seen 1 run in 9 (MT-11 step 7): `node titler.js` writes its title once and the name stayed `node titler.js | …`.
 * The program's output (its title) and the daemon's observations travel on separate channels. An observation of
 * "nothing running" whose reading was taken just BEFORE the program started can arrive just AFTER its title — and the
 * title was then remembered as the prompt's own, which is never shown as a program's.
 */

const PANEL = 'p-title-race';
let publish: null | ((e: { panelId: string; command: string | null; arch?: string | null; observedAt?: number }) => void);

// The store subscribes to the bridge once per renderer, so the stub is installed once for the file.
beforeAll(() => {
  Reflect.set(window, 'throng', {
    terminal: {
      onCommand: (cb: NonNullable<typeof publish>) => {
        publish = cb;
        return () => {
          publish = null;
        };
      },
    },
  });
  ensureTerminalCommandBridge();
});

beforeEach(() => {
  vi.useFakeTimers({ now: 10_000, toFake: ['Date'] });
});

afterEach(() => {
  forgetTerminalCommand(PANEL);
  clearTerminalTitle(PANEL);
  vi.useRealTimers();
});

describe('053 — a program that titles itself as it starts', () => {
  it('keeps its title when an older "nothing running" reading arrives after it', () => {
    // A reading starts at 10 000 ms, while the shell is still at its prompt…
    const readingStarted = Date.now();
    // …the program starts and titles itself at 10 200 ms…
    vi.setSystemTime(10_200);
    setTerminalTitle(PANEL, 'writing the tests');
    // …and the reading, "nothing running", arrives at 10 300 ms; the next one sees the program.
    vi.setSystemTime(10_300);
    publish!({ panelId: PANEL, command: null, observedAt: readingStarted });
    vi.setSystemTime(11_000);
    publish!({ panelId: PANEL, command: 'node titler.js', observedAt: 10_900 });

    expect(peekProgramTitle(PANEL), "the program's own title was taken for the prompt's").toBe('writing the tests');
  });

  it('control: a title the prompt set before the reading is still the prompt’s, never shown as the program’s', () => {
    setTerminalTitle(PANEL, 'my prompt title');
    vi.setSystemTime(10_100);
    publish!({ panelId: PANEL, command: null, observedAt: 10_050 });
    vi.setSystemTime(11_000);
    publish!({ panelId: PANEL, command: 'node quiet.js', observedAt: 10_900 });

    expect(peekProgramTitle(PANEL)).toBeUndefined();
  });
});
