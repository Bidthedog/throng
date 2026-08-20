import { render, renderHook, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTerminalTitle,
  setTerminalTitle,
  useTerminalTitle,
} from '../../src/renderer/terminal/title-store.js';

/**
 * The live terminal-title store (US10, #89) — MIGRATED FROM
 * `packages/ui/tests/e2e/terminal-title-persist.e2e.ts` (035 T055).
 *
 * ══ WHAT THE E2E WAS ACTUALLY ASKING ══
 *
 * It launched Electron, created a project, spawned a real `cmd` shell, waited up to ten seconds for
 * that shell to announce `cmd.exe` over OSC 0/2, added a second tab to force the terminal to
 * UNMOUNT, switched back, and asserted the header still said `cmd.exe`.
 *
 * Every step before the last two is SETUP. The claim is the last one, and it is a claim about this
 * store: the title lives at module scope, outside React, precisely so that a panel's header can be
 * unmounted and remounted without losing what the shell said. A real shell is how the E2E obtained
 * a title; it is not what the test was about.
 *
 * ══ WHAT IS ASSERTED HERE THAT THE E2E COULD NOT REACH ══
 *
 * The store has three rules the E2E never exercised, and two of them are about untrusted PTY output
 * being rendered in the application's own chrome:
 *
 *   - a title is CAPPED at 256 characters, so a program setting a pathological multi-kilobyte title
 *     cannot break the header layout;
 *   - an EMPTY announcement clears the title rather than storing an empty one — which is how a shell
 *     says "I have nothing to say" and must fall back to the panel's own name;
 *   - `clearTerminalTitle` drops it when the terminal is disposed, so a NEW terminal in a recycled
 *     panel id does not inherit the dead one's title.
 *
 * The last is the one worth having: it is the same defect the E2E guards (a header showing the wrong
 * thing after a mount change) pointing the other way, and nothing anywhere asserted it.
 */

const PANEL = 'p1';

/** A header-shaped consumer, so "survives a remount" is asserted through a real render. */
function Header({ panelId }: { panelId: string }): ReactElement {
  const title = useTerminalTitle(panelId);
  return createElement('span', { 'data-testid': 'header' }, title ?? '(no title)');
}

afterEach(() => {
  clearTerminalTitle(PANEL);
  clearTerminalTitle('other');
});

describe('a title announced by the shell', () => {
  it('reaches a header that subscribes to it', () => {
    const { rerender } = render(createElement(Header, { panelId: PANEL }));
    expect(screen.getByTestId('header')).toHaveTextContent('(no title)');

    setTerminalTitle(PANEL, 'C:\\Windows\\system32\\cmd.exe');
    rerender(createElement(Header, { panelId: PANEL }));

    expect(screen.getByTestId('header')).toHaveTextContent('cmd.exe');
  });

  it('SURVIVES the header being unmounted and mounted again — the E2E claim', () => {
    /*
     * The whole of what the E2E was asserting. Switching tabs unmounts the terminal and its header;
     * the store is module-level precisely so the title outlives that, and a header that came back
     * showing the bare panel name is the defect (#7).
     */
    setTerminalTitle(PANEL, 'cmd.exe');
    const first = render(createElement(Header, { panelId: PANEL }));
    expect(screen.getByTestId('header')).toHaveTextContent('cmd.exe');

    first.unmount();
    expect(screen.queryByTestId('header')).toBeNull();

    render(createElement(Header, { panelId: PANEL }));
    expect(screen.getByTestId('header')).toHaveTextContent('cmd.exe');
  });

  it('is per PANEL — one terminal’s title never appears on another’s header', () => {
    setTerminalTitle(PANEL, 'cmd.exe');
    setTerminalTitle('other', 'powershell.exe');

    const { result } = renderHook(() => useTerminalTitle(PANEL));
    expect(result.current).toBe('cmd.exe');
  });
});

describe('untrusted output, rendered in the application’s chrome', () => {
  it('caps a pathological title at 256 characters', () => {
    /*
     * The title is PTY output — whatever a program chose to emit. Uncapped, a multi-kilobyte title
     * breaks the header layout, and no E2E was ever going to type one.
     */
    setTerminalTitle(PANEL, 'x'.repeat(5_000));

    const { result } = renderHook(() => useTerminalTitle(PANEL));
    expect(result.current).toHaveLength(256);
  });

  it('stores it as plain text — no markup interpretation', () => {
    // React escapes on render; this asserts the store does not "helpfully" strip or transform, so
    // what the header shows is exactly what the shell said.
    setTerminalTitle(PANEL, '<script>alert(1)</script>');
    render(createElement(Header, { panelId: PANEL }));

    expect(screen.getByTestId('header')).toHaveTextContent('<script>alert(1)</script>');
    expect(screen.getByTestId('header').querySelector('script')).toBeNull();
  });
});

describe('when there is no longer a title to show', () => {
  it('an EMPTY announcement clears it, rather than storing an empty string', () => {
    /*
     * How a shell says "I have nothing to say". Stored as `''` instead, the header would render an
     * empty title and the panel's own name would never come back — the same wrong-header defect the
     * E2E guards, reached from the opposite direction.
     */
    setTerminalTitle(PANEL, 'cmd.exe');
    setTerminalTitle(PANEL, '');

    const { result } = renderHook(() => useTerminalTitle(PANEL));
    expect(result.current).toBeUndefined();
  });

  it('a disposed terminal drops its title, so a recycled panel id inherits nothing', () => {
    setTerminalTitle(PANEL, 'cmd.exe');
    clearTerminalTitle(PANEL);

    render(createElement(Header, { panelId: PANEL }));
    expect(screen.getByTestId('header')).toHaveTextContent('(no title)');
  });

  it('clearing one panel leaves the others alone', () => {
    setTerminalTitle(PANEL, 'cmd.exe');
    setTerminalTitle('other', 'powershell.exe');

    clearTerminalTitle(PANEL);

    const { result } = renderHook(() => useTerminalTitle('other'));
    expect(result.current).toBe('powershell.exe');
  });
});
