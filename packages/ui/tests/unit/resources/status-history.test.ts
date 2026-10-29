/**
 * The status-bar popover's arithmetic and history ring (055 FR-115, data-model *status-bar history ring*).
 *
 * Layer: unit — pure functions and a plain class; nothing renders.
 */
import { describe, expect, it } from 'vitest';
import { NOT_MEASURED, unavailable } from '@throng/core';
import { StatusHistory, ioScale, seriesOf, sharePercent } from '../../../src/renderer/resources/status-history.js';
import { GIB, MACHINE, metrics, summary } from '../../component/helpers/resource-fixtures.js';

describe('sharePercent (FR-115: CPU, Memory and GPU as a percentage of the machine)', () => {
  it('reads CPU and GPU as the percentages they already are', () => {
    expect(sharePercent('cpu', 12.5, MACHINE)).toBe(12.5);
    expect(sharePercent('gpu', 3, MACHINE)).toBe(3);
  });

  it('reads memory as a share of installed RAM', () => {
    expect(sharePercent('memory', 4 * GIB, MACHINE)).toBeCloseTo(25, 6);
  });

  it('leaves the share absent when the capacity is not known', () => {
    expect(sharePercent('memory', 4 * GIB, { ...MACHINE, installedRamBytes: 0 })).toBeUndefined();
  });

  it('leaves the share absent for a figure that is not a number — never zero', () => {
    expect(sharePercent('cpu', unavailable('x'), MACHINE)).toBeUndefined();
    expect(sharePercent('gpu', NOT_MEASURED, MACHINE)).toBeUndefined();
  });
});

describe('ioScale (FR-115: I/O on a scale fitted to its recent peak)', () => {
  it('is the highest rate in the ring', () => {
    expect(ioScale([10, 400, 50, undefined])).toBe(400);
  });

  it('is 0 with nothing to scale by', () => {
    expect(ioScale([])).toBe(0);
    expect(ioScale([undefined, 0])).toBe(0);
  });
});

describe('StatusHistory', () => {
  it('records one point per capture, in order', () => {
    const ring = new StatusHistory(10);
    ring.push(summary(metrics({ cpu: 10, memory: 8 * GIB, gpu: 2, ioRead: 100, ioWrite: 50 }), { tick: 1 }));
    ring.push(summary(metrics({ cpu: 20, memory: 4 * GIB, gpu: 4, ioRead: 0, ioWrite: 0 }), { tick: 2 }));
    expect(ring.points()).toEqual([
      { tick: 1, cpu: 10, memory: 50, gpu: 2, io: 150 },
      { tick: 2, cpu: 20, memory: 25, gpu: 4, io: 0 },
    ]);
  });

  it('is bounded: the oldest points go first', () => {
    const ring = new StatusHistory(3);
    for (let tick = 1; tick <= 5; tick += 1) ring.push(summary(metrics({ cpu: tick }), { tick }));
    expect(ring.points().map((p) => p.tick)).toEqual([3, 4, 5]);
  });

  it('records a capture once, whatever number of times it is pushed, and ignores an older tick', () => {
    const ring = new StatusHistory(10);
    ring.push(summary(metrics({ cpu: 1 }), { tick: 5 }));
    ring.push(summary(metrics({ cpu: 1 }), { tick: 5 }));
    ring.push(summary(metrics({ cpu: 1 }), { tick: 4 }));
    expect(ring.points()).toHaveLength(1);
  });

  it('does not record a stale capture: it repeats the last reading and would draw a flat run', () => {
    const ring = new StatusHistory(10);
    ring.push(summary(metrics({ cpu: 1 }), { tick: 1 }));
    ring.push(summary(metrics({ cpu: 1 }), { tick: 2, stale: true }));
    expect(ring.points()).toHaveLength(1);
  });

  it('leaves a share absent where the machine capacity is unknown', () => {
    const ring = new StatusHistory(10);
    ring.push(summary(metrics({ memory: GIB }), { tick: 1, machine: { ...MACHINE, installedRamBytes: 0 } }));
    expect(ring.points()[0]?.memory).toBeUndefined();
  });

  it('seriesOf keeps absent points absent', () => {
    const ring = new StatusHistory(10);
    ring.push(summary(metrics({ gpu: unavailable('x') }), { tick: 1 }));
    ring.push(summary(metrics({ gpu: 5 }), { tick: 2 }));
    expect(seriesOf(ring.points(), 'gpu')).toEqual([undefined, 5]);
  });
});
