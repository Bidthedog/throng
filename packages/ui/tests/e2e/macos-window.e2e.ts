import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  APP_CLOSE_TIMEOUT_MS,
  NEW_WINDOW_TIMEOUT_MS,
  TERMINAL_OUTPUT_TIMEOUT_MS,
  cleanupTemp,
  createProject,
  firstPanelId,
  runApp,
  runTypedCommand,
  stopTracingBeforeExit,
} from './harness.js';

/**
 * Layer: E2E. Window chrome, the menu bar, the Dock and full screen are answered by macOS itself — AppKit's traffic
 * lights, its application menu, `activate`, `open-file` and the full-screen Space — which no lower layer has (070
 * FR-026, FR-027, FR-028, FR-024, SC-005, US4 scenarios 1–4). The pure halves are unit-tested: the menu template
 * (`app-menu.test.ts`), the close/quit state machine (`mac-lifecycle.test.ts`), `open-file` (`open-file.test.ts`) and
 * every shipped Cmd chord's resolution (`chord-key-macos.test.ts`). This file proves the wiring on a real Mac.
 * macOS's own lane: `@macos` runs on the hosted macOS runners and nowhere else.
 */
test.skip(process.platform !== 'darwin', 'macOS window chrome, menu bar and Dock');

const mainWindowState = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0];
    return w
      ? { visible: w.isVisible(), fullScreen: w.isFullScreen(), bounds: w.getBounds(), lights: w.getWindowButtonPosition() }
      : null;
  });

/** Click an item of the macOS menu bar through Electron's own Menu API; false when it is not there. */
/**
 * Run an app-menu item as choosing it would. On macOS Electron hands a native role (`quit`, `hide`, `unhide`, `about`)
 * to AppKit from the real menu, and a `MenuItem.click()` from JavaScript does nothing for one, so those run through
 * the app method the native menu ends in; every other item is clicked. Answers whether the item exists.
 */
const clickMenuItem = (app: ElectronApplication, menu: string, item: string): Promise<boolean> =>
  app.evaluate(
    ({ Menu, app: a }, [m, i]) => {
      const found = Menu.getApplicationMenu()?.items.find((x) => x.label === m)?.submenu?.items.find((x) => x.label === i);
      if (found === undefined) return false;
      const native: Record<string, () => void> = {
        quit: () => a.quit(),
        hide: () => a.hide(),
        unhide: () => a.show(),
        about: () => a.showAboutPanel(),
      };
      const run = native[(found.role ?? '').toLowerCase()];
      if (run) run();
      else found.click();
      return true;
    },
    [menu, item] as const,
  );

async function startTerminal(win: Page, panelId: string): Promise<ReturnType<Page['getByTestId']>> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('zsh');
  await win.getByTestId(`panel-type-confirm-${panelId}`).click();
  const term = win.getByTestId(`terminal-${panelId}`);
  await expect(term).toBeVisible();
  return term;
}

test('the window has the native traffic lights in throng’s title bar, and no window controls of its own', { tag: ['@macos', '@extended', '@window', '@reserve:window'] }, async () => {
  await runApp(async (app, win) => {
    await expect(win.getByTestId('title-bar')).toBeVisible();
    await expect(win.getByTestId('window-controls')).toHaveCount(0);
    const state = await mainWindowState(app);
    expect(state?.lights).toEqual({ x: 12, y: 11 });
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isClosable())).toBe(true);
  });
});

