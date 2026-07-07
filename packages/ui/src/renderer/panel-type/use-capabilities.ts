import { useEffect, useState } from 'react';

/**
 * Daemon capabilities for the type-selection form (005 Phase G, FR-025a). Loads
 * `terminal.capabilities()` once — currently just `{ elevated }`, which gates the
 * "run as admin" checkbox. Defaults to not-elevated until the query resolves (and
 * in tests/windows without the bridge), so the control stays safely disabled.
 */
export interface DaemonCapabilities {
  elevated: boolean;
}

export function useCapabilities(): DaemonCapabilities {
  const [caps, setCaps] = useState<DaemonCapabilities>({ elevated: false });

  useEffect(() => {
    let active = true;
    void window.throng?.terminal?.capabilities?.().then((c) => {
      if (active && c) setCaps({ elevated: c.elevated === true });
    });
    return () => {
      active = false;
    };
  }, []);

  return caps;
}
