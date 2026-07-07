/**
 * Shell-detection service (005 Phase B, UI-main-owned). Merges the machine's
 * detected built-in shells (via the `IShellDetection` OS seam) with the user's
 * `settings.terminals` to produce the Flavour dropdown's catalogue, served to the
 * sandboxed renderer over `terminal.listFlavours` (the daemon performs no
 * detection). Settings are re-read per call so a hot-reloaded user flavour appears
 * without a restart (FR-010a).
 */
import {
  DEFAULT_APP_SETTINGS,
  mergeFlavours,
  parseAppSettings,
  type IConfigStore,
  type IShellDetection,
  type TerminalFlavour,
} from '@throng/core';

export interface ShellDetectionService {
  listFlavours(): Promise<TerminalFlavour[]>;
}

export function createShellDetectionService(deps: {
  detection: IShellDetection;
  configStore: IConfigStore;
}): ShellDetectionService {
  return {
    async listFlavours(): Promise<TerminalFlavour[]> {
      const settings = await deps.configStore.read(
        { kind: 'settings' },
        DEFAULT_APP_SETTINGS,
        parseAppSettings,
      );
      const detected = await deps.detection.detectInstalledShells();
      return mergeFlavours(detected, settings.terminals);
    },
  };
}
