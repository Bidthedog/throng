import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { runApp, createProject, firstPanelId, panelIds, reloadWindow } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * Issue #86 — deferred writes and the app's shutdown paths.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE FOUND, AND WHY IT IS NOT SHAPED THE WAY THE ISSUE IS WRITTEN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The issue reports a language override lost to a **Terminate All** close, and reasons that the
 * terminate-all path must tear the app down without draining in-flight writes. Driven for real,
 * BOTH halves of that come out the other way round:
 *
 *  1. THE OVERRIDE IS NOT LOST — on either exit. `setDocumentOverride` is described as async, and it
 *     is, but it is an AWAITED IPC with no debounce behind it, and the daemon's `document.setState`
 *     is a SYNCHRONOUS SQLite write (`packages/daemon/src/document-service.ts:67`). The window is a
 *     couple of milliseconds wide and nothing in a close beats it. The tests below hold that as a
 *     guard rather than deleting it: it is the issue's headline claim, and "we checked, it holds" is
 *     worth keeping green.
 *
 *  2. THE LEAKY EXIT IS THE ORDINARY ONE. What IS deferred is `workspace.save` — the layout blob,
 *     which carries BOTH the split/panel structure and per-panel zoom — behind a 400ms debounce
 *     (`packages/ui/src/renderer/state/workspace-store.tsx:42`). Nothing drains it on shutdown; the
 *     store's `flushSave` is wired only to a project switch and to unmount
 *     (`workspace-store.tsx:121-164`), and no close path calls it.
 *
 *     Terminate-all SURVIVES anyway, by ACCIDENT: its three-choice prompt stalls the close for
 *     ~900ms (measured: dialog up at 21ms, window gone at 917ms), which is longer than the debounce,
 *     so the timer fires while the user is reading the dialog. The ORDINARY close has no prompt to
 *     stall on — it closes on a 250ms timer (`packages/ui/src/main/main.ts:661-663`) — and 250 < 400,
 *     so the pending write dies with the renderer.
 *
 * So the reported journey is real but the blame is inverted: the user who loses work is the one who
 * closes NORMALLY, and what they lose is their layout and zoom, not their language. A fix that
 * special-cases terminate-all would harden the one path that already works and leave the broken one
 * alone.
 *
 * The failing tests here are therefore the ordinary-close ones. The terminate-all tests pass, and
 * are kept deliberately — they are what pins the asymmetry down, and they are what would catch a
 * "fix" that drains one exit and not the other.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-ta-drain-'));
  // No extension: detection cannot place it, so the strip reads Plain Text and the ONLY thing that
  // can make it Shell is the user's persisted override. "Shell" cannot come from anywhere else.
  writeFileSync(join(root, 'scriptfile'), 'echo "hello"\n');
  return root;
}

/** Open `file` into `pid` as an editor panel. */
async function openEditorOn(win: Page, pid: string, file: string, contains: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(contains, {
    timeout: 8000,
  });
}

/** Add a sibling panel and turn it into a running cmd terminal — the close warning's precondition. */
async function addTerminalPanel(win: Page, hostPid: string, root: string): Promise<string> {
  await win.getByTestId(`panel-add-${hostPid}`).click();
  await win.keyboard.press('Enter');
  const pid = (await panelIds(win)).find((id) => id !== hostPid)!;
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  // A SPLIT panel is narrow, so cmd's prompt path wraps across xterm rows — match only the trailing
  // chars, which stay contiguous on the final wrapped row.
  await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root).slice(-6), {
    timeout: 15000,
  });
  return pid;
}

/**
 * Close the app the way the issue describes: request the close, get the three-choice warning
 * (a terminal is running), and answer **Terminate all**.
 *
 * This is the shutdown path the issue blames. Note that neither `app.close()` nor the harness's own
 * teardown reaches it — both DESTROY the window, which fires no `close` event at all, so the whole
 * handshake in `main.ts` is bypassed. That is why no existing spec covers this.
 */
