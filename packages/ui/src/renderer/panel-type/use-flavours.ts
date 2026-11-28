import { useEffect, useState } from 'react';
import type { FlavourOption } from '@throng/core';

/**
 * The one read of the terminal flavour catalogue (033 FR-030): the machine-detected built-ins ∪
 * user-defined flavours from UI main via `terminal.listFlavours`, mapped into the generic
 * `FlavourOption` shape. `useFlavours` holds it for a component; a caller outside React (a link
 * menu opened from a callback, 081 FR-050) awaits it directly. Empty without the bridge.
 */
export async function readFlavours(): Promise<readonly FlavourOption[]> {
  const list = (await window.throng?.terminal?.listFlavours?.()) ?? [];
  return list.map((f) => ({
    value: f.id,
    label: f.label,
    defaultShellArguments: f.defaultShellArguments,
    reportsDirectory: f.reportsDirectory !== false,
  }));
}

/**
 * Terminal flavour source for the type-selection form (005 Phase B). Re-loads when the user config
 * changes (a flavour added to `settings.json` appears without a restart — FR-010a hot-reload). Starts
 * empty until the first load resolves (and in tests/windows without the bridge).
 */
export function useFlavours(): readonly FlavourOption[] {
  const [flavours, setFlavours] = useState<readonly FlavourOption[]>([]);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      void readFlavours().then((list) => {
        if (active) setFlavours(list);
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
