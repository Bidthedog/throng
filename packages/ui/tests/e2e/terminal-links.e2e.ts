/**
 * Two claims about terminal links that only a running app can settle.
 *
 * ══ US7 (#159, spec 024) — a renderer that opens a browser window is DENIED ══
 *
 * An http(s) target is instead handed to the OS opener, and nothing opens an in-app browser
 * (FR-019b). This is the reported #159 bug's root: an OSC 8 link (and any window.open) used to spawn
 * a new in-app BrowserWindow. On origin/master this fails — a window is created and no openExternal
 * routing happens. Driving window.open directly is the reliable way to exercise the guard; the
 * Ctrl+click routing logic is unit-tested.
 *
 * ══ 045 FR-006 / FR-042 / SC-003 — a DETECTED path underlines on hover, and a look-alike does not ══
 *
 * The underline is the whole affordance: it is how a user learns that a path a command printed is
 * followable, and — just as importantly — that a path-shaped run of characters that names nothing is
 * not. FR-006 makes that a fact about the DISK rather than about the grammar, so the two cases are
 * indistinguishable until main has answered, and the drawing is what the answer changes.
 *
 * It is here, in an existing declaration, rather than in one of its own: 045 adds no E2E declaration
 * and the budget (`e2e-budget.json`) reads 570 / @terminal 107 before and after.
 *
 * WHY THIS CANNOT MOVE DOWN A LAYER. The underline is drawn, not computed: xterm's DOM renderer
 * writes an inline `text-decoration: underline` per cell span while a link is hovered
 * (`DomRendererRowFactory.ts`, `isLinkHover`), and it draws it for whatever its Linkifier resolved
 * under a real pointer. No test in this repo constructs an xterm `Terminal` at all — the grammar is
 * pinned in `core/tests/unit/link-detect.test.ts` and the provider in
 * `ui/tests/unit/terminal-file-link-provider.test.ts` with a fake terminal, and neither can say
 * whether anything was ever drawn on screen.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  runApp,
  createProject,
  cleanupTemp,
  charPoint,
  firstPanelId,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';

/**
 * One row carrying both tokens, so they are judged under identical conditions — same panel, same
 * width, same pointer, same provider pass — and the only difference between them is whether the
 * file exists.
 */
const MARKER = 'MARKROW';
const REAL_PATH = './target.ts';
const LOOK_ALIKE = './nothere.ts';
const WEB_URL = 'https://example.com/hoverme';
const ROW_TEXT = `${MARKER} ${REAL_PATH} ${LOOK_ALIKE} ${WEB_URL}`;

/**
 * Printed from a FILE rather than typed at the prompt.
 *
 * Typing it would put both tokens into the echoed command line, and the row locator below would then
 * be free to find the echo instead of the output — the same trap `terminal-link-once.e2e.ts`'s
 * header records. `-ExecutionPolicy Bypass` because `Restricted` is the Windows client default and a
 * bare `.\links.ps1` only runs on a machine somebody has already relaxed.
 */
function writeRowScript(root: string): void {
  writeFileSync(join(root, 'links.ps1'), `Write-Host '${ROW_TEXT}'\n`, 'utf8');
}

async function openTerminal(win: Page, root: string): Promise<Locator> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
  const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  // The prompt shows the project root — proof the shell is live before anything is typed at it.
  await expect(term).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  return term;
}