async function terminateAllClose(app: ElectronApplication, win: Page): Promise<void> {
  const closed = app.waitForEvent('close', { timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect(win.getByTestId('app-close-dialog')).toBeVisible({ timeout: 15_000 });
  await win.getByTestId('app-close-terminate').click();
  await closed;
}

/**
 * Close the app with NO terminals running: no prompt, a "closing" overlay, and a 250ms timer.
 *
 * This is the exit the issue calls "the ordinary way" and treats as the CONTROL — the one that
 * "preserves it correctly". It is in fact the one with the shortest fuse.
 */
async function ordinaryClose(app: ElectronApplication): Promise<void> {
  const closed = app.waitForEvent('close', { timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await closed;
}

/**
 * Prepare an ordinary close addressed at a SPECIFIC window rather than at `getAllWindows()[0]`,
 * and hand back the trigger.
 *
 * TWO separate reasons, and the split into prepare-then-fire is the second of them:
 *
 *  - `[0]` is only the main window while there is ONE window. Measured with a sub-workspace
 *    window open, `[0]` was the CHILD — closing it left the main window alive, the app never
 *    quit, and the test failed for a reason that had nothing to do with the drain.
 *  - `app.browserWindow()` is a CDP round-trip, and MEASURED it costs more than a 400ms
 *    debounce all by itself. Paying for it AFTER the decision lets the timer fire while the
 *    harness is still looking the window up — the test then passes with the drain doing
 *    nothing, which is the anti-pattern this file already calls out for the Themes case.
 *    Resolving the handle up front leaves ONE `evaluate` between the decision and the close,
 *    which is the race the user is actually in.
 */
async function armMainWindowClose(
  app: ElectronApplication,
  main: Page,
): Promise<() => Promise<void>> {
  const handle = await app.browserWindow(main);
  return async () => {
    const closed = app.waitForEvent('close', { timeout: 20_000 });
    await handle.evaluate((w) => w.close());
    await closed;
  };
}

/** The first project's id, via the daemon (session 2 has no memory of session 1's ids). */
async function firstProjectId(win: Page): Promise<string> {
  return win.evaluate(async () => {
    const env = (await window.throng?.invoke?.('projects.list', {})) as {
      result: { projects: { id: string }[] };
    };
    return env.result.projects[0].id;
  });
}

/** The persisted language override for `relPath`, read straight from the store. */
async function storedOverride(win: Page, projectId: string, relPath: string): Promise<string | null> {
  return win.evaluate(
    async ({ projectId: id, relPath: p }) => {
      const env = (await window.throng?.invoke?.('document.getState', {
        projectId: id,
        relPath: p,
      })) as { result: { state: { languageId: string } | null } };
      return env.result.state?.languageId ?? null;
    },
    { projectId, relPath },
  );
}

/** Every panel in the persisted layout blob, flattened out of the split tree. */
async function storedPanels(
  win: Page,
  projectId: string,
): Promise<{ id: string; zoom: number }[]> {
  return win.evaluate(
    async ({ projectId: id }) => {
      const env = (await window.throng?.invoke?.('workspace.load', { projectId: id })) as {
        result: { layout: unknown };
      };
      const out: { id: string; zoom: number }[] = [];
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const o = node as Record<string, unknown>;
        // A panel is `{ type: 'panel', id, zoom? }`; `zoom` is ABSENT until it is set, and
        // `panelZoomLevel` treats absent and 0 identically — so normalise here rather than
        // letting `undefined` reach an assertion as a distinct value.
        if (o.type === 'panel' && typeof o.id === 'string') {
          out.push({ id: o.id, zoom: (o.zoom as number) ?? 0 });
        }
        for (const v of Object.values(o)) {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') walk(v);
        }
      };
      walk(env.result.layout);
      return out;
    },
    { projectId },
  );
}

/** The `appearance.theme` stored in settings.json, or `null` if it is not there to read. */
function readSettingsTheme(cfgRoot: string): string | null {
  try {
    const doc = JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8')) as {
      appearance?: { theme?: string };
    };
    return doc.appearance?.theme ?? null;
  } catch {
    return null;
  }
}

/** Replace the CodeMirror buffer's content (CM ignores `fill`), as `preferences-json.e2e.ts` does. */
async function setEditorText(prefs: Page, kind: string, content: string): Promise<void> {
  const editor = prefs.getByTestId(`json-editor-${kind}`).locator('.cm-content');
  await editor.click();
  await prefs.keyboard.press('Control+A');
  await editor.pressSequentially(content);
}

/** The accent colour stored in a theme's file, or `null` if it is not there to read. */
function readThemeAccent(cfgRoot: string, name: string): string | null {
  try {
    const doc = JSON.parse(readFileSync(join(cfgRoot, 'themes', `${name}.json`), 'utf8')) as {
      colours?: { accent?: string };
    };
    return doc.colours?.accent ?? null;
  } catch {
    return null; // not seeded yet
  }
}

/** Zoom one panel in by two presses. ZOOM_STEP is 0.5, so two presses is level 1 — not 2. */
async function zoomInTwice(win: Page, pid: string): Promise<void> {
  await win.getByTestId(`panel-${pid}`).click();
  await win.keyboard.press('Control+Alt+Equal');
  await win.keyboard.press('Control+Alt+Equal');
  await expect(win.getByTestId(`panel-${pid}`)).toHaveAttribute('data-zoom', '1');
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC1 — "An override set immediately before a Terminate All close is present after the next launch."
// AC4 — "A regression test drives the terminate-all shutdown path, not just the ordinary one."
//
// PASSES. The reported symptom does not reproduce; kept as the guard that says so.
// ═══════════════════════════════════════════════════════════════════════════════

test('#86 AC1/AC4: a language override set immediately before TERMINATE ALL survives the next launch', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-ta-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-ta-user-'));
  let projectId = '';
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'TermAllProj', root);
        projectId = await firstProjectId(win);

        const editorPid = await firstPanelId(win);
        await openEditorOn(win, editorPid, 'scriptfile', 'echo');
        await addTerminalPanel(win, editorPid, root); // what makes the close WARN rather than quit

        // Let the LAYOUT settle before the decision under test, deliberately: this test is about the
        // OVERRIDE, and a layout write lost in the same shutdown could otherwise explain a failure
        // all by itself (the panel simply not reopening on the file). Blame stays isolated.
        await win.waitForTimeout(1500);

        await expect(win.getByTestId(`editor-language-${editorPid}`)).toHaveText('Plain Text');

        // THE DECISION. Two clicks, exactly as a user makes it (the issue's steps 1-2).
        await win.getByTestId(`editor-language-${editorPid}`).click();
        await expect(win.getByTestId(`language-picker-${editorPid}`)).toBeVisible();
        await win.getByTestId(`language-filter-${editorPid}`).fill('shell');
        await win.getByTestId('language-option-shell').click();

        // The user's confirmation that it took — the ONLY signal they get. Everything after this
        // point, they are entitled to believe is remembered.
        await expect(win.getByTestId(`editor-language-${editorPid}`)).toHaveText('Shell');

        // …and now they close. No sleep: "set it, then close" is the whole bug report.
        await terminateAllClose(app, win);
      },
      { dataDir, userDataDir },
    );

    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'TermAllProj' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();

        // Assert the STORE first: this separates "the write never landed" (a drain bug) from "the
        // write landed but the UI does not read it" (a load bug). They demand different fixes, and
        // a UI-only assertion cannot tell them apart.
        expect(
          await storedOverride(win, projectId, 'scriptfile'),
          'the override the user set before Terminate All must be IN THE STORE',
        ).toBe('shell');

        // …and it must reach the user, which is the thing they actually asked for.
        const editor = win.locator('.editor-panel').first();
        await expect(editor).toBeVisible({ timeout: 10_000 });
        await expect(editor.locator('.cm-content')).toContainText('echo', { timeout: 10_000 });
        await expect(win.locator('.editor-status-strip__language').first()).toHaveText('Shell', {
          timeout: 10_000,
        });
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC3 — "…covers whether OTHER deferred writes are lost on the same path (layout, per-panel zoom…)"
//
// THE BLAST RADIUS. Layout and per-panel zoom are ONE deferred write (`workspace.save`, 400ms).
// Both tests below FAIL, and they fail on the ORDINARY close — the exit the issue treats as safe.
// ═══════════════════════════════════════════════════════════════════════════════

test('#86 AC3: a layout change made immediately before an ORDINARY close survives the next launch', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-oc-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-oc-user-'));
  let projectId = '';
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'LayoutOrdinary', root);
        projectId = await firstProjectId(win);

        const editorPid = await firstPanelId(win);
        await openEditorOn(win, editorPid, 'scriptfile', 'echo');

        // Baseline (ONE panel) is safely stored, so a failure below can only be the NEW write.
        await win.waitForTimeout(1500);
        expect(await storedPanels(win, projectId), 'baseline must be stored first').toHaveLength(1);

        // THE DECISION: add a panel — an ordinary, visible structural edit the user watches happen.
        await win.getByTestId(`panel-add-${editorPid}`).click();
        await win.keyboard.press('Enter');
        await expect(win.locator('.panel-box')).toHaveCount(2);

        // …and close. NO terminals running, so this is the "ordinary way" the issue calls safe:
        // no prompt, and a 250ms fuse against a 400ms debounce.
        await ordinaryClose(app);
      },
      { dataDir, userDataDir },
    );

    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'LayoutOrdinary' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();
        await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 10_000 });

        const panels = await storedPanels(win, projectId);
        expect(
          panels.length,
          `the panel added before closing must be IN THE STORE (stored: ${JSON.stringify(panels)})`,
        ).toBe(2);
        await expect(win.locator('.panel-box')).toHaveCount(2);
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('#86 AC3: a per-panel zoom set immediately before an ORDINARY close survives the next launch', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-ocz-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-ocz-user-'));
  let projectId = '';
  let editorPid = '';
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'ZoomOrdinary', root);
        projectId = await firstProjectId(win);

        editorPid = await firstPanelId(win);
        await openEditorOn(win, editorPid, 'scriptfile', 'echo');
        await win.waitForTimeout(1500); // baseline layout safely stored

        // THE DECISION: zoom the panel in, via the real keyboard chord.
        await zoomInTwice(win, editorPid);

        await ordinaryClose(app);
      },
      { dataDir, userDataDir },
    );

    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'ZoomOrdinary' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();
        await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 10_000 });

        const panels = await storedPanels(win, projectId);
        const panel = panels.find((p) => p.id === editorPid);
        expect(
          panel?.zoom,
          `the zoom the user set before closing must be IN THE STORE (stored: ${JSON.stringify(panels)})`,
        ).toBe(1);
        // …and it must come back on screen, not merely sit in the blob.
        await expect(win.getByTestId(`panel-${editorPid}`)).toHaveAttribute('data-zoom', '1');
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// The drain reaches EVERY window the closing app owns, not just the one being closed.
//
// A drain that reaches some windows and not others leaves the bug half-fixed for exactly the
// multi-window users most likely to have a layout worth keeping — so it names no window and
// asks `getAllWindows()` instead.
// ═══════════════════════════════════════════════════════════════════════════════

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 600, height: 400 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

