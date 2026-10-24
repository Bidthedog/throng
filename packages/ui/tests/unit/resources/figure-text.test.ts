/**
 * How the monitor writes a figure it cannot give as a plain number (055 FR-107, US2 scenario 27): "-" for
 * one that is not measured or unavailable, with the reason in its hover title; "~" before an estimate, with
 * "Estimated" in its title; no separate "estimated" tag. FR-012's rule on WHICH figures may be shown is
 * unchanged — this is only how they read.
 *
 * Layer: unit — `monitorFigure` is a pure function of a figure and whether its node is an estimate.
 */
import { describe, expect, it } from 'vitest';
import { NETWORK_ELEVATION_REQUIRED, NETWORK_TRACE_FAILED, NOT_MEASURED, unavailable } from '@throng/core';
import { figureOf, monitorFigure } from '../../../src/renderer/resources/figures.js';
import { MACHINE, MIB, THRESHOLDS, metrics } from '../../component/helpers/resource-fixtures.js';

const fig = (id: Parameters<typeof figureOf>[0], m: ReturnType<typeof metrics>, estimated = false) =>
  monitorFigure(figureOf(id, m, THRESHOLDS, MACHINE), estimated);

describe('a figure that is not a number (FR-107)', () => {
  it('reads "-" when not measured, saying so in its title', () => {
    const f = fig('cpu', metrics({ cpu: NOT_MEASURED }));
    expect(f.text).toBe('-');
    expect(f.title).toBe('CPU: Not measured');
  });

  it('reads "-" when unavailable, with the reason in its title', () => {
    const f = fig('gpu', metrics({ gpu: unavailable('The GPU counters could not be read') }));
    expect(f.text).toBe('-');
    expect(f.title).toBe('GPU: The GPU counters could not be read');
  });

  it('reads "-" for an unmeasured I/O total too', () => {
    expect(fig('io', metrics({ ioRead: NOT_MEASURED, ioWrite: NOT_MEASURED })).text).toBe('-');
  });

  it('titles an unelevated Network "Elevate to show", and a failed trace "Network unavailable" (FR-113)', () => {
    expect(fig('network', metrics({ network: unavailable(NETWORK_ELEVATION_REQUIRED) }))).toMatchObject({ text: '-', title: 'Elevate to show' });
    expect(fig('network', metrics({ network: unavailable(NETWORK_TRACE_FAILED) }))).toMatchObject({ text: '-', title: 'Network unavailable' });
  });
});

describe('an estimate (FR-107)', () => {
  it('reads "~" before the figure, and says "Estimated" in its title', () => {
    const f = fig('memory', metrics({ memory: 4.2 * MIB }), true);
    expect(f.text).toBe('~4.2 MB');
    expect(f.title).toBe('Memory: Estimated');
  });

  it('marks only the figure that is estimated: an estimate node’s CPU is not measured, not "~"', () => {
    expect(fig('cpu', metrics({ cpu: NOT_MEASURED }), true).text).toBe('-');
  });

  it('leaves a measured figure as it was, titled by its column', () => {
    expect(fig('memory', metrics({ memory: 4.2 * MIB }))).toMatchObject({ text: '4.2 MB', title: 'Memory' });
  });
});
