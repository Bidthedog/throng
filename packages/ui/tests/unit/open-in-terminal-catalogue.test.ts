/**
 * 033 AS-4 / FR-030 / FR-037 (moved down from open-in-terminal.e2e.ts) — the Open In → Terminal list is
 * the one catalogue: a user-defined flavour written into settings appears with no further configuration,
 * and a disabled built-in does not.
 *
 * Layer: unit — the catalogue is `createShellDetectionService().listFlavours` over the parsed settings, and
 * the menu maps it unfiltered (`useFlavours` does the same mapping to `FlavourOption`); a fake detection and
 * config store feed the real service and the real builder, so no app is needed to see which labels result.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  type FlavourOption,
  type IConfigStore,
  type IShellDetection,
} from '@throng/core';
import { createShellDetectionService } from '../../src/main/shell-detection-service.js';
import { buildContextMenuItems } from '../../src/renderer/explorer/context-menu-items.js';

const noop = (): void => undefined;

const DETECTION = {
  detectInstalledShells: async () => [
    { id: 'cmd', label: 'Command Prompt', file: 'C:/Windows/System32/cmd.exe', defaultArgs: [] },
    { id: 'windows-powershell', label: 'Windows PowerShell', file: 'C:/ps/powershell.exe', defaultArgs: [] },
  ],
} as unknown as IShellDetection;

/** The labels the explorer's Open In → Terminal submenu shows for a settings.json holding `raw`. */
async function menuLabels(raw: unknown): Promise<string[]> {
  const configStore = {
    read: async (_key: unknown, _defaults: unknown, parse: (r: unknown) => unknown) => parse(raw),
  } as unknown as IConfigStore;
  const catalogue = await createShellDetectionService({ detection: DETECTION, configStore }).listFlavours();
  // The mapping `useFlavours` applies to what `terminal.listFlavours` returns.
  const flavours: FlavourOption[] = catalogue.map((f) => ({
    value: f.id,
    label: f.label,
    defaultShellArguments: f.defaultShellArguments,
  }));
  const items = buildContextMenuItems({
    node: { relPath: 'deep', kind: 'folder' },
    selectedRelPaths: [],
    clipboard: null,
    ops: {
      beginRename: noop, cut: noop, copy: noop, paste: noop, remove: noop, reveal: noop, hide: noop,
      newFolder: noop, newFile: noop, undoFileOp: noop, redoFileOp: noop, openInTerminal: noop,
      expandChildren: noop, collapseChildren: noop,
    },
    openIn: undefined,
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: false, canRedo: false },
    flavours,
  });
  const openIn = items.find((i) => i.label === 'Open In');
  return (openIn?.submenu?.find((i) => i.label === 'Terminal')?.submenu ?? []).map((i) => i.label);
}

describe('Open In → Terminal over the settings catalogue (033 AS-4)', () => {
  it('lists a user-defined flavour, and omits a built-in disabled in settings', async () => {
    const labels = await menuLabels({
      terminals: {
        disabledBuiltins: ['cmd'],
        flavours: [{ id: 'my-wsl', label: 'WSL: Ubuntu', file: 'wsl.exe', args: ['-d', 'Ubuntu'], defaultShellArguments: '--cd ~' }],
      },
    });
    expect(labels).toContain('WSL: Ubuntu');
    expect(labels).not.toContain('Command Prompt');
    expect(labels, 'the built-in that stays enabled is still offered').toContain('Windows PowerShell');
  });

  it('control: with no settings written, the detected built-ins are offered', async () => {
    expect(await menuLabels({})).toEqual(expect.arrayContaining(['Command Prompt', 'Windows PowerShell']));
  });
});
