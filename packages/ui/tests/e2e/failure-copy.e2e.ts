/**
 * 030 US5 (#238) — COPY THE WHOLE OF ANY ERROR.
 *
 * ══ THE DEFECT ══
 *
 * `noticeToText` was an enumeration of known fields — `heading + message + details + copyDetail` —
 * so the moment `Notice.body` was added, the copy text silently stopped being the notice. The user
 * copied a heading and a sentence; the structured file list the notice was actually about stayed on
 * the screen. Nothing failed, because a field list cannot disagree with itself.
 *
 * ══ WHAT THIS SPEC IS ══
 *
 * The RED half of US5, and its centrepiece is a GUARD rather than an example (FR-049): the copied
 * text is compared against the notice's own rendered DOM text, in order. A part added to the notice
 * card later and forgotten in the copy path fails this test instead of shipping — which is the only
 * form of this requirement that survives the next person in a hurry.
 *
 * Two parts are deliberately copied and NEVER rendered, and a DOM comparison is structurally
 * incapable of noticing their absence: `copyDetail` (the raw system error, which FR-034 forbids
 * rendering) and each affected row's own `detail` (FR-048a). Their unit assertions are in
 * `tests/unit/notice-text.test.ts`; what this file adds is the other direction — that the copied
 * text really does carry a system error the screen never showed.
 *
 * ══ HOW THE FAILURES ARE PRODUCED ══
 *
 * A project whose root has NEVER existed, holding four terminal panels. The daemon cannot lock the
 * missing working directory and refuses each attach with a classified cause, so four panels reach
 * their failure state, one consolidated notice lists all four, and NO SHELL IS EVER SPAWNED — which
 * is what keeps a four-casualty spec cheap. The editor half of the round trip lives in a second,
 * real project, because a paste target has to be a panel that works.
 *
 * ══ TIER: SERIAL (T067) ══
 *
 * Registered in `parallel-plan.json`'s serial list: the second test drives a REAL editor panel for
 * the paste round trip, and the first drives four terminal attaches. (It was also registered in a
 * shard plan, which spec 034 removed — there is one E2E job now, so a file needs no CI placement.)
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  addPanels,
  cleanupTemp,
  commitPanelRename,
  createProject,
  firstPanelId,
  focusEditor,
  panelIds,
  runApp,
  settle,
} from './harness.js';

/** A project root that has never existed — the cheapest panel failure there is, and it scales. */
function ghostRoot(name: string): string {
  return `C:/throng-e2e-missing/${name.toLowerCase()}`;
}

/** The consolidated notice US3 raises for the panels one cause defeated. */
function consolidated(win: Page): Locator {
  return win.getByTestId('panel-failure-notice');
}

/** The shared failure banner of one panel (contracts/panel-failure-banner.md). */
function banner(win: Page, panelId: string): Locator {
  return win.getByTestId(`panel-failure-${panelId}`);
}

/**
 * What is on the clipboard, read through the app's own seam.
 *
 * Under E2E that seam is filled in-process (`THRONG_E2E_CLIPBOARD=memory`, see the harness):
 * Electron's clipboard does not work in this harness at all, so the alternative is a test that can
 * only ever assert emptiness.
 */
async function clipboardText(win: Page): Promise<string> {
  return win.evaluate(() => window.throng?.clipboard?.paste().then((e) => e?.text ?? '') ?? '');
}

/** Non-empty, trimmed lines — the unit both sides of the comparison are measured in. */
function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * THE GUARD (FR-049) — everything the notice RENDERS is in what it COPIES, in the same order.
 *
 * Substring rather than equality per line, because a copied line may carry more than the rendered
 * one does: an affected row appends that panel's own raw error (FR-048a), which is never rendered.
 * The monotonic index is what makes this an ORDER assertion — "reading order" is half of FR-048, and
 * a set comparison would pass on a copy that scrambled it.
 */
function expectRenderedIsCopied(rendered: string[], copied: string[]): void {
  let from = 0;
  for (const line of rendered) {
    const at = copied.findIndex((c, i) => i >= from && c.includes(line));
    expect(
      at,
      `the notice renders "${line}" and the copied text does not carry it (in order) — ` +
        `copied:\n${copied.join('\n')}`,
    ).toBeGreaterThanOrEqual(0);
    from = at + 1;
  }
}

