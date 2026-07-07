import { useEffect, useState } from 'react';
import type { FlavourOption } from '@throng/core';

/**
 * Terminal flavour source for the type-selection form (005 Phase B). Loads the
 * machine-detected built-ins ∪ user-defined flavours from UI main via
 * `terminal.listFlavours`, mapped into the form's generic `FlavourOption` shape.
 * Re-loads when the user config changes (a flavour added to `settings.json`
 * appears without a restart — FR-010a hot-reload). Starts empty until the first
 * load resolves (and in tests/windows without the bridge).
 */
export function useFlavours(): readonly FlavourOption[] {
  const [flavours, setFlavours] = useState<readonly FlavourOption[]>([]);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      void window.throng?.terminal?.listFlavours?.().then((list) => {
        if (!active) return;
        setFlavours(
          (list ?? []).map((f) => ({ value: f.id, label: f.label, defaultParams: f.defaultParams })),
        );
      });
    };
    load();
    // Re-fetch on any config change so a hot-reloaded user flavour appears.
    const off = window.throng?.config?.onChange?.(() => load());
    return () => {
      active = false;
      off?.();
    };
  }, []);

  return flavours;
}
