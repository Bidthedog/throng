import {
  runShellIntegrationContract,
  type ShellIntegrationHarness,
} from '@throng/core/testing';
import {
  ElectronShellIntegration,
  type ElectronShellLike,
} from '../../src/main/electron-shell-integration.js';

const makeHarness = (): ShellIntegrationHarness => {
  let calls: Array<{ op: 'reveal' | 'open'; path: string }> = [];
  const fakeShell: ElectronShellLike = {
    showItemInFolder: (p) => calls.push({ op: 'reveal', path: p }),
    openPath: async (p) => {
      calls.push({ op: 'open', path: p });
      return '';
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

runShellIntegrationContract('ElectronShellIntegration (004 T037/T045)', makeHarness);
