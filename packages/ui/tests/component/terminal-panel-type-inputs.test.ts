/**
 * 025 — the Terminal panel type's own form controls, and what decides whether one of them is
 * OFFERED at all.
 *
 * MIGRATED FROM (034 FR-045):
 *   • `terminal-startup-command.e2e.ts` — "the form offers Shell Arguments, Startup Command and
 *     the memory checkbox (FR-001/FR-002/FR-015)"
 *   • `terminal-directory-memory.e2e.ts` — "with shell integration OFF, PowerShell cannot offer
 *     'Reopen in the last directory'"
 *
 * NEITHER OF THOSE EVER STARTED A SHELL. Both launched a real Electron app, created a project,
 * opened the panel type form and then asked the DOM which controls existed and what state they
 * were in — and the second seeded a `THRONG_CONFIG_ROOT` before launching, so it could not even
 * share an app with its neighbours and paid a whole launch of its own. That is `TerminalInputs`
 * deciding what to render from the flavour list it was handed, which is precisely what a DOM can
 * see and an Electron window adds nothing to.
 *
 * ══ THE CHAIN, AND THE ONE HOP THIS DOES NOT COVER ══
 *
 * The directory-memory E2E's claim ran end to end: `terminals.shellIntegration: false` in
 * settings.json → the PowerShell entry's `reportsDirectory` → the IPC payload → `useFlavours` →
 * a disabled checkbox. It is split three ways rather than moved whole, because a partial
 * replacement is not a replacement (FR-047):
 *
 *   1. settings → flavour — `packages/core/tests/unit/terminal-flavour-reports-directory.test.ts`
 *      proves `mergeFlavours` carries `settings.shellIntegration` onto every flavour's
 *      `reportsDirectory`, for built-ins and user entries alike.
 *   2. IPC payload → rendered control — THIS FILE. The tests drive the REAL `useFlavours` hook
 *      over a fake preload bridge rather than handing `TerminalInputs` a hand-built option list,
 *      so the mapping at `use-flavours.ts:25` (`reportsDirectory: f.reportsDirectory !== false`)
 *      is under test rather than stubbed past. Delete that line and every flavour claims it can
 *      report, and tests 3 and 4 below go red.
 *   3. `ipcMain.handle('throng:terminal:listFlavours', () => shellDetectionService.listFlavours())`
 *      — `main.ts:1290` — is NOT covered here. It is a one-line delegation with no logic in it.
 *      Named anyway, because an unstated gap is the thing FR-046a exists to stop.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Make `stubBridge` resolve `[]` instead of `FLAVOURS` (or drop the `terminal` key from the object
 * it sets on `window`). `renderForm` awaits `findByTestId('terminal-flavour')`, and that select
 * only exists once a NON-EMPTY list has loaded — `TerminalInputs` renders `terminal-no-flavours`
 * instead when the list is empty. ALL 4 tests in this file then fail in `renderForm`, before a
 * single assertion of their own runs. None of them can pass against a form that never received
 * its flavours.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PanelTypeValues } from '@throng/core';
import { TerminalInputs } from '../../src/renderer/panel-type/terminal-inputs.js';
import { useFlavours } from '../../src/renderer/panel-type/use-flavours.js';

/**
 * What `terminal.listFlavours` returns with `terminals.shellIntegration` OFF — the exact condition
 * the migrated E2E seeded a config root to produce.
 *
 * `cmd` moves its real working directory, so an outside observer can read it and it reports
 * whatever the setting says. `windows-powershell` cannot be observed at all: `Set-Location` never
 * moves the process working directory, so with integration off it can never report. That
 * asymmetry is the whole point of the control being conditional, and it is why BOTH flavours are
 * present here rather than only the interesting one.
 */
const FLAVOURS = [
  {
    id: 'cmd',
    label: 'Command Prompt',
    file: 'C:\\Windows\\System32\\cmd.exe',
    args: [],
    source: 'builtin' as const,
    defaultShellArguments: '/K',
    reportsDirectory: true,
  },
  {
    id: 'windows-powershell',
    label: 'Windows PowerShell',
    file: 'C:\\pwsh5\\powershell.exe',
    args: [],
    source: 'builtin' as const,
    defaultShellArguments: '-NoLogo',
    reportsDirectory: false,
  },
];

