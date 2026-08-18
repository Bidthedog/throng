/**
 * 025 follow-up — `terminals.shellIntegration` decides which flavours can report a directory.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/terminal-directory-memory.e2e.ts` (034 FR-045), the test
 * "with shell integration OFF, PowerShell cannot offer 'Reopen in the last directory'". It seeded
 * `{ terminals: { shellIntegration: false } }` into a temp config root and launched a whole
 * Electron app — which it could not share with its neighbours, because the setting has to be on
 * disk BEFORE the app starts — to read two checkbox states off a form. No shell was ever spawned.
 *
 * THIS IS THE FIRST OF THE THREE HOPS that E2E covered end to end. It proves the SETTING reaches
 * the FLAVOUR. The second — the flavour's flag reaching a rendered, disabled control through the
 * real `useFlavours` hook — is `packages/ui/tests/component/terminal-panel-type-inputs.test.ts`.
 * The third, `ipcMain.handle('throng:terminal:listFlavours')` delegating to the service, is a
 * one-line pass-through and is covered by neither; it is named in the component file's header
 * rather than left implied.
 *
 * WHY NOT JUST `flavourReportsDirectory`: it already has unit tests
 * (`command-recipe.test.ts:110-137`) and they were green throughout. What had NO test is that
 * `mergeFlavours` — the thing the dropdown is actually built from — passes the setting to it for
 * every entry it produces, built-in and user-defined alike. A function that answers correctly and
 * is never asked is the exact shape of defect this closes.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Make `mergeFlavours` return `[]` (or drop the `reportsDirectory` property from the two object
 * literals it builds). Every test below indexes into the merged list and reads that property, so
 * ALL 5 fail — 4 on a `undefined` flavour, 1 on the count. None of them can pass against an empty
 * or flag-less catalogue.
 */
import { describe, it, expect } from 'vitest';
import { mergeFlavours, type DetectedShell, type TerminalSettings } from '@throng/core';

/**
 * The four built-ins, split by whether throng can observe their directory from outside.
 *
 * `cmd` moves its real process working directory, so a PEB read sees it and no cooperation is
 * needed. `windows-powershell` and `pwsh` move only their PROVIDER location, and `git-bash`
 * reports through an environment variable — all three need shell integration or they cannot be
 * followed at all. One passing flavour proves nothing about the others, which is why all four are
 * here rather than only the one the E2E happened to drive.
 */
const DETECTED: DetectedShell[] = [
  { id: 'cmd', label: 'Command Prompt', file: 'C:/Windows/System32/cmd.exe', defaultArgs: [] },
  { id: 'windows-powershell', label: 'Windows PowerShell', file: 'C:/pwsh5/powershell.exe', defaultArgs: [] },
  { id: 'pwsh', label: 'PowerShell', file: 'C:/pwsh7/pwsh.exe', defaultArgs: [] },
  { id: 'git-bash', label: 'Git Bash', file: 'C:/Git/bin/bash.exe', defaultArgs: ['-i', '-l'] },
];

function settings(overrides: Partial<TerminalSettings> = {}): TerminalSettings {
  return {
    flavours: [],
    disabledBuiltins: [],
    defaultShellArguments: {},
    commandRecipes: {},
    commandPollMs: 1000,
    shellIntegration: true,
    showStatusBar: true,
    linkHoverDelayMs: 500,
    ...overrides,
  };
}

const reports = (list: ReturnType<typeof mergeFlavours>, id: string): boolean =>
  list.find((f) => f.id === id)!.reportsDirectory;

describe('mergeFlavours carries shellIntegration onto every flavour (025 follow-up)', () => {
  it('with integration ON, every built-in can report its directory', () => {
    const merged = mergeFlavours(DETECTED, settings({ shellIntegration: true }));
    expect(merged).toHaveLength(4);
    for (const id of ['cmd', 'windows-powershell', 'pwsh', 'git-bash']) {
      expect(reports(merged, id), `${id} should report with integration on`).toBe(true);
    }
  });

  it('with integration OFF, only the shell throng can observe from outside still reports', () => {
    const merged = mergeFlavours(DETECTED, settings({ shellIntegration: false }));
    // cmd's real working directory moves, so it never depended on the shell's cooperation.
    expect(reports(merged, 'cmd')).toBe(true);
    // The other three cannot be followed at all without it. This is the assertion the E2E made,
    // for PowerShell only and at the cost of a dedicated app launch.
    expect(reports(merged, 'windows-powershell')).toBe(false);
    expect(reports(merged, 'pwsh')).toBe(false);
    expect(reports(merged, 'git-bash')).toBe(false);
  });

  it('a USER-defined flavour gets the flag too, not just the built-ins', () => {
    /*
     * A user entry is built by a separate branch of `mergeFlavours` from the detected ones, and
     * an omission there would be invisible to any test that only ever looks at built-ins. A user
     * flavour with an unknown id needs no integration, so it reports either way.
     */
    const user = { id: 'my-wsl', label: 'WSL', file: 'wsl.exe', args: ['-d', 'Ubuntu'], defaultShellArguments: '' };
    for (const shellIntegration of [true, false]) {
      const merged = mergeFlavours(DETECTED, settings({ shellIntegration, flavours: [user] }));
      expect(reports(merged, 'my-wsl'), `integration=${shellIntegration}`).toBe(true);
    }
  });

  it('a user flavour that SHADOWS a built-in is judged by its id, not by where it came from', () => {
    // The dedupe keeps the user entry and drops the detected one (FR-010a). `windows-powershell`
    // still cannot be observed from outside whoever declared it, so the flag must not flip merely
    // because the entry now comes from settings.json.
    const shadow = {
      id: 'windows-powershell',
      label: 'My PowerShell',
      file: 'C:/pwsh5/powershell.exe',
      args: [],
      defaultShellArguments: '',
    };
    const merged = mergeFlavours(DETECTED, settings({ shellIntegration: false, flavours: [shadow] }));
    expect(merged.filter((f) => f.id === 'windows-powershell')).toHaveLength(1);
    expect(reports(merged, 'windows-powershell')).toBe(false);
  });

  it('an entry hidden by disabledBuiltins takes its flag out of the list with it', () => {
    // Not a flag claim so much as a guard against the two features being wired in the wrong order:
    // resolving `reportsDirectory` before the disabled filter would still be correct, resolving the
    // filter against the flag would not. The dropdown must simply not offer it.
    const merged = mergeFlavours(DETECTED, settings({ shellIntegration: false, disabledBuiltins: ['cmd'] }));
    expect(merged.map((f) => f.id)).not.toContain('cmd');
    expect(reports(merged, 'pwsh')).toBe(false);
  });
});
