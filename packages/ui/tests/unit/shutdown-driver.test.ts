import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShutdownView } from '@throng/core';
import { ShutdownDriver, type ShutdownStep } from '../../src/main/shutdown-driver.js';

const step = (id: string, run: ShutdownStep['run'] = async () => {}): ShutdownStep => ({ id, summary: id, expectedMs: 100, run });

function setup() {
  const views: ShutdownView[] = [];
  return { views, driver: new ShutdownDriver((v) => views.push(v), () => Date.now()) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ShutdownDriver (067 FR-037, FR-038, FR-043, SC-005)', () => {
  it('runs every step in order and completes', async () => {
    const order: string[] = [];
    const { driver } = setup();
    const result = await driver.run([step('a', async () => void order.push('a')), step('b', async () => void order.push('b'))]);
    expect(order).toEqual(['a', 'b']);
    expect(result).toBe('completed');
  });

  it('a failing step does not stop the ones after it', async () => {
    const order: string[] = [];
    const { driver } = setup();
    const result = await driver.run([
      step('a', async () => {
        throw new Error('nope');
      }),
      step('b', async () => void order.push('b')),
    ]);
    expect(order).toEqual(['b']);
    expect(result).toBe('completed');
  });

  it('Cancel lets a finishing step finish and runs nothing further', async () => {
    const order: string[] = [];
    let finish!: () => void;
    const { driver } = setup();
    const running = driver.run([
      step('a', () => new Promise<void>((resolve) => (finish = resolve))),
      step('b', async () => void order.push('b')),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    driver.cancel();
    finish();
    expect(await running).toBe('cancelled');
    expect(order).toEqual([]);
  });

  it('Cancel on a step that never settles returns within 5 seconds and aborts it', async () => {
    let signal!: AbortSignal;
    const { driver } = setup();
    const running = driver.run([
      step('stuck', (s) => {
        signal = s;
        return new Promise<void>(() => {});
      }),
      step('never'),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    driver.cancel();
    await vi.advanceTimersByTimeAsync(4999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await running).toBe('cancelled');
    expect(signal.aborted).toBe(true);
  });

  it('Cancel before the run starts runs nothing', async () => {
    const order: string[] = [];
    const { driver } = setup();
    driver.cancel();
    expect(await driver.run([step('a', async () => void order.push('a'))])).toBe('cancelled');
    expect(order).toEqual([]);
  });

  it('Cancel after the point of no return does nothing', async () => {
    const { driver, views } = setup();
    await driver.run([step('a')]);
    driver.pointOfNoReturn();
    const published = views.length;
    driver.cancel();
    expect(views.length).toBe(published);
    expect(driver.cancelled).toBe(false);
  });

  it('publishes a view on every change', async () => {
    const { driver, views } = setup();
    await driver.run([step('a')]);
    expect(views.map((v) => v.tasks[0]!.state)).toEqual(['current', 'done']);
  });

  it('publishes views that can cross to the renderer, with no step function among them', async () => {
    const views: ShutdownView[] = [];
    const driver = new ShutdownDriver((view) => views.push(view), () => 0);
    await driver.run([{ id: 'a', summary: 'A', expectedMs: 1, terminals: { count: 2, projectName: 'P' }, run: () => Promise.resolve() }]);
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) expect(() => structuredClone(view)).not.toThrow();
    expect(views[0]!.tasks[0]).toMatchObject({ id: 'a', summary: 'A', expectedMs: 1, terminals: { count: 2, projectName: 'P' } });
  });
});
