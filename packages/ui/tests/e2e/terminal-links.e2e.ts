/**
 * Claims about terminal links that only a running app can settle.
 *
 * ══ US7 (#159, spec 024) — a renderer that opens a browser window is DENIED ══
 *
 * An http(s) target is instead handed to the OS opener, and nothing opens an in-app browser
 * (FR-019b). This is the reported #159 bug's root: an OSC 8 link (and any window.open) used to spawn
 * a new in-app BrowserWindow. On origin/master this fails — a window is created and no openExternal
 * routing happens. Driving window.open directly is the reliable way to exercise the guard; the
 * Ctrl+click routing logic is unit-tested.
 *
 * ══ 045 FR-006 / FR-042 / SC-003 — a DETECTED path is marked, and a look-alike is not ══
 *
 * The mark is the whole affordance: it is how a user learns that a path a command printed is
 * followable, and — just as importantly — that a path-shaped run of characters that names nothing is
 * not. FR-006 makes that a fact about the DISK rather than about the grammar, so the two cases are
 * indistinguishable until main has answered, and the drawing is what the answer changes.
 *
 * ══ 045 FR-130 – FR-139 (T186) — a WRAPPED link is marked on every row it occupies ══
 *
 * A web url, a detected path and an OSC 8 hyperlink, each soft-wrapped by a narrowed window, carry
 * the SAME mark on every row at rest — #326 was a wrapped OSC 8 link drawn only on its first row.
 *
 * ══ 045 FR-154 / FR-139 (T213) — a hyperlink that goes nowhere is plain text ══
 *
 * The corpus's dead OSC 8 hyperlinks — an unknown scheme, an empty target, a missing file and an
 * unreachable host — carry no mark, no underline and no hand pointer, at rest, hovered, or hovered
 * with Ctrl held. xterm puts its own `xterm-underline-5` class on EVERY OSC 8 cell whatever the
 * target, and nothing in its API removes it; `terminal.css` neutralises it inside a panel. So the
 * assertion is on what is DRAWN — the computed `text-decoration-line` — never on the class.
 *
 * It is here, in an existing declaration, rather than in one of its own: 045 adds no E2E declaration
 * and the budget (`e2e-budget.json`) reads 570 / @terminal 107 before and after.
 *
 * WHY THIS CANNOT MOVE DOWN A LAYER. The mark is drawn, not computed: it is an xterm decoration
 * (`link-marks.ts`) laid over the cells a real Linkifier and a real idle scan found, in a real
 * renderer, at a width a real reflow decided. The grammar is pinned in
 * `core/tests/unit/link-detect.test.ts`, the provider in `ui/tests/unit/terminal-file-link-provider.test.ts`
 * and the marks in `ui/tests/unit/terminal-link-affordance.test.ts` with a fake terminal; none of them
 * can say whether anything was ever drawn on screen, or where a wrap put it.
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
  linkMarkedText,
  narrowTerminalWindow,
  runTypedCommand,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';
import { osc8HalfRuns } from './admin.js';

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
 * T186's three wrapped links. Each is far wider than the narrowed panel, so each is certain to wrap:
 * the defect only exists at a row break, and a fixture that happened to fit on one line would pass
 * for free. Each starts its own line, so every row between two markers belongs to exactly one link.
 */
const WRAPPED_FILE = `wrapped_${'abcdefghij'.repeat(9)}.ts`;
const WRAPPED = {
  web: `https://example.com/wrapped/${'uvwxyzabcd'.repeat(9)}`,
  path: `./${WRAPPED_FILE}`,
  oscText: `OSCWRAP_${'klmnopqrst'.repeat(10)}`,
  oscUri: 'https://example.com/osc8-wrapped',
} as const;

/**
 * T213's dead hyperlinks, verbatim from the corpus (`links-test.sh`, "OSC 8 - broken"), and one live
 * `file:` hyperlink as the control — which is what proves the readings below can see a mark, an
 * underline and a hand at all.
 */
const DEAD = [
  { text: 'unknown scheme', uri: 'notascheme:foo' },
  { text: 'empty URI', uri: '' },
  { text: 'file missing', uri: 'file:///C:/does/not/exist.txt' },
  { text: 'file UNC missing host', uri: 'file://nonexistent-host-xyz/share/file.txt' },
] as const;
const LIVE_TEXT = 'LIVEFILELINK';

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

