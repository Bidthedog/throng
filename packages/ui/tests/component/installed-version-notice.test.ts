/**
 * 063 FR-010 — a running copy says when a newer package is installed, once, with the action that resolves it.
 *
 * Layer: component — what one renderer component renders and how it reacts to a pushed event; jsdom shows all of it.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledVersionNotice as Payload } from '@throng/core';
import { InstalledVersionNotice } from '../../src/renderer/common/installed-version-notice.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';

let push: ((n: Payload) => void) | undefined;
const restartInstalled = vi.fn();
const installedVersionReady = vi.fn();

beforeEach(() => {
  push = undefined;
  restartInstalled.mockClear();
  installedVersionReady.mockClear();
  Reflect.set(window, 'throng', {
    notices: { log: () => undefined },
    config: { get: () => Promise.resolve({ settings: { version: 1 } }) },
    instance: {
      onInstalledVersion: (cb: (n: Payload) => void) => {
        push = cb;
        return () => {
          push = undefined;
        };
      },
      installedVersionReady,
      restartInstalled,
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

async function raise(installedVersion: string): Promise<void> {
  render(createElement(ConfigProvider, null, createElement(NotificationProvider, null, createElement(InstalledVersionNotice))));
  await waitFor(() => expect(push).toBeDefined());
  act(() => push!({ runningVersion: '1.0.0', installedVersion }));
}

describe('the running-copy notice (063 FR-010)', () => {
  it('announces it is listening, so a version found before the window loaded still arrives', async () => {
    await raise('1.1.0');
    expect(installedVersionReady).toHaveBeenCalledTimes(1);
  });

  it('names both versions and what restarting costs', async () => {
    await raise('1.1.0');
    const card = await screen.findByTestId('installed-version-notice');
    expect(card.textContent).toContain('1.1.0');
    expect(card.textContent).toContain('1.0.0');
    expect(card.textContent).toMatch(/may end the terminals/);
  });

  it('carries the Restart that resolves it', async () => {
    await raise('1.1.0');
    fireEvent.click(await screen.findByTestId('installed-version-restart'));
    expect(restartInstalled).toHaveBeenCalledTimes(1);
  });
});