/**
 * The preload bridge, as a plain object on `window` — the idiom `file-tree.test.ts` uses.
 *
 * `useFlavours` reaches everything through optional chaining, so only the members it actually
 * calls need to exist. `config.onChange` returns an unsubscribe so the hook's cleanup has
 * something to call.
 */
function stubBridge(list: typeof FLAVOURS = FLAVOURS): void {
  Reflect.set(window, 'throng', {
    terminal: { listFlavours: () => Promise.resolve(list) },
    config: { onChange: () => () => {} },
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/**
 * The form's Terminal inputs, fed by the real hook and backed by a parent that holds the values.
 *
 * The stateful host is not decoration: `TerminalInputs` is CONTROLLED — every value comes from
 * props — so `selectFlavour` calling `onChange` changes nothing on screen unless something owns
 * the state and re-renders. Test 4 switches flavour through the real `<select>`, which is the
 * gesture the E2E performed, and without a host it would assert against a form frozen on `cmd`.
 */
async function renderForm(initial: PanelTypeValues = {}): Promise<{ user: ReturnType<typeof userEvent.setup> }> {
  const user = userEvent.setup();
  function Host() {
    const [values, setValues] = useState<PanelTypeValues>(initial);
    const flavours = useFlavours();
    return createElement(TerminalInputs, {
      values,
      flavours,
      elevated: false,
      onChange: setValues,
    });
  }
  render(createElement(Host));
  // The hook resolves asynchronously. Waiting for the populated select is also the anti-vacuity
  // gate described in the header — nothing below runs against an unloaded form.
  await screen.findByTestId('terminal-flavour');
  return { user };
}

const control = (id: string): HTMLInputElement => screen.getByTestId(id) as HTMLInputElement;

describe('the Terminal type form offers its three configuration controls (025 FR-001/FR-002)', () => {
  it('shows Shell Arguments and Startup Command as two DISTINCT fields', async () => {
    stubBridge();
    await renderForm();

    const args = control('terminal-shell-arguments');
    const command = control('terminal-startup-command');
    expect(args).toBeVisible();
    expect(command).toBeVisible();
    // FR-002 renamed the first from "Startup Params" precisely because the two shared a word and
    // were confused for one another. Asserting they are two elements is the weak half of that;
    // asserting their descriptions say different things is the half that carries the requirement.
    expect(args).not.toBe(command);
    expect(args.title).toMatch(/passed to the shell/i);
    expect(command.title).toMatch(/the shell runs/i);
  });

  it('ships "Remember the last running command" ON (FR-015)', async () => {
    stubBridge();
    await renderForm();

    /*
     * Asserted rather than assumed, which is what the E2E did too and for the same reason: an
     * opt-in a user has to discover first does nothing at all for everyone who never found the
     * checkbox. A silently flipped default fails here.
     *
     * The value is ABSENT from `values`, deliberately. `rememberCommand` is read as
     * `values.rememberCommand !== 'false'`, so "no stored preference" and "explicitly on" must
     * both render checked — and a fresh panel is the first of those.
     */
    expect(control('terminal-remember-command')).toBeChecked();
  });
});

describe('"Reopen in the last directory" is offered only by a shell that can report it', () => {
  it('a shell whose directory can be read gets an ENABLED, checked control', async () => {
    stubBridge();
    await renderForm({ flavourId: 'cmd' });

    const remember = control('terminal-remember-directory');
    expect(remember).toBeEnabled();
    expect(remember).toBeChecked();
  });

  it('a shell that cannot report gets a DISABLED control, unchecked, saying why', async () => {
    stubBridge();
    const { user } = await renderForm({ flavourId: 'cmd' });
    expect(control('terminal-remember-directory')).toBeEnabled();

    // Switch through the real select, as the E2E did — this is what proves the control follows the
    // CHOSEN flavour rather than merely rendering from a fixed prop.
    await user.selectOptions(screen.getByTestId('terminal-flavour'), 'windows-powershell');

    const remember = control('terminal-remember-directory');
    /*
     * Disabled, not hidden, and NOT checked.
     *
     * Offering it enabled would be a lie — the checkbox would look live and silently do nothing,
     * because the shell never reports a directory for anything to remember. Leaving it checked
     * while disabled would be the same lie in a quieter voice.
     */
    expect(remember).toBeDisabled();
    expect(remember).not.toBeChecked();
    // And the reason is on the control itself rather than somewhere the user has to go looking:
    // one condition, one notice, with the remedy named.
    expect(remember.closest('label')?.title).toMatch(/Shell integration/i);
  });
});
