/**
 * 067 T027 (FR-012, research D5) — an elevated Windows session cannot receive an OS file drag: the OS
 * blocks it before throng sees any event, so a blocked drag cannot be observed. The tree therefore says
 * so once, the first time it mounts, and Paste is named as the way in.
 *
 * Raised for an elevated Windows session only: never for a non-elevated one, and never on Linux.
 */
import { waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
} from './helpers/explorer-harness.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

const notices = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-testid="notices"] .notice'),
];

async function mountWith(session: { osName: 'windows' | 'linux'; elevated: boolean }) {
  const capabilities = vi.fn(() => Promise.resolve({ elevated: session.elevated }));
  const m = await mountExplorer(standardHost, {
    extraBridge: { osName: session.osName, terminal: { capabilities } },
  });
  // The capability read, when there is one, settles in a few microtasks; give a notice time to appear.
  await new Promise((r) => setTimeout(r, 30));
  return m;
}

describe('the elevated-drop notice (067 US1)', () => {
  it('is raised once when the tree mounts in an elevated Windows session, and names Paste', async () => {
    const m = await mountWith({ osName: 'windows', elevated: true });
    await waitFor(() => expect(notices()).toHaveLength(1));
    const text = notices()[0]!.textContent ?? '';
    expect(text).toMatch(/administrator/i);
    expect(text).toMatch(/paste/i);

    // The tree mounting again in the same session (a project switch) says nothing more.
    m.unmount();
    Reflect.deleteProperty(window, 'throng');
    const again = await mountWith({ osName: 'windows', elevated: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(again.tree).toBeTruthy();
    expect(notices()).toHaveLength(0);
  });

  it('is never raised for a non-elevated Windows session', async () => {
    await mountWith({ osName: 'windows', elevated: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(notices()).toHaveLength(0);
  });

  it('is never raised on Linux, elevated or not', async () => {
    await mountWith({ osName: 'linux', elevated: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(notices()).toHaveLength(0);
  });
});
