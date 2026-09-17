import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@throng/core';
import { notifySettingsSubscribers } from '../../src/main/settings-subscribers.js';

/**
 * Adversarial review (main hardening) — main's settings-change subscribers ran in one bare loop inside the
 * config broadcast, so a subscriber that threw (`PreviewService.dropProvider` on a provider toggle, say)
 * stopped every subscriber after it AND the `throng:config` broadcast itself: every window stayed on the old
 * settings until something else touched the file. Each subscriber is isolated.
 */
describe('notifySettingsSubscribers', () => {
  const previous = DEFAULT_APP_SETTINGS as AppSettings;
  const next = structuredClone(DEFAULT_APP_SETTINGS) as AppSettings;

  it('calls every subscriber with previous and next, in order', () => {
    const calls: string[] = [];
    notifySettingsSubscribers(
      [
        (p, n) => void calls.push(`one:${p === previous}:${n === next}`),
        (p, n) => void calls.push(`two:${p === previous}:${n === next}`),
      ],
      previous,
      next,
      () => {},
    );
    expect(calls).toEqual(['one:true:true', 'two:true:true']);
  });

  it('a throwing subscriber is logged and the ones after it still run — and nothing escapes to the caller', () => {
    const log = vi.fn();
    const after = vi.fn();
    const boom = new Error('dropProvider exploded');

    expect(() =>
      notifySettingsSubscribers(
        [
          () => {
            throw boom;
          },
          after,
        ],
        previous,
        next,
        log,
      ),
    ).not.toThrow();

    expect(after).toHaveBeenCalledWith(previous, next);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toContain(boom);
  });
});
