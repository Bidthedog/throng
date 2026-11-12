import { describe, expect, it } from 'vitest';
import { ShutdownRun, shutdownTaskSummary, type ShutdownTaskSpec } from '../../src/workspace/shutdown-run.js';

const specs = (...ms: number[]): ShutdownTaskSpec[] =>
  ms.map((expectedMs, i) => ({ id: `t${i}`, summary: `task ${i}`, expectedMs }));

function clock(start = 0) {
  const c = { value: start };
  return { c, now: () => c.value };
}

describe('shutdownTaskSummary (067 FR-041)', () => {
  it('words a task closing terminals, grouped and singular or plural', () => {
    const task = { id: 'a', summary: 'x', expectedMs: 1 };
    expect(shutdownTaskSummary({ ...task, terminals: { count: 1, projectName: 'Alpha' } })).toBe('Closing 1 terminal in Alpha');
    expect(shutdownTaskSummary({ ...task, terminals: { count: 1200, projectName: 'Alpha' } })).toBe('Closing 1,200 terminals in Alpha');
  });
  it('uses any other task as written', () => {
    expect(shutdownTaskSummary({ id: 'a', summary: 'Saving', expectedMs: 1 })).toBe('Saving');
  });
});

describe('ShutdownRun (067 FR-038, FR-040, FR-042, FR-044)', () => {
  it('advances in order with exactly one current task', () => {
    const { now } = clock();
    const run = new ShutdownRun(specs(100, 100), now);
    expect(run.view().tasks.map((t) => t.state)).toEqual(['pending', 'pending']);
    run.begin(0);
    expect(run.view().tasks.map((t) => t.state)).toEqual(['current', 'pending']);
    run.finish(0);
    run.begin(1);
    expect(run.view().tasks.map((t) => t.state)).toEqual(['done', 'current']);
  });

  it('cancel marks what has not started as cancelled, and leaves the running task current', () => {
    const { now } = clock();
    const run = new ShutdownRun(specs(100, 100, 100), now);
    run.begin(0);
    run.cancel();
    expect(run.view().cancelling).toBe(true);
    expect(run.view().tasks.map((t) => t.state)).toEqual(['current', 'cancelled', 'cancelled']);
  });

  it('marks a task abandoned by Cancel as cancelled', () => {
    const { now } = clock();
    const run = new ShutdownRun(specs(100), now);
    run.begin(0);
    run.cancel();
    run.abandon(0);
    expect(run.view().tasks.map((t) => t.state)).toEqual(['cancelled']);
  });

  it('estimates the remaining time from what has not run yet', () => {
    const { c, now } = clock();
    const run = new ShutdownRun(specs(1000, 1000), now);
    run.begin(0);
    expect(run.view().remainingMs).toBe(2000);
    c.value = 400;
    expect(run.view().remainingMs).toBe(1600);
  });

  it('scales the estimate by how the finished tasks ran', () => {
    const { c, now } = clock();
    const run = new ShutdownRun(specs(1000, 1000), now);
    run.begin(0);
    c.value = 500;
    run.finish(0);
    run.begin(1);
    expect(run.view().remainingMs).toBe(500);
  });

  it('never lets the estimate rise by more than 25% between updates while nothing has overrun', () => {
    const { c, now } = clock();
    const run = new ShutdownRun(specs(100, 100, 100), now);
    run.begin(0);
    c.value = 10;
    run.view();
    run.finish(0);
    run.begin(1);
    c.value = 40;
    let previous = run.view().remainingMs;
    for (let t = 41; t < 100; t += 7) {
      c.value = t;
      const next = run.view().remainingMs;
      expect(next).toBeLessThanOrEqual(previous * 1.25);
      previous = next;
    }
  });

  it('lets the estimate rise once the current task has overrun its expected duration', () => {
    const { c, now } = clock();
    const run = new ShutdownRun(specs(100, 5000), now);
    run.begin(0);
    c.value = 10;
    run.finish(0);
    run.begin(1);
    c.value = 11;
    const start = run.view().remainingMs;
    c.value = 3000;
    run.view();
    expect(run.view().overrunning).toBe(true);
    expect(start).toBeGreaterThan(0);
  });
});