/** Turn `panelId` into a `cmd` terminal that cannot start, and wait until it says so. */
async function failingTerminalOn(win: Page, panelId: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  /*
   * CONFIRMED BY KEYBOARD, NOT BY CLICK, AND DELIBERATELY (#313).
   *
   * This helper is called four times, and from the second call onwards the consolidated notice
   * raised by the first is already on screen — over the bottom-right panel, which is where
   * `.panel-type-form__actions` puts Confirm. Since #313 a notice takes pointer events, so that
   * click is intercepted, exactly as a user's would be.
   *
   * Dismissing the notice is the remedy #313 names, and it is not available here: this test's
   * subject is a notice that has ACCUMULATED all four casualties (FR-037), and dismissing it
   * between failures would restart that list. Pressing the focused button is the other honest
   * route past a covered control, and it is the one a user has. `force: true` is NOT — it
   * dispatches at the button's coordinates, so it would land on the notice and silently hide the
   * very interception this test now has to work with.
   */
  const confirm = win.getByTestId(`panel-type-confirm-${panelId}`);
  await confirm.focus();
  await confirm.press('Enter');
  await expect(banner(win, panelId)).toBeVisible({ timeout: 90_000 });
}

/** Name a panel through its header — no context menu, so nothing here steals a menu from a test. */
async function renamePanel(win: Page, panelId: string, to: string): Promise<void> {
  await win.getByTestId(`panel-handle-${panelId}`).dblclick();
  const input = win.getByTestId(`panel-rename-input-${panelId}`);
  await expect(input).toBeVisible();
  await input.fill(to);
  await commitPanelRename(win);
}

/**
 * T065 / T065a / T066 (the scrolled half) — one notice, copied whole, and pasted back unchanged.
 *
 * Deliberately one test over one app: every assertion below is about the SAME copied string, and
 * rebuilding a four-casualty workspace three times would spend three launches to observe three
 * facets of one clipboard.
 */
test('a copied notice carries everything it renders, plus the system error it must not render', { tag: ['@extended', '@failure'] }, async () => {
  test.setTimeout(300_000);
  const real = mkdtempSync(join(tmpdir(), 'throng-copy-real-'));
  writeFileSync(join(real, 'notes.txt'), 'SEED\n');
  try {
    await runApp(async (_app, win) => {
      await settle(win);

      // A project that WORKS, with one editor — the paste target for the round trip (FR-054).
      await createProject(win, 'Real', real);
      const editorPid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${editorPid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${editorPid}`).click();
      await expect(win.getByTestId(`editor-${editorPid}`)).toBeVisible({ timeout: 20_000 });
      await win.getByTestId('file-explorer-tree').getByText('notes.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${editorPid}`).locator('.cm-content')).toContainText(
        'SEED',
        { timeout: 20_000 },
      );

      // …and a project whose root never existed, with four terminals that cannot start. One cause,
      // four casualties, one notice — and no shell spawned by any of them.
      await createProject(win, 'Ghost', ghostRoot('copy'));
      const firstGhost = await firstPanelId(win);
      await failingTerminalOn(win, firstGhost);
      await addPanels(win, 3);
      const ghostPids = await panelIds(win);
      for (const pid of ghostPids) {
        if (pid === firstGhost) continue;
        await failingTerminalOn(win, pid);
      }

      const notice = consolidated(win);
      await expect(notice).toBeVisible({ timeout: 90_000 });
      await expect(notice.getByTestId('notice-affected-row')).toHaveCount(4, { timeout: 60_000 });

      // ═══ T065 — WHAT IT RENDERS IS WHAT IT COPIES (FR-049). ═══
      const rendered = lines(await notice.getByTestId('notice-body').innerText());
      expect(rendered.length, 'the notice rendered nothing to compare against').toBeGreaterThan(4);

      await win.getByTestId('panel-failure-notice-copy').click();
      const copied = await clipboardText(win);
      expect(copied, 'the copy control put nothing on the clipboard').not.toBe('');
      expectRenderedIsCopied(rendered, lines(copied));

      // ═══ …and the two parts that are copied and NEVER rendered (FR-034/FR-048a). ═══
      //
      // The DOM comparison above cannot see these: there is nothing on screen for them to be
      // compared against. This is the other direction — the copy carries a system error the user
      // could not have read off the screen, which is the whole reason the raw text was demoted to
      // Copy rather than deleted (029 FR-018).
      const visible = await notice.innerText();
      expect(visible, 'the notice renders a raw system error (FR-034)').not.toMatch(
        /Cannot lock|ENOENT|EPERM|EBUSY|EACCES/i,
      );
      expect(
        copied,
        'the copied text carries no system error at all — the one thing a user cannot retype',
      ).toMatch(/Cannot lock|ENOENT|EPERM|EBUSY|EACCES|throng-e2e-missing/i);

      // ═══ T066 (the scrolled half) — the copied list is COMPLETE however far it is scrolled. ═══
      //
      // The bound is a theme variable (`--throng-notice-affected-max-height`, 12rem), and this
      // narrows it rather than opening nine panels to overflow it: what FR-050 is about is that the
      // copy is taken from the LIST and not from the viewport, and a genuinely scrolled list is a
      // genuinely scrolled list however it came to be one. The overflow is asserted, not assumed.
      const list = notice.getByTestId('notice-affected');
      await list.evaluate((el) => {
        (el as HTMLElement).style.setProperty('--throng-notice-affected-max-height', '2rem');
      });
      const overflow = await list.evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(overflow, 'the list did not overflow, so nothing was scrolled out of view').toBeGreaterThan(0);
      await list.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

      await win.getByTestId('panel-failure-notice-copy').click();
      const scrolledCopy = await clipboardText(win);
      expect(
        scrolledCopy,
        'a scrolled list copied something different from the same list unscrolled',
      ).toBe(copied);

      // ═══ T065a — THE ROUND TRIP (FR-054, US5 AC7). ═══
      //
      // Pasted into a real editor panel and written to disk, so "unchanged" is measured against the
      // bytes rather than against a DOM read that has already normalised whitespace for us.
      await win.locator('.project-item', { hasText: 'Real' }).locator('[data-testid^="project-switch-"]').click();
      await expect(win.getByTestId(`editor-${editorPid}`)).toBeVisible({ timeout: 30_000 });
      await focusEditor(win, editorPid);
      await win.keyboard.press('Control+a');
      await win.keyboard.press('Control+v');
      await expect(win.getByTestId(`editor-${editorPid}`).locator('.cm-content')).toContainText(
        'Ghost',
        { timeout: 20_000 },
      );
      await win.keyboard.press('Control+s');
      await expect
        .poll(() => readFileSync(join(real, 'notes.txt'), 'utf8'), {
          timeout: 20_000,
          message: 'the pasted text never reached the file',
        })
        .toBe(copied);
    });
  } finally {
    cleanupTemp(real);
  }
});