test('every app-menu item exists, and throng’s own run through the Menu API', { tag: ['@macos', '@extended', '@window', '@reserve:native'] }, async () => {
  await runApp(async (app, win) => {
    await expect(win.getByTestId('project-new')).toBeVisible();
    const labels = await app.evaluate(({ Menu }) =>
      Object.fromEntries(
        (Menu.getApplicationMenu()?.items ?? []).map((m) => [m.label, (m.submenu?.items ?? []).filter((i) => i.type !== 'separator').map((i) => i.label)]),
      ),
    );
    expect(labels.throng).toEqual(
      expect.arrayContaining(['About throng', 'Settings…', 'Hide throng', 'Hide Others', 'Show All', 'Quit throng']),
    );
    expect(Object.keys(labels)).toEqual(['throng', 'Edit', 'Window', 'Help']);

    const prefs = app.waitForEvent('window', { predicate: (w) => w.url().includes('prefs='), timeout: NEW_WINDOW_TIMEOUT_MS });
    expect(await clickMenuItem(app, 'throng', 'Settings…')).toBe(true);
    await expect((await prefs).getByTestId('preferences-window')).toBeVisible();

    // The Settings window's activation can land after a Hide given at once and show the app again: Hide is chosen
    // again until it holds, as a person would, and a Hide that never holds still fails after 15 s (070).
    await expect(async () => {
      expect(await clickMenuItem(app, 'throng', 'Hide throng')).toBe(true);
      await expect.poll(() => app.evaluate(({ app: a }) => a.isHidden()), { timeout: 2_000 }).toBe(true);
    }).toPass({ timeout: 15_000 });
    expect(await clickMenuItem(app, 'throng', 'Show All')).toBe(true);
    await app.evaluate(({ app: a }) => a.show());
    await expect.poll(() => app.evaluate(({ app: a }) => a.isHidden())).toBe(false);
  });
});

test('closing the window leaves throng running in the Dock, and activating it restores the layout', { tag: ['@macos', '@extended', '@window', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-dock-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Dock', root);
      await win.getByTestId('tab-add').click();
      await expect(win.locator('.tab-chip')).toHaveCount(2);

      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]?.close());
      await expect.poll(async () => (await mainWindowState(app))?.visible).toBe(false);
      // No quit flow: no closing overlay was raised, and the process is still here.
      expect(app.process().exitCode).toBeNull();

      await app.evaluate(({ app: a }) => a.emit('activate'));
      await expect.poll(async () => (await mainWindowState(app))?.visible).toBe(true);
      await expect(win.locator('.tab-chip')).toHaveCount(2);
      await expect(win.getByTestId('app-closing-overlay')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a tab torn off opens a sub-workspace window with the native traffic lights', { tag: ['@macos', '@extended', '@window', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-tear-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Tear', root);
      await win.getByTestId('tab-add').click();
      const firstTab = win.locator('.tab-chip').first();
      await firstTab.click();
      await firstTab.click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').click();
      const [child] = await Promise.all([app.waitForEvent('window'), win.getByTestId('menu-item-New Sub-workspace').click()]);
      await expect(child.getByTestId('subworkspace-window')).toBeVisible();
      await expect(child.getByTestId('window-controls')).toHaveCount(0);
      const lights = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id).at(-1)?.getWindowButtonPosition(),
      );
      expect(lights).toEqual({ x: 12, y: 11 });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('full screen enters and leaves on Ctrl+Cmd+F', { tag: ['@macos', '@extended', '@window', '@reserve:window'] }, async () => {
  await runApp(async (app, win) => {
    await expect(win.getByTestId('project-new')).toBeVisible();
    await win.locator('body').click();
    // view.fullscreen on macOS is Ctrl+Cmd+F, the system's own chord; F11 is Show Desktop there.
    await win.keyboard.press('Control+Meta+KeyF');
    await expect.poll(async () => (await mainWindowState(app))?.fullScreen, { timeout: 10_000 }).toBe(true);
    await win.keyboard.press('Control+Meta+KeyF');
    await expect.poll(async () => (await mainWindowState(app))?.fullScreen, { timeout: 10_000 }).toBe(false);
  });
});

