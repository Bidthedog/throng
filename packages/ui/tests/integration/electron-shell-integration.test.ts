import {
  runShellIntegrationContract,
  type ShellIntegrationHarness,
} from '@throng/core/testing';
import {
  ElectronShellIntegration,
  type ElectronShellLike,
} from '../../src/main/electron-shell-integration.js';

type Call = { op: 'reveal' | 'open'; path: string } | { op: 'openExternal'; url: string };

const makeHarness = (): ShellIntegrationHarness => {
  let calls: Call[] = [];
  const fakeShell: ElectronShellLike = {
    showItemInFolder: (p) => calls.push({ op: 'reveal', path: p }),
    openPath: async (p) => {
      calls.push({ op: 'open', path: p });
      return '';
    },
    openExternal: async (url) => {
      calls.push({ op: 'openExternal', url });
    },
  };
  return {
    shell: new ElectronShellIntegration(fakeShell),
    calls: () => calls,
    reset: () => {
      calls = [];
    },
  };
};

runShellIntegrationContract('ElectronShellIntegration (004 T037/T045, 044 T042)', makeHarness);
