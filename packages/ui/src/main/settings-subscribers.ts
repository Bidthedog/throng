/**
 * Main's settings-change subscribers, called one at a time and ISOLATED.
 *
 * They run inside the config broadcast, before `throng:config` goes to the windows. A subscriber that
 * threw — `PreviewService.dropProvider` on a provider being turned off, say — used to escape the bare loop
 * and take everything after it with it: the later subscribers AND the broadcast itself, so every window
 * stayed on the old settings until something else touched the file (adversarial review, main hardening).
 * Each is an observer of the change; none of them gets to cancel it.
 */
import type { AppSettings } from '@throng/core';

export type SettingsSubscriber = (previous: AppSettings, next: AppSettings) => void;

export function notifySettingsSubscribers(
  subscribers: readonly SettingsSubscriber[],
  previous: AppSettings,
  next: AppSettings,
  logError: (message: string, err: unknown) => void = (message, err) => console.error(message, err),
): void {
  for (const subscriber of subscribers) {
    try {
      subscriber(previous, next);
    } catch (err) {
      logError('[settings] a settings-change subscriber threw:', err);
    }
  }
}
