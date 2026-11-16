/**
 * 070 FR-024a — the `throng` command's notices: one per outcome, success saying where the command is, a declined
 * approval or a failure saying what went wrong, and the start-up "no longer opens throng" notice carrying the Install
 * that resolves it.
 *
 * Layer: component — what one renderer component renders and how it reacts to a pushed event; jsdom shows all of it.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandLineNotice } from '../../src/renderer/common/command-line-notice.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import type { CommandLineOutcome } from '../../src/renderer/global.js';

let push: ((o: CommandLineOutcome) => void) | undefined;
const install = vi.fn();
const ready = vi.fn();

beforeEach(() => {
  push = undefined;
  install.mockClear();
  ready.mockClear();
  Reflect.set(window, 'throng', {
    notices: { log: () => undefined },
    config: { get: () => Promise.resolve({ settings: { version: 1 } }) },
    commandLine: {
      install,
      uninstall: vi.fn(),
      onOutcome: (cb: (o: CommandLineOutcome) => void) => {
        push = cb;
        return () => {
          push = undefined;
        };
      },
      ready,
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

async function raise(outcome: CommandLineOutcome): Promise<HTMLElement> {
  render(createElement(ConfigProvider, null, createElement(NotificationProvider, null, createElement(CommandLineNotice))));
  await waitFor(() => expect(push).toBeDefined());
  act(() => push!(outcome));
  return screen.findByTestId('command-line-notice');
}

describe('the throng command’s notices (070 FR-024a)', () => {
  it('announces it is listening, so the start-up outcome still arrives', async () => {
    await raise({ kind: 'uninstalled', linkPath: '/usr/local/bin/throng' });
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('says where an installed command now is', async () => {
    const card = await raise({ kind: 'installed', linkPath: '/usr/local/bin/throng' });
    expect(card.textContent).toContain('/usr/local/bin/throng');
    expect(card.textContent).toMatch(/installed/);
  });

  it('says what went wrong with a declined approval, and offers no action it cannot keep', async () => {
    const card = await raise({ kind: 'failed', action: 'install', reason: 'The administrator approval was declined.' });
    expect(card.textContent).toContain('Couldn’t install the throng command');
    expect(card.textContent).toContain('The administrator approval was declined.');
    expect(screen.queryByTestId('command-line-install')).toBeNull();
  });

  it('raises one notice for one outcome pushed twice', async () => {
    await raise({ kind: 'failed', action: 'uninstall', reason: 'Operation not permitted' });
    act(() => push!({ kind: 'failed', action: 'uninstall', reason: 'Operation not permitted' }));
    expect(screen.getAllByTestId('command-line-notice')).toHaveLength(1);
  });

  it('at start, says the command no longer opens throng, with the Install that resolves it', async () => {
    const card = await raise({
      kind: 'broken',
      linkPath: '/usr/local/bin/throng',
      target: '/Volumes/old/throng.app/Contents/Resources/bin/throng',
    });
    expect(card.textContent).toMatch(/no longer opens throng/);
    // 069 FR-050 (constitution 6.8.0, toast controls): Install leads the card's top-right control group.
    const group = within(card).getByTestId('notice-controls');
    expect(group.firstElementChild).toBe(screen.getByTestId('command-line-install'));
    fireEvent.click(screen.getByTestId('command-line-install'));
    expect(install).toHaveBeenCalledTimes(1);
  });
});
