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

/** One built-in the machine actually has, as detection reported it (019, FR-017). */
export interface DetectedFlavour {
  /** The built-in id: 'cmd' | 'windows-powershell' | 'pwsh' | 'git-bash' | … */
  id: string;
  /** What the picker shows a human — 'Command Prompt', never 'cmd'. */
  label: string;
  /** The detected executable, for diagnostics. */
  file: string;
}

export interface ShellDetectionService {
  /** The Flavour dropdown's catalogue: what can be LAUNCHED (built-ins minus hidden ∪ user). */
  listFlavours(): Promise<TerminalFlavour[]>;
  /**
   * The raw detected built-ins: what this MACHINE HAS, with nothing subtracted (019, C10/FR-017).
   *
   * A separate question from `listFlavours`, deliberately answered by a separate method. Hiding a
   * built-in is a ONE-WAY DOOR otherwise: `listFlavours` already subtracts `disabledBuiltins`, so a
   * picker built from it cannot offer back the built-in the user just hid, and the setting can never
   * be undone through its own editor.
   *
   * `listFlavours({ includeHidden: true })` was the alternative and is refused: a flag invites a
   * caller to accidentally offer hidden flavours in the dropdown ITSELF — the exact behaviour the
   * user switched off. A distinct method cannot be misused that way. Only the settings editor
   * consumes it; it MUST NOT be reachable from the panel-type form.
   */
  listDetectedFlavours(): Promise<DetectedFlavour[]>;
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

    async listDetectedFlavours(): Promise<DetectedFlavour[]> {
      // Re-detect per call, as `listFlavours` does, so the editor is never showing a stale
      // catalogue after a hot reload. Nothing is subtracted here — not `disabledBuiltins`, not
      // user flavours, no merge: the catalogue a picker is built from is the DETECTED set.
      const detected = await deps.detection.detectInstalledShells();
      return detected.map((d) => ({ id: d.id, label: d.label, file: d.file }));
    },
  };
}