/**
 * T066 — THE BANNER COPIES ITS OWN DETAIL, WITH NO NOTICE ON SCREEN (FR-052/FR-053).
 *
 * This is the case that makes the copy control load-bearing rather than convenient. Every severity
 * is set to *Never display*, so the notice that would otherwise carry the detail is never rendered
 * at all — the banner is the only thing on screen, and its pointer sentence leads with Copy for
 * exactly this reason (FR-041).
 *
 * Seeded through the CONFIG ROOT rather than the Preferences window, as US4's equivalent test is:
 * driving the preferences UI would make this depend on US1's controls, and would open a second
 * window whose focus theft is what `parallel-plan.json` exists to contain.
 *
 * The CONTENT is asserted, not merely that something was copied — the message, the subject in its
 * full `Project — Tab — Panel` form, the path, and the system error (FR-052). "Copy works" is true
 * of a control that copies the wrong four things.
 */
test('the banner copies its message, subject, path and system error with no notice on screen', { tag: ['@extended', '@failure'] }, async () => {
  test.setTimeout(240_000);
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-copy-cfg-'));
  mkdirSync(cfgRoot, { recursive: true });
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({
      version: 1,
      notifications: {
        error: { mode: 'never', timeoutMs: 30000 },
        warning: { mode: 'never', timeoutMs: 30000 },
        info: { mode: 'never', timeoutMs: 30000 },
        success: { mode: 'never', timeoutMs: 30000 },
      },
    }),
    'utf8',
  );
  try {
    await runApp(
      async (_app, win) => {
        await settle(win);
        await createProject(win, 'Silenced', ghostRoot('silenced-copy'));
        const pid = await firstPanelId(win);
        await failingTerminalOn(win, pid);
        // Named, so the subject assertion is about a name somebody chose rather than a default.
        await renamePanel(win, pid, 'Shell');

        // Genuinely alone: no notice exists to have carried the detail instead.
        await expect(win.getByTestId('notices').locator('.notice')).toHaveCount(0);
        await expect(consolidated(win)).toHaveCount(0);

        const copy = banner(win, pid).getByRole('button', { name: 'Copy details', exact: true });
        await expect(copy).toBeVisible();
        await copy.click();

        const copied = await clipboardText(win);
        const copiedLines = lines(copied);
        // The banner's own headline, in the panel type's words (FR-040).
        expect(copiedLines[0]).toBe('This terminal could not be opened');
        // The subject in FULL — there is no surrounding context to elide it against (FR-022/FR-052).
        expect(
          copiedLines[1],
          'the copied subject is not the full Project — Tab — Panel form',
        ).toMatch(/^Silenced — .+ — Shell$/);
        // The path it could not use, and the system error nobody could have retyped.
        expect(copied).toContain('throng-e2e-missing');
        expect(copied, 'the banner copied no system error').toMatch(
          /Cannot lock|ENOENT|EPERM|EBUSY|EACCES/i,
        );
        // …and that error is genuinely NOT on the screen it was copied from (FR-034).
        expect(await banner(win, pid).innerText()).not.toMatch(
          /Cannot lock|ENOENT|EPERM|EBUSY|EACCES/i,
        );
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(cfgRoot);
  }
});
