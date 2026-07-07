import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';

// US2 (config half) / Plan Phase B (FR-010/010a/011/012): the Flavour dropdown is
// real — machine-detected built-ins ∪ user-defined flavours from settings.json —
// and Startup Params pre-fills/updates with the chosen flavour's default. No
// terminal launches yet (that is Phase C).
//
// FR-024 (batch-2 robust detection: well-known path → PATH → registry, incl.
// non-default/portable Git installs, with no false positives) is NOT E2E'd here:
// the built app uses the real machine's registry/PATH, which a test must not
// mutate. That ordered resolution is instead covered deterministically by the pure
// resolver unit test (packages/core/tests/unit/terminal-resolve-shell.test.ts) and
// the fake-resolver cases in the WindowsShellDetection contract test
// (packages/platform-windows/tests/contract/windows-shell-detection.contract.test.ts).

test('the Flavour dropdown is populated from the machine and Startup Params follows the flavour', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Flavours', 'C:/c/flavours');
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');

    const flavour = win.getByTestId('terminal-flavour');
    await expect(flavour).toBeVisible();

    // Command Prompt is always present on Windows → it is a detected built-in.
    const values = await flavour
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(values).toContain('cmd');

    // Selecting a flavour fills Startup Params with that flavour's default (FR-011/012).
    await flavour.selectOption('cmd');
    await expect(win.getByTestId('terminal-params')).toHaveValue('/K');

    // Changing the flavour updates Startup Params again (FR-012).
    if (values.includes('windows-powershell')) {
      await flavour.selectOption('windows-powershell');
      await expect(win.getByTestId('terminal-params')).toHaveValue('-NoLogo');
    }
  });
});

test('a user-defined flavour added to settings.json appears in the dropdown (hot-reload, FR-010a)', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'UserFlav', 'C:/c/userflav');
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        const flavour = win.getByTestId('terminal-flavour');
        await expect(flavour).toBeVisible();

        // Not present until the user adds it.
        await expect(flavour.locator('option[value="my-wsl"]')).toHaveCount(0);

        // Add a user flavour to settings.json → config hot-reload → it appears.
        writeFileSync(
          join(cfg, 'settings.json'),
          JSON.stringify(
            {
              terminals: {
                flavours: [
                  { id: 'my-wsl', label: 'WSL: Ubuntu', file: 'wsl.exe', args: ['-d', 'Ubuntu'], defaultParams: '--cd ~' },
                ],
              },
            },
            null,
            2,
          ),
          'utf8',
        );
        await expect(flavour.locator('option[value="my-wsl"]')).toHaveCount(1);

        // And it carries its own default Startup Params.
        await flavour.selectOption('my-wsl');
        await expect(win.getByTestId('terminal-params')).toHaveValue('--cd ~');
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});
