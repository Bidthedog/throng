/**
 * The status bar's data (055 FR-002, FR-040): the collector's cached summary, read once with
 * `summary()` and then followed with `onSummary`. `null` until the first tick (FR-051).
 *
 * A summary older than the one already shown is ignored: the one-off read and the push can cross.
 */
import { useEffect, useState } from 'react';
import type { ResourceSummary } from '@throng/ipc-contract';

export function useResourceSummary(): ResourceSummary | null {
  const [summary, setSummary] = useState<ResourceSummary | null>(null);

  useEffect(() => {
    const api = window.throng?.resources;
    if (!api) return;
    let active = true;
    const adopt = (next: ResourceSummary): void => {
      if (!active) return;
      setSummary((prev) => (prev !== null && next.tick < prev.tick ? prev : next));
    };
    void api.summary().then((s) => {
      if (s) adopt(s);
    });
    const off = api.onSummary(adopt);
    return () => {
      active = false;
      off();
    };
  }, []);

  return summary;
}