test('saved geometry is restored after a quit and relaunch', { tag: ['@macos', '@extended', '@window', '@reserve:window'] }, async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-geometry-'));
  // Bounds inside the display's work area: macOS moves and shrinks a frame that does not fit, and a hosted runner's
  // screen is small (1000x700 at 140,120 came back as 1000x677 at 140,31).
  let wanted = { x: 0, y: 0, width: 0, height: 0 };
  try {
    await runApp(
      async (app, win) => {
        await expect(win.getByTestId('project-new')).toBeVisible();
        wanted = await app.evaluate(({ screen }) => {
          const area = screen.getPrimaryDisplay().workArea;
          const width = Math.min(900, area.width - 80);
          const height = Math.min(560, area.height - 80);
          return { x: area.x + 40, y: area.y + 40, width, height };
        });
        await app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0]?.setBounds(b), wanted);
        await expect.poll(async () => (await mainWindowState(app))?.bounds).toEqual(wanted);
        const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
        await stopTracingBeforeExit(app);
        expect(await clickMenuItem(app, 'throng', 'Quit throng')).toBe(true);
        await exited;
      },
      { userDataDir },
    );
    await runApp(
      async (app) => {
        await expect.poll(async () => (await mainWindowState(app))?.bounds).toEqual(wanted);
      },
      { userDataDir },
    );
  } finally {
    cleanupTemp(userDataDir);
  }
});

test('a folder opened from Finder or the Dock (open-file) opens as a project while throng runs', { tag: ['@macos', '@extended', '@window', '@reserve:runtime'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-openfile-'));
  try {
    await runApp(async (app, win) => {
      await expect(win.getByTestId('project-new')).toBeVisible();
      // macOS emits this for a Dock drop or Open With; the event is emitted on the real app object, as AppKit would.
      await app.evaluate(({ app: a }, p) => a.emit('open-file', { preventDefault: () => undefined }, p), root);
      await expect(win.locator('.project-item').filter({ hasText: basename(root) })).toHaveCount(1, { timeout: 15_000 });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Quit shows the closing progress, asks about running terminals, and exits', { tag: ['@macos', '@extended', '@window', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-quit-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Quit', root);
      const term = await startTerminal(win, await firstPanelId(win));
      await runTypedCommand(win, term, 'echo QUIT_READY', { echoed: 'echo QUIT_READY', output: 'QUIT_READY' });

      const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
      await stopTracingBeforeExit(app);
      expect(await clickMenuItem(app, 'throng', 'Quit throng')).toBe(true);
      await win.getByTestId('app-close-terminate').click();
      // The progress shows while the shutdown runs; a quick one can finish and close the page before a check lands,
      // so the overlay appearing and the process exiting first are both the quit going ahead.
      const shown = win
        .getByTestId('app-closing')
        .waitFor({ state: 'visible', timeout: APP_CLOSE_TIMEOUT_MS })
        // A wait the closing page cut short is the exit arriving: it is "not shown" only if no exit follows.
        .then(
          () => 'shown' as const,
          () => Promise.race([exited.then(() => 'exited' as const), new Promise<'not-shown'>((r) => setTimeout(() => r('not-shown'), 10_000))]),
        );
      expect(await Promise.race([shown, exited.then(() => 'exited' as const)])).not.toBe('not-shown');
      await Promise.race([
        exited,
        new Promise((_, reject) => setTimeout(() => reject(new Error('throng did not exit after Quit')), APP_CLOSE_TIMEOUT_MS)),
      ]);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Cmd chords run throng’s commands, and Ctrl+C still reaches the shell', { tag: ['@macos', '@extended', '@window', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-chords-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Chords', root);
      // view.toggleExplorer: Cmd+Shift+Option+K on macOS (Ctrl+Shift+Alt+K elsewhere).
      await win.locator('body').click();
      await expect(win.getByTestId('pane-hide-right')).toBeVisible();
      await win.keyboard.press('Meta+Shift+Alt+KeyK');
      await expect(win.getByTestId('pane-rail-right')).toBeVisible();
      await win.keyboard.press('Meta+Shift+Alt+KeyK');
      await expect(win.getByTestId('pane-hide-right')).toBeVisible();

      const term = await startTerminal(win, await firstPanelId(win));
      await runTypedCommand(win, term, 'sleep 300', { echoed: 'sleep 300', output: 'sleep 300' });
      await term.click();
      await win.keyboard.press('Control+c');
      await runTypedCommand(win, term, 'echo AFTER_$((6*7))', { echoed: 'echo AFTER_', output: 'AFTER_42', timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
    });
  } finally {
    cleanupTemp(root);
  }
});