/** T186 + T213: the wrapped links, then the dead hyperlinks and the live control, each on its own line. */
function writeMarksScript(root: string): void {
  const ESC = String.fromCharCode(27);
  const ST = ESC + String.fromCharCode(92);
  const osc8 = (uri: string, text: string): string => `${ESC}]8;;${uri}${ST}${text}${ESC}]8;;${ST}`;
  const live = `file:///${join(root, 'target.ts').replace(/\\/g, '/')}`;
  const out = [
    'WRAPWEB_BEGIN',
    WRAPPED.web,
    'WRAPPATH_BEGIN',
    WRAPPED.path,
    'WRAPOSC_BEGIN',
    osc8(WRAPPED.oscUri, WRAPPED.oscText),
    'WRAP_END',
    ...DEAD.map((d) => osc8(d.uri, d.text)),
    osc8(live, LIVE_TEXT),
    'MARKS_DONE',
  ];
  writeFileSync(
    join(root, 'marks.js'),
    `process.stdout.write(${JSON.stringify(out.join('\r\n') + '\r\n')});\n`,
    'utf8',
  );
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

/** A row's rendered text, with xterm's no-break spaces made plain and the blank tail dropped. */
function rowText(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').trimEnd();
}

// One line, deliberately: e2e-budget.test.ts and e2e-tags.test.ts match the declaration with a LINE-based regex.
test('a renderer-opened window is denied and http(s) routed to the OS opener (#159); a detected path is marked and a look-alike is not, a wrapped link is marked on every row and a dead hyperlink on none (045)', { tag: ['@extended', '@terminal'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-links-'));
  // The file one token names, and deliberately NOT the other. Both are path-shaped; only one is a
  // link, and FR-006 says that difference is the disk's to make.
  writeFileSync(join(root, 'target.ts'), 'export const target = 1;\n', 'utf8');
  writeFileSync(join(root, WRAPPED_FILE), 'export const wrapped = 1;\n', 'utf8');
  writeRowScript(root);
  writeMarksScript(root);

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

      // ══ 045 — the mark, in a real terminal with a real project behind it ══

      await createProject(win, 'LinkHover', root);
      const term = await openTerminal(win, root);
      await runTypedCommand(win, term, 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\links.ps1', {
        echoed: 'links.ps1',
        output: MARKER,
      });

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
       */
      const hover = async (token: string, into: number): Promise<void> => {
        const at = await charPoint(row, token, into);
        await win.mouse.move(at.x, at.y + rowBox.height);
        await win.mouse.move(at.x, at.y);
      };

      /**
       * What is actually DRAWN as the hovered link on this row: the characters under a mark in the
       * hover state. Read rather than counted, so a reading can say WHICH token was marked — a count
       * could not tell the two apart. xterm's own inline hover underline is switched off in a
       * terminal panel (`terminal.css`), so the mark is the only thing there is to read.
       */
      const hovered = (): Promise<string> => linkMarkedText(row, { hover: true });

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
              return hovered();
            },
            {
              timeout: 20_000,
              message: `${REAL_PATH} exists in this project and was never marked as hovered`,
            },
          )
          .toContain(REAL_PATH);
      };

      /*
       * The web url in the same row is the harness's own control, and it earned its place: when the
       * path assertion below first failed, this is what said the pointer, the Linkifier and this
       * reading were all working, and sent the search to the file provider rather than to the
       * geometry. It needs no round trip, so it is marked on the first query, which is exactly what a
       * detected path does not do.
       */
      await hover(WEB_URL, 6);
      await expect
        .poll(hovered, { timeout: 10_000, message: 'a plain url in a terminal is no longer marked on hover' })
        .toContain(WEB_URL);

      await settleOnRealPath();

      /*
       * The look-alike names nothing, so nothing is drawn — and the hard part of asserting that is
       * that "not a link" and "not answered yet" look identical on screen.
       *
       * There is no positive signal to fence on, by construction: a non-link produces no mark, no
       * tip and no menu items. So it is sampled REPEATEDLY, and between every pair of samples the
       * real path in the same row is hovered and required to be marked again. Each of those is a
       * completed resolution round-trip through main, arriving AFTER the look-alike's own request
       * was fired in the same provider pass — and it is simultaneously the anti-vacuity control: an
       * empty reading is the look-alike being judged, not the pointer, the provider or this harness
       * having quietly stopped working.
       */
      const lookAlikeReadings: string[] = [];
      for (let pass = 0; pass < 3; pass += 1) {
        await hover(LOOK_ALIKE, 3);
        lookAlikeReadings.push(await hovered());
        await hover(LOOK_ALIKE, 6);
        lookAlikeReadings.push(await hovered());
        await settleOnRealPath();
      }
      expect(
        lookAlikeReadings.filter((t) => t.length > 0),
        `${LOOK_ALIKE} names nothing on disk, so hovering it must mark nothing — a path-shaped ` +
          `run of characters is not a link until FR-006's existence check says so`,
      ).toEqual([]);

      // AT REST (FR-136): the pointer gone, both links in the row are marked — and the look-alike,
      // whose answer the passes above have long since outrun, is not.
      await win.mouse.move(2, 2);
      await expect
        .poll(() => linkMarkedText(row), { timeout: 10_000, message: 'the row lost its at-rest marks' })
        .toContain(WEB_URL);
      const atRest = await linkMarkedText(row);
      expect(atRest).toContain(REAL_PATH);
      expect(atRest).not.toContain(LOOK_ALIKE);
      expect(atRest).not.toContain('nothere');

      /*
       * ══ T186 — each link kind, soft-wrapped, is marked on EVERY row it occupies ══
       *
       * The window is narrowed to its minimum so each fixture link wraps, and the screen cleared so
       * the whole fixture is in view — the idle scan marks what is IN VIEW (FR-136). The narrowing
       * waits for the pty to take the new width and the prompt to answer at it before anything is
       * typed; see `narrowTerminalWindow`. This test owns its app, so nothing needs restoring.
       */
      await narrowTerminalWindow(app, win, term, 600, 'WIDTHSETTLED1');
      await runTypedCommand(win, term, 'Clear-Host; node marks.js', { echoed: 'marks.js', output: 'MARKS_DONE' });
      await win.mouse.move(2, 2);

      const rows = win.locator('.xterm-rows > div');
      /** The screen rows strictly between two marker rows — one link's rows. */
      const rowsBetween = async (from: string, to: string): Promise<number[]> => {
        const texts = (await rows.allTextContents()).map(rowText);
        const start = texts.findIndex((t) => t === from);
        const end = texts.findIndex((t, i) => i > start && t === to);
        expect(start, `no ${from} row in ${JSON.stringify(texts)}`).toBeGreaterThanOrEqual(0);
        expect(end, `no ${to} row after ${from}`).toBeGreaterThan(start);
        return Array.from({ length: end - start - 1 }, (_, i) => start + 1 + i);
      };

      /*
       * The OSC 8 case, and all of T213 below, run only where the OS's ConPTY carries a hyperlink
       * around its text (`osc8HalfRuns` in admin.ts). Below build 22000 it wraps nothing: the OSC 8
       * case would fail for the OS's reason, and — worse — every DEAD hyperlink would "show no mark"
       * because no hyperlink arrived at all, a pass that proves nothing. Asked once, so the reason is
       * printed once.
       */
      const oscRuns = osc8HalfRuns('the wrapped OSC 8 mark (T186) and the dead-hyperlink cases with their live control (T213)');
      const cases = [
        { name: 'a web url', from: 'WRAPWEB_BEGIN', to: 'WRAPPATH_BEGIN', text: WRAPPED.web },
        { name: 'a detected path', from: 'WRAPPATH_BEGIN', to: 'WRAPOSC_BEGIN', text: WRAPPED.path },
        ...(oscRuns
          ? [{ name: 'an OSC 8 hyperlink', from: 'WRAPOSC_BEGIN', to: 'WRAP_END', text: WRAPPED.oscText }]
          : []),
      ];
      for (const c of cases) {
        const indices = await rowsBetween(c.from, c.to);
        // ANTI-VACUITY: the link really did wrap. One row would make "every row" true for free.
        expect(indices.length, `${c.name} did not wrap at this width`).toBeGreaterThan(1);
        const joined = (await Promise.all(indices.map((i) => rows.nth(i).textContent()))).map((t) => rowText(t ?? ''));
        expect(joined.join(''), `${c.name}'s rows do not spell it`).toBe(c.text);
        await expect
          .poll(
            async () => {
              const got: string[] = [];
              for (const i of indices) got.push(await linkMarkedText(rows.nth(i)));
              return got;
            },
            {
              timeout: 20_000,
              message: `${c.name} wrapped over ${indices.length} rows is not marked on every one of them (FR-130, #326)`,
            },
          )
          .toEqual(joined);
        // At rest, not hovered: the SAME at-rest mark on every row, none in the hover state.
        for (const i of indices) expect(await linkMarkedText(rows.nth(i), { hover: true })).toBe('');
      }

      /*
       * ══ T213 — a hyperlink that goes nowhere is plain text (FR-154) ══
       *
       * The live `file:` hyperlink is the control, and it goes first: once it is marked, main has
       * answered the idle scan's `file:` requests, so an unmarked dead one is judged, not pending.
       * The whole block is the OSC 8 half — see `oscRuns` above.
       */
      if (!oscRuns) return;
      const rowOf = (text: string): Locator => win.locator('.xterm-rows > div', { hasText: text }).last();
      const liveRow = rowOf(LIVE_TEXT);
      await expect
        .poll(() => linkMarkedText(liveRow), {
          timeout: 20_000,
          message: 'the live file: hyperlink was never marked — the readings below would see nothing',
        })
        .toBe(LIVE_TEXT);

      /** Everything drawn on one row that could read as a link, sampled at the pointer's position. */
      const drawn = async (text: string): Promise<{ mark: string; underline: string[]; cursor: string; pointerHost: boolean }> => {
        const r = rowOf(text);
        const at = await charPoint(r, text, 3);
        const mark = await linkMarkedText(r);
        const underline = await r.evaluate((el) =>
          [...el.querySelectorAll('span')]
            .map((s) => getComputedStyle(s).textDecorationLine)
            .filter((d) => d !== 'none'),
        );
        const cursor = await win.evaluate(
          ([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el ? getComputedStyle(el).cursor : 'nothing';
          },
          [at.x, at.y] as [number, number],
        );
        const pointerHost = await term.evaluate((el) => el.classList.contains('terminal-link-pointer'));
        return { mark, underline, cursor, pointerHost };
      };
      const enter = async (text: string): Promise<void> => {
        const at = await charPoint(rowOf(text), text, 3);
        await win.mouse.move(at.x, at.y + rowBox.height);
        await win.mouse.move(at.x, at.y);
      };

      // The control, hovered with Ctrl held: marked, and the hand — so each reading CAN go positive.
      await enter(LIVE_TEXT);
      await win.keyboard.down('Control');
      try {
        await expect
          .poll(async () => (await drawn(LIVE_TEXT)).pointerHost, {
            timeout: 10_000,
            message: 'Ctrl held over the live hyperlink never showed the hand — the pointer reading below is vacuous',
          })
          .toBe(true);
        expect((await drawn(LIVE_TEXT)).cursor).toBe('pointer');
      } finally {
        await win.keyboard.up('Control');
      }

      for (const d of DEAD) {
        await win.mouse.move(2, 2);
        const rest = await drawn(d.text);
        expect(rest.mark, `${d.text} (${d.uri || 'empty'}) is marked at rest`).toBe('');
        expect(rest.underline, `${d.text} is underlined at rest`).toEqual([]);

        await enter(d.text);
        const hover = await drawn(d.text);
        expect(hover.mark, `${d.text} is marked on hover`).toBe('');
        expect(hover.underline, `${d.text} is underlined on hover`).toEqual([]);
        expect(hover.cursor, `${d.text} shows the hand on hover`).not.toBe('pointer');

        await win.keyboard.down('Control');
        try {
          const held = await drawn(d.text);
          expect(held.mark, `${d.text} is marked with Ctrl held`).toBe('');
          expect(held.underline, `${d.text} is underlined with Ctrl held`).toEqual([]);
          expect(held.cursor, `${d.text} shows the hand with Ctrl held`).not.toBe('pointer');
          expect(held.pointerHost, `${d.text} set the hand on the panel`).toBe(false);
        } finally {
          await win.keyboard.up('Control');
        }
      }
      // No tip for any of them: a dead link has no hover state (FR-154).
      await expect(win.locator('.terminal-link-tip:not([hidden])')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
