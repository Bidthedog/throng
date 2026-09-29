/**
 * 047 FR-083 — the panel-border flash's timing: a request made before its panel mounts still plays once it
 * does, a stale one never plays, the flash ends on its own, and a second request restarts it.
 */
import { act, render, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLASH_DURATION_MS,
  FLASH_PARK_MS,
  __resetPanelFlash,
  requestPanelFlash,
  usePanelFlash,
} from '../../src/renderer/workspace/panel-flash.js';

function Probe({ id }: { id: string }): ReactElement {
  const flash = usePanelFlash(id);
  return createElement('span', { 'data-testid': 'probe' }, flash === null ? 'off' : `on:${flash}`);
}

const probe = (id = 'p1') => render(createElement(Probe, { id }));
const shown = (): string | null => screen.getByTestId('probe').textContent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  __resetPanelFlash();
});

describe('panel flash (FR-083)', () => {
  it('plays for a request made while the panel is mounted, and ends on its own', () => {
    probe();
    expect(shown()).toBe('off');

    act(() => requestPanelFlash('p1'));
    expect(shown()).toMatch(/^on:/);

    act(() => vi.advanceTimersByTime(FLASH_DURATION_MS));
    expect(shown()).toBe('off');
  });

  it('plays for a request made just BEFORE the panel mounts — a panel placed a moment ago', () => {
    requestPanelFlash('p1');
    vi.advanceTimersByTime(FLASH_PARK_MS / 2);

    probe();

    expect(shown()).toMatch(/^on:/);
  });

  it('never plays for a stale request', () => {
    requestPanelFlash('p1');
    vi.advanceTimersByTime(FLASH_PARK_MS + 1);

    probe();

    expect(shown()).toBe('off');
  });

  it('a second request while flashing restarts it with a new key, and runs its full length', () => {
    probe();
    act(() => requestPanelFlash('p1'));
    const first = shown();
    act(() => vi.advanceTimersByTime(FLASH_DURATION_MS - 100));

    act(() => requestPanelFlash('p1'));
    const second = shown();
    expect(second).toMatch(/^on:/);
    expect(second).not.toBe(first);

    act(() => vi.advanceTimersByTime(FLASH_DURATION_MS - 100));
    expect(shown()).toBe(second);
    act(() => vi.advanceTimersByTime(100));
    expect(shown()).toBe('off');
  });

  it('flashes only the panel named', () => {
    probe('p1');
    act(() => requestPanelFlash('p2'));
    expect(shown()).toBe('off');
  });
});