/** Every panel id in sub-workspace `sw1`, read back from the daemon's persisted set. */
async function storedSubPanels(win: Page): Promise<string[]> {
  return win.evaluate(async () => {
    const env = (await window.throng?.invoke?.('workspace.loadSubWorkspaces', {})) as {
      result: { subWorkspaces: Array<{ id: string; tabs: unknown[] }> };
    };
    const sub = env.result.subWorkspaces.find((s) => s.id === 'sw1');
    const out: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (o.type === 'panel' && typeof o.id === 'string') out.push(o.id);
      for (const v of Object.values(o)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    };
    (sub?.tabs ?? []).forEach(walk);
    return out;
  });
}

test('#86 C6: a SUB-WORKSPACE rearrangement survives closing the MAIN window', async () => {
  skipIfElevated();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-sw-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-sw-user-'));
  // Written by MAIN when the child's renderer dies; read once the app is gone.
  const childDiedStamp = join(userDataDir, 'child-died-at.txt');
  let armedAt = 0;
  try {
    await runApp(
      async (app, win) => {
        // Detach is not drivable from the UI, so seed the sub-workspace and reload — the same
        // route `subworkspaces.e2e.ts` uses, and it exercises the lazy startup listing too.
        await win.evaluate(seedSub);
        await reloadWindow(win);
        await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

        // Open its detached window: this is the second WorkspaceProvider, with its own layout
        // write behind its own debounce, in a window the closing user never touches.
        const [child] = await Promise.all([
          app.waitForEvent('window'),
          win.getByTestId('subworkspace-open-sw1').click(),
        ]);
        await child.waitForLoadState('domcontentloaded');
        await expect(child.getByTestId('subworkspace-window')).toBeVisible({ timeout: 10_000 });
        await expect(child.locator('.panel-box')).toHaveCount(1);
        await child.waitForTimeout(1500); // baseline safely stored, so a failure is the NEW write

        // Everything the close needs, resolved BEFORE the decision arms the debounce (see
        // `armMainWindowClose`). Without this the harness's own CDP round-trip outlasts the
        // 400ms timer and the test cannot fail.
        const closeMain = await armMainWindowClose(app, win);

        // Stamp the instant the CHILD's renderer actually dies, from MAIN. Not from the
        // harness: `child.waitForEvent('close')` can only be read after the app has gone, so it
        // reports the app's teardown (measured: 500ms) rather than the window's death, and the
        // premise below is a claim about the WINDOW.
        await app.evaluate(({ BrowserWindow }, file) => {
          // `process.getBuiltinModule`, not `import()`: this function is EVAL'd in main, and an
          // eval context has no dynamic-import callback ("A dynamic import callback was not
          // specified"). The stamp must be written synchronously from the handler anyway — the
          // app is on its way out.
          const { writeFileSync } = process.getBuiltinModule('node:fs');
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w.webContents.getURL().includes('sw=')) continue;
            w.webContents.once('destroyed', () => writeFileSync(file, String(Date.now())));
          }
        }, childDiedStamp);

        // THE DECISION, made in the SUB-WORKSPACE window. The debounce is armed by the Enter,
        // so the race starts HERE — before the assertion that confirms it, which is the user's
        // read of the screen and not part of the window they get.
        await child.getByTestId('panel-add-p').click();
        await child.keyboard.press('Enter');
        armedAt = Date.now();
        await expect(child.locator('.panel-box')).toHaveCount(2);

        // …and the user closes the MAIN window, which takes the group down with it
        // (`WindowManager.closeChildren`). The child never gets a close of its own to react to.
        await closeMain();
      },
      { dataDir, userDataDir },
    );

    // THE PREMISE, MEASURED. C6 is the claim that the cascade drains the CHILD's layout, and
    // only a child that dies inside its own 400ms debounce can prove it: one that outlives the
    // timer saved the write by itself, and the assertion below then passes with the drain
    // switched off — which is exactly the trap the Themes case above fell into, and why that
    // case is labelled a guard rather than dressed up as a proof. Asserted here instead of
    // assumed: if this box is ever slow enough to make the test vacuous, it says so out loud
    // rather than reporting a pass it did not earn.
    const childLivedMs = Number(readFileSync(childDiedStamp, 'utf8')) - armedAt;
    expect(
      childLivedMs,
      `the sub-workspace window must die INSIDE its own 400ms debounce, or its own timer saved this write and the test proves nothing about the drain (it lived ${childLivedMs}ms)`,
    ).toBeLessThan(400);

    await runApp(
      async (_app, win) => {
        const panels = await storedSubPanels(win);
        expect(
          panels.length,
          `the panel added in the SUB-WORKSPACE must be IN THE STORE (stored: ${JSON.stringify(panels)})`,
        ).toBe(2);
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// The PREFERENCES window defers writes too — and it is a SEPARATE renderer process, so the
// write module the workspace window settles is not the one holding this timer. This is the
// case that makes the drain's "ask every window, name none of them" load-bearing rather than
// decorative: a drain that reached only the workspace window would settle nothing here.
//
// The preferences window is Electron-PARENTED to the main window (`preferences-window.ts`), not
// registered in `WindowManager`'s cascade, so closing main destroys it natively — firing no
// unmount, which is why this tab's unmount flush (now deleted) could never have saved the edit.
//
// Asserted by READING THE THEME FILE rather than relaunching: the file IS the artefact the
// journey is about (the next launch only re-reads it).
//
// ── A GUARD, NOT A PROOF: MEASURED, IT PASSES WITH THE DRAIN DISABLED. ──
//
// The plan staged the preferences drain here on the strength of the tabs' mutual exclusivity —
// a question about which writes can be PENDING together, which is not the question of whether a
// close can BEAT one. Driven, it cannot: the ordinary close destroys the window ~250ms after the
// drain completes (`main.ts` — the beat that lets the overlay paint), and this debounce is 150ms,
// so the timer fires on its own well inside that. The Themes tab survives by the same accident
// Terminate All does, and no assertion staged on it can tell the drain from the clock.
//
// It is kept as a regression guard — it would catch a REGRESSION that lost this write — and the
// preferences drain is proved for real by the JSON-tab case below, whose 300ms debounce is the
// one that actually outlives the close.
// ═══════════════════════════════════════════════════════════════════════════════

test('#86 C19: a THEME COLOUR edit inside its 150ms debounce survives closing the MAIN window', async () => {
  skipIfElevated();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-thm-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-thm-user-'));
  // One config root: the theme file the edit under test lands in.
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-thm-root-'));
  try {
    await runApp(
      async (app, win) => {
        // Open Preferences on the Themes tab — a second, PARENTED window with its own renderer
        // process and its own copy of the write module.
        await win.getByTestId('title-bar-cog').click();
        const [prefs] = await Promise.all([
          app.waitForEvent('window'),
          win.getByTestId('cog-menu-themes').click(),
        ]);
        await prefs.waitForLoadState('domcontentloaded');
        await expect(prefs.getByTestId('themes-tab')).toBeVisible({ timeout: 10_000 });

        // The active theme's file must be SEEDED before the edit, so a missing colour afterwards
        // can only mean the write was lost — never that the file was never there.
        await expect
          .poll(() => readThemeAccent(cfgRoot, 'throng'), { timeout: 10_000 })
          .not.toBe(null);
        expect(readThemeAccent(cfgRoot, 'throng')).not.toBe('#123456');

        // Resolve the main window's handle BEFORE the edit. `app.browserWindow()` is a CDP
        // round-trip, and MEASURED it costs more than the 150ms debounce all by itself — so
        // paying for it after the edit lets the timer fire while the harness is still looking
        // the window up, and the test passes without the drain doing anything. Prefetching it
        // leaves one `evaluate` between the edit and the close, which is the race the user is
        // actually in.
        const mainHandle = await app.browserWindow(win);

        // THE DECISION: a colour edit, then the user closes at once — inside the 150ms debounce.
        const closed = app.waitForEvent('close', { timeout: 20_000 });
        await prefs.getByTestId('control-colours.accent-hex').fill('#123456');
        // The debounce is armed by the edit, so the race starts HERE.
        const armedAt = Date.now();
        await mainHandle.evaluate((w) => w.close());
        const closeRequestedAfterMs = Date.now() - armedAt;
        expect(
          closeRequestedAfterMs,
          'the close must be REQUESTED inside the 150ms debounce, or this test proves nothing',
        ).toBeLessThan(150);
        await closed;
      },
      { dataDir, userDataDir, env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );

    expect(
      readThemeAccent(cfgRoot, 'throng'),
      "the preferences window's debounced theme write must have landed",
    ).toBe('#123456');
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FR-011: THE DRAIN IS THE MECHANISM; THE BUDGET IS NOT.
//
// `shutdownDrainTimeoutMs` is a BACKSTOP against a wedged renderer, never the thing that makes
// the write land — the close waits on the ACK, not on a clock. So the layout must survive even
// at a budget of 1ms, and this test asserts exactly that.
//
// It is deliberately the INVERSE of what this task originally demanded ("at a 1ms budget the
// change must be LOST, or it is landing by luck"). Driven, that premise is false, and the reason
// is worth keeping: the drain REQUEST is sent regardless of the budget, and the renderer flushes
// the moment it arrives. The budget bounds only how long MAIN WAITS for the ack — a lapsed
// budget stops main waiting, it does not un-ask the question. #86 was never "not enough time",
// it was "nobody asked", which is why widening the clock was refused as a fix and why shrinking
// it is not a disproof.
//
// A test built on the original premise would have failed here and been "fixed" by making
// correctness depend on the budget — reintroducing the timing-race this feature exists to
// remove. The guard therefore pins the opposite: a hostile budget must NOT be able to lose the
// write.
// ═══════════════════════════════════════════════════════════════════════════════

test('#86 FR-011: a layout change survives an ORDINARY close even at a 1ms drain budget', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-bud-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-bud-user-'));
  // The backstop, wound down as far as it goes. If the budget were the mechanism, nothing here
  // could survive; the 400ms debounce alone is 400x it.
  const env = { THRONG_SHUTDOWN_DRAIN_TIMEOUT_MS: '1' };
  let projectId = '';
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'BudgetOrdinary', root);
        projectId = await firstProjectId(win);

        const editorPid = await firstPanelId(win);
        await openEditorOn(win, editorPid, 'scriptfile', 'echo');

        await win.waitForTimeout(1500);
        expect(await storedPanels(win, projectId), 'baseline must be stored first').toHaveLength(1);

        await win.getByTestId(`panel-add-${editorPid}`).click();
        await win.keyboard.press('Enter');
        await expect(win.locator('.panel-box')).toHaveCount(2);

        await ordinaryClose(app);
      },
      { dataDir, userDataDir, env },
    );

    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'BudgetOrdinary' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();
        await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 10_000 });

        const panels = await storedPanels(win, projectId);
        expect(
          panels,
          `a 1ms budget must not lose the layout: the drain ASKS regardless of it (stored: ${JSON.stringify(panels)})`,
        ).toHaveLength(2);
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// The JSON tab's apply is the LONGEST preferences debounce (300ms, `json-tab.tsx`) and the only
// config write whose timer outlives the close that is racing it — which makes this the case that
// MEASURES the drain rather than merely exercising it. See the note on the Themes case above for
// why 150ms cannot.
//
// It is also the tab C21 singled out: `JsonTab` is RE-RENDERED with a new `docId` rather than
// unmounted, so it has no unmount flush at all — nothing but the drain can save this edit.
//
// ── WHAT MAKES IT A PROOF IS THE LAST ASSERTION, NOT THE FIRST ──
//
// This being the feature's ONLY discriminating proof of the config drain, its margin is not a
// detail. `closeRequestedAfterMs < 300` looks like the guard and is not one: with the drain
// deleted, the renderer dies at `armedAt + closeRequestedAfterMs + t(terminal.list) + 250ms`
// (`main.ts` awaits a daemon round-trip, then beats 250ms so the overlay can paint), so the
// write is lost only when `closeRequestedAfterMs + t(terminal.list)` comes in under ~50ms. A
// guard at 300 is six times looser than the thing it purports to protect, and on a loaded box
// this test passes green with `settleConfigWrites()` deleted — the debounce simply fires on its
// own while the close is still asking the daemon about terminals.
//
// So the close request's timing is kept (it is a real precondition) and the DISCRIMINATOR is
// the one quantity that separates the two worlds: WHEN THE BYTES LANDED. The drain writes at
// drain time, tens of milliseconds in. The timer, if it were doing the work, cannot write before
// its own 300ms. The file's mtime tells the two apart with ~100ms of daylight either side, and
// no arithmetic about who was scheduled when.
// ═══════════════════════════════════════════════════════════════════════════════

test('#86 C19: a JSON-tab edit inside its 300ms debounce survives closing the MAIN window', async () => {
  skipIfElevated();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-jsn-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-jsn-user-'));
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-jsn-root-'));
  // The instant the debounce was armed, read back after the app is gone: the write's own
  // timestamp is only meaningful relative to it.
  let armedAt = 0;
  try {
    await runApp(
      async (app, win) => {
        await win.getByTestId('title-bar-cog').click();
        const [prefs] = await Promise.all([
          app.waitForEvent('window'),
          win.getByTestId('cog-menu-settings').click(),
        ]);
        await prefs.waitForLoadState('domcontentloaded');
        await prefs.getByTestId('prefs-mode-toggle').click();
        await expect(prefs.getByTestId('json-tab-settings')).toBeVisible({ timeout: 10_000 });

        // The baseline must NOT already be the value under test, or a pass proves nothing.
        expect(readSettingsTheme(cfgRoot)).not.toBe('Matrix');

        // Prefetch the handle: `app.browserWindow()` costs more than the debounce it is racing.
        const mainHandle = await app.browserWindow(win);

        // THE DECISION: a valid edit, then the user closes at once — inside the 300ms debounce.
        const closed = app.waitForEvent('close', { timeout: 20_000 });
        await setEditorText(prefs, 'settings', '{"appearance":{"theme":"Matrix"}}');
        // The debounce is armed by the LAST KEYSTROKE, so the race starts HERE — not before the
        // typing. Timing it from before would measure the typing too and report a close that
        // "missed" a window it was well inside.
        armedAt = Date.now();
        await mainHandle.evaluate((w) => w.close());
        const closeRequestedAfterMs = Date.now() - armedAt;
        expect(
          closeRequestedAfterMs,
          'the close must be REQUESTED inside the 300ms debounce, or this test proves nothing',
        ).toBeLessThan(300);
        await closed;
      },
      { dataDir, userDataDir, env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );

    expect(
      readSettingsTheme(cfgRoot),
      "the JSON tab's debounced apply must have landed",
    ).toBe('Matrix');

    // THE DISCRIMINATOR. The bytes are on disk — the question is who put them there. The tab's
    // own timer cannot fire before `armedAt + 300ms`; the drain fires it the moment the close
    // asks, which is tens of milliseconds in. Anything under 300 could only have been written by
    // something that did not wait for the debounce, and the drain is the only such thing in the
    // system. Asserted at 200 to leave the measurement room to breathe on a loaded box while
    // staying a clear 100ms clear of the earliest instant the timer could have done it itself.
    const landedAfterMs = statSync(join(cfgRoot, 'settings.json')).mtimeMs - armedAt;
    expect(
      landedAfterMs,
      `the DRAIN must have written this, not the 300ms timer running out (landed ${Math.round(landedAfterMs)}ms after the edit)`,
    ).toBeLessThan(200);
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// …AND THE DRAIN MUST ONLY ASK WINDOWS THAT CAN ANSWER.
//
// "Ask the list, don't recite it" is right, and this is its bill: `getAllWindows()` returns the
// DRAG GHOST too — a real BrowserWindow with no preload, loaded from a `data:` URL, HIDDEN on
// drop rather than closed ("load the shell ONCE; never re-navigate", `ghost-window.ts`). It has
// no `window.throng`, so it never registers the drain handler and can never ack. Asking it costs
// the FULL budget, every close, for the rest of any session in which the user dragged anything.
//
// The answer is not an enumeration of window kinds — that is the mistake C23 exists to refuse —
// and it is not a wider timer, which FR-011 refuses. The list is filtered on the only property
// that matters: whether the window has TOLD US it is listening.
//
// This test is about the CLOSE ITSELF, not about a write: it asserts the user gets their app
// closed, promptly, after the most ordinary gesture in the product.
// ═══════════════════════════════════════════════════════════════════════════════

/** Any window loaded from a `data:` URL — i.e. the drag ghost, which has no test page of its own. */
const ghostExists = ({ BrowserWindow }: typeof import('electron')): boolean =>
  BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().startsWith('data:text/html'));

/** …and whether one is on screen, which is what says the drag really started. */
const ghostVisible = ({ BrowserWindow }: typeof import('electron')): boolean =>
  BrowserWindow.getAllWindows().some(
    (w) => w.webContents.getURL().startsWith('data:text/html') && w.isVisible(),
  );

/** One complete drag gesture — press, move past the activation distance, drop. */
async function dragPanelOnce(app: ElectronApplication, win: Page, pid: string): Promise<void> {
  const box = await win.getByTestId(`panel-handle-${pid}`).boundingBox();
  if (!box) throw new Error('no panel handle');
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + 60, box.y + 60, { steps: 8 });
  // The gesture is not finished when the mouse has moved: the ghost is a window the MAIN
  // process opens in response, and dropping before it exists leaves the session with no ghost
  // at all — which is the test's whole premise. (Flaked 3-in-4 without this wait.)
  await expect.poll(() => app.evaluate(ghostVisible), { timeout: 5000 }).toBe(true);
  await win.mouse.up();
}

test('#86 FR-011: an ORDINARY close after a DRAG still closes promptly — the ghost cannot ack', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-gst-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-gst-user-'));
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'GhostDrain', root);
        const pid = await firstPanelId(win);

        // The gesture. Ordinary usage — and it is what puts a second, MUTE window into
        // `getAllWindows()` for the remainder of the session.
        await dragPanelOnce(app, win, pid);
        // Dropped — and STILL THERE: `stopGhost` hides it, it does not close it.
        expect(
          await app.evaluate(ghostExists),
          'the drag must leave a ghost window alive and hidden, or this test proves nothing',
        ).toBe(true);

        // Let the drag's own layout write settle: this test measures THE CLOSE, and a write
        // riding the same shutdown must not be able to explain the number below.
        await win.waitForTimeout(1500);

        // Prefetch the handle — `app.browserWindow()` is a CDP round-trip and must not be
        // counted as time the CLOSE took.
        const mainHandle = await app.browserWindow(win);
        // Measured on the WINDOW, not on the app's exit: "Closing throng…" is an overlay on
        // this window, and the user's complaint is that it sits there. (The app's PROCESS
        // outliving it is a separate, pre-existing defect — the hidden ghost keeps
        // `window-all-closed` from firing — which reproduces at a 1ms budget and so cannot be
        // what this test is measuring.)
        const gone = win.waitForEvent('close', { timeout: 20_000 });
        const requestedAt = Date.now();
        await mainHandle.evaluate((w) => w.close());
        await gone;
        const closeTookMs = Date.now() - requestedAt;

        // The close owes: a `terminal.list` round-trip, the drain (nothing pending, so it is
        // an ack a frame later), and the 250ms beat that lets the overlay paint. That is a few
        // hundred milliseconds. Waiting out `shutdownDrainTimeoutMs` (5000ms, the default, in
        // force here deliberately) on a window that was never going to answer is 5s of
        // "Closing throng…" after every session containing a drag — the budget is a BACKSTOP
        // for a wedged renderer, not a toll the ordinary user pays.
        expect(
          closeTookMs,
          `an ordinary close must not wait out the drain budget (took ${closeTookMs}ms)`,
        ).toBeLessThan(2000);
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// #110: the PROCESS, not the window. The test above deliberately measured the window close and
// noted (`:876`) that the app's process outliving it is a *separate* defect — the hidden ghost
// keeps `window-all-closed` from firing, so `app.quit()` is never reached and throng lingers in
// Task Manager after every session that contained a single drag. This measures exactly that:
// after a drag, an ORDINARY close must let the process exit on its own.
// ═══════════════════════════════════════════════════════════════════════════════

test('#110: after a DRAG, an ordinary close lets the PROCESS exit — the hidden ghost must not keep it alive', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-gex-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-gex-user-'));
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'GhostExit', root);
        const pid = await firstPanelId(win);

        // The gesture that opens the mute, hidden ghost window for the rest of the session.
        await dragPanelOnce(app, win, pid);
        expect(
          await app.evaluate(ghostExists),
          'the drag must leave a ghost window alive and hidden, or this test proves nothing',
        ).toBe(true);

        // Let the drag's own layout write settle so a write riding the shutdown cannot be what
        // holds (or releases) the process — this test is about the ghost, not about a pending write.
        await win.waitForTimeout(1500);

        // Watch the ELECTRON PROCESS, not a window. #110 is precisely that the process survives
        // every window: with the ghost alive, `window-all-closed` never fires and `app.quit()` is
        // never called, so the process never exits.
        const proc = app.process();
        const exited = new Promise<boolean>((resolve) => proc.once('exit', () => resolve(true)));

        // Prefetch the handle (a CDP round-trip) before starting the close.
        const mainHandle = await app.browserWindow(win);
        await mainHandle.evaluate((w) => w.close()); // the ORDINARY close path (no terminals → no prompt)

        const didExit = await Promise.race([
          exited,
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15_000)),
        ]);
        expect(
          didExit,
          'the app process must exit on its own after an ordinary close, even with a drag ghost alive (#110)',
        ).toBe(true);
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC4 / SC-005 claim the override survives EITHER exit. Only Terminate All was ever measured
// (`:182`). This measures the other one, and is expected GREEN on the first run: the mechanism
// says it cannot fail. If it is ever RED, #86 is wider than it was reproduced to be.
// ═══════════════════════════════════════════════════════════════════════════════

test('#86 AC4: a language override set immediately before an ORDINARY close survives the next launch', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-ocl-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-ocl-user-'));
  let projectId = '';
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'LangOrdinary', root);
        projectId = await firstProjectId(win);

        const editorPid = await firstPanelId(win);
        await openEditorOn(win, editorPid, 'scriptfile', 'echo');

        // Let the LAYOUT settle before the decision under test, exactly as the Terminate All
        // case above does and for the same reason: this test is about the OVERRIDE, and the
        // layout write riding the same shutdown would otherwise explain a failure all by
        // itself — the panel simply not reopening on the file, so the strip has nothing to
        // read. Measured: with the drain removed, this test fails ONLY on the strip, while
        // the override sits correctly in the store. Blame stays isolated.
        await win.waitForTimeout(1500);

        await expect(win.getByTestId(`editor-language-${editorPid}`)).toHaveText('Plain Text');

        await win.getByTestId(`editor-language-${editorPid}`).click();
        await expect(win.getByTestId(`language-picker-${editorPid}`)).toBeVisible();
        await win.getByTestId(`language-filter-${editorPid}`).fill('shell');
        await win.getByTestId('language-option-shell').click();
        await expect(win.getByTestId(`editor-language-${editorPid}`)).toHaveText('Shell');

        await ordinaryClose(app); // no sleep: "set it, then close" is the whole bug report
      },
      { dataDir, userDataDir },
    );

    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'LangOrdinary' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();

        expect(
          await storedOverride(win, projectId, 'scriptfile'),
          'the override set before an ordinary close must be IN THE STORE',
        ).toBe('shell');
        await expect(win.locator('.editor-status-strip__language').first()).toHaveText('Shell', {
          timeout: 10_000,
        });
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// The WORKSPACE window writes config too (`projects-panel.tsx` → `writeConfig`), which is why
// the drain is not gated on "a preferences window".
//
// Creating a project with a chosen root folder is the ONLY path to `persistLastProjectFolder`.
// A RENAME cannot prove this — it goes through `updateProject` → an awaited SQLite IPC that
// never touches `writeConfig` at all.
//
// ── THIS IS A GUARD, NOT A PROOF. MEASURED, IT PASSES WITH THE DRAIN DISABLED. ──
//
// It is kept, and labelled, rather than dressed up: C23 justified widening the drain to every
// window by saying a preferences-only gate "would have acked `projects-panel.tsx:208`'s write in
// flight". Driven, that write CANNOT be lost, and the reason matters — it is UNDEBOUNCED, so
// `void writeConfig(…)` has already handed the payload to main over IPC before the close event
// fires. Main completes the file write whether or not the renderer is alive to await it: a
// dropped promise loses the RESULT, never the write. There is no deferred state here for
// `settleConfigWrites` to settle, so no test staged on this journey can discriminate, and one
// that appeared to would be measuring something else.
//
// The widening is right anyway, and IS proved — by the JSON-tab case above. The preferences
// window is a separate RENDERER PROCESS with its own copy of the write module, so a drain that
// asked only the workspace window would settle nothing there. "Name no windows, ask the list" is
// load-bearing for that reason, not for this one.
// ═══════════════════════════════════════════════════════════════════════════════

test('#86 C23: the WORKSPACE window\'s own config write survives an immediate ORDINARY close', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-cfg-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-cfg-user-'));
  // One config root across BOTH launches: the write under test lands in this settings.json.
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-root-'));
  const env = { THRONG_CONFIG_ROOT: cfgRoot };
  try {
    await runApp(
      async (app, win) => {
        // Creating the project persists the chosen folder through the undebounced,
        // `void`-dropped `writeConfig({kind:'settings'}, …)` — in the WORKSPACE window.
        await createProject(win, 'CfgOrdinary', root);
        // …and the user closes at once, with that write still in flight.
        await ordinaryClose(app);
      },
      { dataDir, userDataDir, env },
    );

    const settings = JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8')) as {
      newProject?: { lastProjectFolder?: string };
    };
    expect(
      settings.newProject?.lastProjectFolder,
      `the workspace window's config write must have landed (settings: ${JSON.stringify(settings.newProject)})`,
    ).toBe(root);
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// The other half of the blast radius: the SAME two writes, on the SAME journey, taking the
// TERMINATE-ALL exit instead. These PASS today — only because the prompt stalls the close past the
// debounce. They are here so that the asymmetry is pinned, and so that a drain added to one exit and
// not the other cannot pass unnoticed.
// ═══════════════════════════════════════════════════════════════════════════════

test('#86 AC3/AC4: layout and per-panel zoom set immediately before TERMINATE ALL survive the next launch', async () => {
  skipIfElevated();
  const root = makeProject();
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-tal-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-tal-user-'));
  let projectId = '';
  let editorPid = '';
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'LayoutTermAll', root);
        projectId = await firstProjectId(win);

        editorPid = await firstPanelId(win);
        await openEditorOn(win, editorPid, 'scriptfile', 'echo');
        await addTerminalPanel(win, editorPid, root);

        await win.waitForTimeout(1500); // baseline (2 panels, no zoom) safely stored

        // THE DECISIONS: a structural edit AND a zoom, both riding the same deferred write.
        await win.getByTestId(`panel-add-${editorPid}`).click();
        await win.keyboard.press('Enter');
        await expect(win.locator('.panel-box')).toHaveCount(3);
        await zoomInTwice(win, editorPid);

        await terminateAllClose(app, win);
      },
      { dataDir, userDataDir },
    );

    await runApp(
      async (_app, win) => {
        const projectItem = win.locator('.project-item', { hasText: 'LayoutTermAll' });
        await expect(projectItem).toBeVisible();
        await projectItem.locator('[data-testid^="project-switch-"]').click();
        await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 10_000 });

        const panels = await storedPanels(win, projectId);
        expect(
          panels.length,
          `the third panel must be IN THE STORE (stored: ${JSON.stringify(panels)})`,
        ).toBe(3);
        expect(
          panels.find((p) => p.id === editorPid)?.zoom,
          `the zoom must be IN THE STORE (stored: ${JSON.stringify(panels)})`,
        ).toBe(1);
      },
      { dataDir, userDataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
