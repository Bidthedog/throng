/**
 * 066 FR-009a (T025) — a panel torn down by a failure reports fatal, with its subject, and only that
 * panel shows the failure banner.
 *
 * Research R5: a panel is torn down when a render or an effect throws (the boundary catches both). Mounted
 * at the component layer with the real shared banner; the workspace around it is not needed to prove what
 * the boundary renders and logs.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useEffect, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoticeSubject } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { PanelErrorBoundary } from '../../src/renderer/workspace/panel-error-boundary.js';

type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug';
const log = vi.fn<(level: Level, component: string, message: string) => void>();

const SUBJECT: NoticeSubject = { kind: 'panel', name: 'Build', tab: 'Main', project: 'Throng' };

function RenderThrows(): ReactElement {
  throw new Error('render exploded');
}

function EffectThrows(): ReactElement {
  useEffect(() => {
    throw new Error('effect exploded');
  }, []);
  return createElement('span', null, 'effect body');
}

function Healthy({ id }: { id: string }): ReactElement {
  return createElement('span', { 'data-testid': `healthy-${id}` }, 'healthy');
}

function panel(id: string, body: ReactElement, onClear = (): void => undefined): ReactElement {
  return createElement(
    PanelErrorBoundary,
    { key: id, panelId: id, subject: SUBJECT, onClear },
    body,
  );
}

function mount(...panels: ReactElement[]) {
  return render(createElement(NotificationProvider, null, ...panels));
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log.mockClear();
  (window as unknown as { throng: unknown }).throng = { diagnostics: { log } };
  // React logs a caught error to the console; the test asserts on the log channel instead.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  delete (window as unknown as { throng?: unknown }).throng;
});

describe('PanelErrorBoundary (066 T025)', () => {
  it('a body that throws while rendering shows the failure banner in that panel only, and logs fatal once with the subject', () => {
    mount(panel('bad', createElement(RenderThrows)), panel('good', createElement(Healthy, { id: 'good' })));

    expect(screen.getByTestId('panel-failure-bad')).toBeVisible();
    expect(screen.queryByTestId('panel-failure-good')).toBeNull();
    expect(screen.getByTestId('healthy-good')).toBeVisible();

    const fatals = log.mock.calls.filter((c) => c[0] === 'fatal');
    expect(fatals).toHaveLength(1);
    const [, component, message] = fatals[0];
    expect(component).toBe('panel');
    expect(message).toContain('Throng — Main — Build');
    expect(message).toContain('render exploded');
  });

  it('a body whose effect throws is torn down the same way', () => {
    mount(panel('eff', createElement(EffectThrows)), panel('good', createElement(Healthy, { id: 'good' })));

    expect(screen.getByTestId('panel-failure-eff')).toBeVisible();
    expect(screen.queryByText('effect body')).toBeNull();
    expect(screen.getByTestId('healthy-good')).toBeVisible();

    const fatals = log.mock.calls.filter((c) => c[0] === 'fatal');
    expect(fatals).toHaveLength(1);
    expect(fatals[0][2]).toContain('effect exploded');
  });

  it('does not render the thrown message (030 FR-034) and renders nothing when the body is healthy', () => {
    mount(panel('bad', createElement(RenderThrows)), panel('good', createElement(Healthy, { id: 'good' })));
    expect(screen.queryByText(/render exploded/)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('Try again remounts the body once the cause is gone', async () => {
    // A flag, not a render counter: React retries a failed render once on its own, so counting renders lies.
    const state = { broken: true };
    function Flaky(): ReactElement {
      if (state.broken) throw new Error('still broken');
      return createElement('span', { 'data-testid': 'recovered' }, 'recovered');
    }
    mount(panel('flaky', createElement(Flaky)));

    expect(screen.getByTestId('panel-failure-flaky')).toBeVisible();
    state.broken = false;
    await userEvent.click(screen.getByTitle('Try again'));
    expect(await screen.findByTestId('recovered')).toBeVisible();
    expect(screen.queryByTestId('panel-failure-flaky')).toBeNull();
  });

  it('Clear panel type calls onClear', async () => {
    const onClear = vi.fn();
    mount(panel('bad', createElement(RenderThrows), onClear));
    await userEvent.click(screen.getByTitle('Clear panel type'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('Clear panel type takes the banner down so the cleared panel shows its new content', async () => {
    // The real onClear empties the panel's type and the placeholder re-renders the same boundary with the
    // type form as its child; a boundary still holding `failed` would keep the banner over it.
    function Host(): ReactElement {
      const [cleared, setCleared] = useState(false);
      const body = cleared ? createElement('span', { 'data-testid': 'type-form' }, 'choose a type') : createElement(RenderThrows);
      return panel('bad', body, () => setCleared(true));
    }
    mount(createElement(Host));
    await userEvent.click(screen.getByTitle('Clear panel type'));
    expect(await screen.findByTestId('type-form')).toBeVisible();
    expect(screen.queryByTestId('panel-failure-bad')).toBeNull();
  });
});
