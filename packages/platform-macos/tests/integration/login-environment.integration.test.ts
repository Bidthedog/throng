/**
 * Layer: integration — what PATH a shell ends up with is decided by the real `/etc/zprofile` and `path_helper` on the
 * runner, which no fake reproduces (070 FR-017, research R9). The launch spec is built under macOS's own traits and
 * started through the real pty host with the short PATH launchd gives an app started from the Dock.
 */
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { BUILTIN_FLAVOUR_COMMAND_RECIPES, resolveLaunchSpec } from '@throng/core';
import { skipUnlessMacos, withHostTraits } from '@throng/core/testing';
import { MacosPtyHost } from '../../src/macos-pty-host.js';

/** launchd's PATH for an app started from the Dock or Finder. */
const DOCK_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

describe.skipIf(skipUnlessMacos('path_helper and the login profile are macOS’s'))('a terminal’s login environment on macOS', () => {
  it('sees the login shell’s PATH, not the short one throng was started with', { timeout: 30_000 }, async () => {
    const spec = withHostTraits('macos', () =>
      resolveLaunchSpec({ id: 'zsh', file: '/bin/zsh', args: [], commandRecipe: BUILTIN_FLAVOUR_COMMAND_RECIPES.zsh }, '', tmpdir()),
    );
    expect(spec.args).toContain('-l');

    const host = new MacosPtyHost({ graceMs: 100 });
    const handle = host.start({ ...spec, cols: 200, rows: 24, baseEnv: { HOME: process.env.HOME ?? '', USER: process.env.USER ?? '', PATH: DOCK_PATH } });
    let output = '';
    host.onData(handle, (chunk) => (output += chunk));
    try {
      // The marker is split in the typed line, so the terminal's echo of it can never match what the shell prints.
      host.write(handle, 'echo "SEEN""PATH=[$PATH]"\r');
      const printed = /SEENPATH=\[([^\]]*)\]/;
      const deadline = Date.now() + 15_000;
      while (!printed.test(output) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      const seen = printed.exec(output)?.[1] ?? '';
      // `/etc/paths` names /usr/local/bin, and path_helper puts it on a login shell's PATH.
      expect(seen.split(':')).toContain('/usr/local/bin');
    } finally {
      await host.end(handle, 8000);
    }
  });
});