// One line, deliberately: e2e-budget.test.ts and e2e-tags.test.ts match the declaration with a LINE-based regex.
test('a renderer-opened window is denied and http(s) routed to the OS opener (#159); a detected path underlines on hover and a look-alike does not (045)', { tag: ['@extended', '@terminal'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-links-'));
  // The file one token names, and deliberately NOT the other. Both are path-shaped; only one is a
  // link, and FR-006 says that difference is the disk's to make.
  writeFileSync(join(root, 'target.ts'), 'export const target = 1;\n', 'utf8');
  writeRowScript(root);

  try {
    await runApp(async (app, win) => {
      await createProject(win, 'LinksProj', 'C:/c/links');

      // Intercept shell.openExternal and record the baseline window count.
      await app.evaluate(({ shell }) => {
        const w = globalThis as unknown as { __ext?: string[] };
        w.__ext = [];
        const orig = shell.openExternal.bind(shell);
        shell.openExternal = (url: string, opts?: unknown) => {
          w.__ext!.push(url);
          return Promise.resolve();
          void orig;
          void opts;
        };
      });
      const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

      // A renderer opens an https window → denied (no new window), routed to the OS opener.
      await win.evaluate(() => window.open('https://example.com/from-renderer'));
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
        .toBe(before);
      const routed = await app.evaluate(
        () => (globalThis as unknown as { __ext?: string[] }).__ext ?? [],
      );
      expect(routed).toContain('https://example.com/from-renderer');

      // A javascript: target → denied AND not routed anywhere (the injection guard).
      await win.evaluate(() => window.open('javascript:alert(1)'));
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
        .toBe(before);
      const routed2 = await app.evaluate(
        () => (globalThis as unknown as { __ext?: string[] }).__ext ?? [],
      );
      expect(routed2).not.toContain('javascript:alert(1)');

      // ══ 045 — the hover underline, in a real terminal with a real project behind it ══

      await createProject(win, 'LinkHover', root);
      const term = await openTerminal(win, root);
      await term.click();
      await win.keyboard.type('powershell -NoProfile -ExecutionPolicy Bypass -File .\\links.ps1');
      await win.keyboard.press('Enter');
      await expect(term).toContainText(MARKER, { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

      // `.last()` is the OUTPUT row rather than the echoed command line, which carries neither token.
      const row = win.locator('.xterm-rows > div', { hasText: MARKER }).last();
      await expect(row).toBeVisible({ timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
      const rowBox = (await row.boundingBox())!;
      /**
       * Rest the pointer on one character of the row — arriving from the line BELOW.
       *
       * The detour is not decoration, and it took a measurement to find. xterm caches its link
       * providers' replies PER LINE (`Linkifier._handleHover`: a move within the active line
       * re-checks the cached replies and calls `provideLinks` again only when the LINE changes). A
       * file link's first query is always a miss — `peekLink` never waits, it fires the request and
       * answers "not a link" (FR-071) — so a pointer that arrives on a path and holds still sees the
       * miss and nothing else, however long it waits. Nudging between cells does not help either:
       * that is the same line. Leaving the line and coming back is what asks again.
       *
       * Measured on this spec: hovering `./target.ts` for 20s underlined nothing, while an https URL
       * printed in the same row underlined immediately — the web scanner needs no round trip.
       */
      const hover = async (token: string, into: number): Promise<void> => {
        const at = await charPoint(row, token, into);
        await win.mouse.move(at.x, at.y + rowBox.height);
        await win.mouse.move(at.x, at.y);
      };

      /**
       * What is actually DRAWN as a link on this row: the text of every span the DOM renderer wrote
       * an inline underline onto. Read rather than counted, so a reading can say WHICH token was
       * underlined — a count could not tell the two apart.
       */
      const underlined = (): Promise<string> =>
        row.evaluate((el) =>
          [...el.querySelectorAll('span')]
            .filter((s) => (s as HTMLElement).style.textDecoration === 'underline')
            .map((s) => s.textContent ?? '')
            .join(''),
        );

      /*
       * A file link is only a link once main has answered (FR-006), and `peekLink` never waits
       * (FR-071) — so the first query over a path misses and merely fires the request. Each pass
       * below re-enters the line, which is what makes the next query read the answer that landed.
       */
      const settleOnRealPath = async (): Promise<void> => {
        await expect
          .poll(
            async () => {
              await hover(REAL_PATH, 3);
              return underlined();
            },
            {
              timeout: 20_000,
              message: `${REAL_PATH} exists in this project and was never underlined`,
            },
          )
          .toContain(REAL_PATH);
      };

      /*
       * The web url in the same row is the harness's own control, and it earned its place: when the
       * path assertion below first failed, this is what said the pointer, the Linkifier and this
       * underline reading were all working, and sent the search to the file provider rather than to
       * the geometry. It needs no round trip — `WebLinksAddon` matches a pattern and is done — so it
       * underlines on the first query, which is exactly what a detected path does not do.
       */
      await hover(WEB_URL, 6);
      await expect
        .poll(underlined, { timeout: 10_000, message: 'a plain url in a terminal no longer underlines' })
        .toContain(WEB_URL);

      await settleOnRealPath();

      /*
       * The look-alike names nothing, so nothing is drawn — and the hard part of asserting that is
       * that "not a link" and "not answered yet" look identical on screen.
       *
       * There is no positive signal to fence on, by construction: a non-link produces no underline,
       * no tip and no menu items. So it is sampled REPEATEDLY, and between every pair of samples the
       * real path in the same row is hovered and required to underline again. Each of those is a
       * completed resolution round-trip through main, arriving AFTER the look-alike's own request
       * was fired in the same provider pass — and it is simultaneously the anti-vacuity control: an
       * empty reading is the look-alike being judged, not the pointer, the provider or this harness
       * having quietly stopped working.
       */
      const lookAlikeReadings: string[] = [];
      for (let pass = 0; pass < 3; pass += 1) {
        await hover(LOOK_ALIKE, 3);
        lookAlikeReadings.push(await underlined());
        await hover(LOOK_ALIKE, 6);
        lookAlikeReadings.push(await underlined());
        await settleOnRealPath();
      }
      expect(
        lookAlikeReadings.filter((t) => t.length > 0),
        `${LOOK_ALIKE} names nothing on disk, so hovering it must underline nothing — a path-shaped ` +
          `run of characters is not a link until FR-006's existence check says so`,
      ).toEqual([]);
    });
  } finally {
    cleanupTemp(root);
  }
});
