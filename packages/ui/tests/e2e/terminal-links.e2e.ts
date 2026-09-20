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
 * ══ 045 FR-042 / FR-155 / SC-003 — a DETECTED path is marked, whether or not it exists ══
 *
 * The mark is the whole affordance: it is how a user learns that a path a command printed is
 * followable. Round four makes validity SYNTACTIC (FR-155, superseding FR-006 for drawing): a
 * path-shaped token that names nothing is marked exactly like one that exists, on the first paint,
 * with nothing asked of main — whether anything is there is decided when it is followed (FR-160).
 * Prose stays unmarked because the grammar refuses it, not because a check failed.
 *
 * ══ 045 FR-130 – FR-139 (T186) — a WRAPPED link is marked on every row it occupies ══
 *
 * A web url, a detected path and an OSC 8 hyperlink, each soft-wrapped by a narrowed window, carry
 * the SAME mark on every row at rest — #326 was a wrapped OSC 8 link drawn only on its first row.
 *
 * ══ 045 FR-154 as FR-163 amends it (T213, T292) — an unfollowable hyperlink is plain text ══
 *
 * An OSC 8 target is judged by its resource class alone (FR-163). The corpus's `file:` hyperlinks to
 * a missing file and to an unreachable host are LINKS — a mark, the hand and the underline, like any
 * other — while an unknown scheme and an empty target carry no mark, no underline and no hand pointer,
 * at rest, hovered, or hovered with Ctrl held. xterm puts its own `xterm-underline-5` class on EVERY
 * OSC 8 cell whatever the target, and nothing in its API removes it; `terminal.css` neutralises it
 * inside a panel. So the assertion is on what is DRAWN — throng's mark and the computed
 * `text-decoration-line` — never on the class.
 *
 * It is here, in an existing declaration, rather than in one of its own: 045 adds no E2E declaration
 * and the budget (`e2e-budget.json`) reads 570 / @terminal 107 before and after.
 *
 * ══ 045 FR-060, round five — `detectInTerminals` OFF means no links at all, hyperlinks included ══
 *
 * The switch used to govern guessed file paths alone. Round five widened it, and three of the seams
 * that implement the widening live inside `use-terminal.ts`'s mount closure, where neither the
 * provider's own `detect` reader nor the view pass can see them: the OSC 8 ranges the marks pass
 * reads, xterm's OSC 8 hover, and its activation. So a program's own hyperlink — what the Claude Code
 * CLI emits — has to go inert with the setting off exactly as a guessed path does, and the only place
 * that can be asked is here. It gets ONE declaration of its own because its app must be launched
 * against a seeded config root, which nothing sharing an app can do.
 *
 * WHY THIS CANNOT MOVE DOWN A LAYER. The mark is drawn, not computed: it is an xterm decoration
 * (`link-marks.ts`) laid over the cells a real Linkifier and a real view pass found, in a real
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
 * file exists, which round four makes no difference to the drawing (FR-155).
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
 * T213's "broken" hyperlinks, verbatim from the corpus (`links-test.sh`, "OSC 8 - broken"), and one
 * live `file:` hyperlink as the control — which is what proves the readings below can see a mark, an
 * underline and a hand at all. T292 (FR-163): the two `file:` targets are LINKS — a well-formed
 * `file:` target is valid whatever it points at — and only the unknown scheme and the empty target
 * remain unfollowable.
 */
const DEAD = [
  { text: 'unknown scheme', uri: 'notascheme:foo' },
  { text: 'empty URI', uri: '' },
] as const;
const UNFOLLOWED_FILES = [
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
    ...[...DEAD, ...UNFOLLOWED_FILES].map((d) => osc8(d.uri, d.text)),
    osc8(live, LIVE_TEXT),
    'MARKS_DONE',
  ];
  writeFileSync(
    join(root, 'marks.js'),
    `process.stdout.write(${JSON.stringify(out.join('\r\n') + '\r\n')});\n`,
    'utf8',
  );
}

/**
 * FR-060's OFF fixture: one row carrying BOTH kinds of link a terminal can draw.
 *
 * Two kinds on one row, because "links are off" and "nothing was rendered" look identical from a
 * single unmarked token. The plain url is the kind this very file already reads POSITIVELY a few
 * hundred lines up (`a plain url in a terminal is no longer marked on hover`), so the readings below
 * are known to be capable of going positive; the OSC 8 one is the seam under test.
 */
const OFF_MARKER = 'LINKSOFFROW';
const OFF_OSC_TEXT = 'OSC8OFF';
const OFF_OSC_URI = 'https://example.com/osc8-off';
const OFF_WEB = 'https://example.com/plain-off';

/** The OFF row, printed from a file for the same reason `writeRowScript` is — the echo trap. */
function writeOffScript(root: string): void {
  const ESC = String.fromCharCode(27);
  const ST = ESC + String.fromCharCode(92);
  const osc8 = `${ESC}]8;;${OFF_OSC_URI}${ST}${OFF_OSC_TEXT}${ESC}]8;;${ST}`;
  const row = `${OFF_MARKER} ${osc8} ${OFF_WEB}`;
  writeFileSync(join(root, 'off.js'), `process.stdout.write(${JSON.stringify(row + '\r\n')});\n`, 'utf8');
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
test('a renderer-opened window is denied and http(s) routed to the OS opener (#159); a detected path is marked and a look-alike is marked too, a wrapped link is marked on every row and an unfollowable hyperlink on none (045)', { tag: ['@extended', '@terminal'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-links-'));
  // The file one token names, and deliberately NOT the other. Both are path-shaped, so both are links
  // (FR-155): whether a file is there is decided when one is followed, not when it is drawn.
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
       * xterm caches its link providers' replies PER LINE (`Linkifier._handleHover`: a move within the
       * active line re-checks the cached replies and calls `provideLinks` again only when the LINE
       * changes). Round four's provider answers synchronously from the grammar (FR-155), so the first
       * query already holds every link; entering from another line keeps each hover a fresh query all
       * the same, so a reading never depends on what an earlier one left cached.
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
       * A detected path is a link by grammar (FR-155): hovered, it is marked in the hover state with
       * nothing asked of main. Polled only so a slow first paint cannot fail it.
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
       * geometry. Since round four a detected path needs no round trip either (FR-155).
       */
      await hover(WEB_URL, 6);
      await expect
        .poll(hovered, { timeout: 10_000, message: 'a plain url in a terminal is no longer marked on hover' })
        .toContain(WEB_URL);

      await settleOnRealPath();

      /*
       * *Round four (T292; FR-155 superseding FR-006 for drawing):* the look-alike names nothing on
       * disk, and it is a link all the same — marked in the hover state exactly as the real path is,
       * with no existence check (it is resolved only when followed, FR-160). Sampled at two cells and
       * alternated with the real path, so the reading is of the look-alike and not a mark left over
       * from its neighbour.
       */
      for (let pass = 0; pass < 2; pass += 1) {
        for (const into of [3, 6]) {
          await hover(LOOK_ALIKE, into);
          await expect
            .poll(hovered, {
              timeout: 10_000,
              message: `${LOOK_ALIKE} is path-shaped, so it is a link by grammar and must be marked on hover (FR-155)`,
            })
            .toContain(LOOK_ALIKE);
        }
        await settleOnRealPath();
      }

      // AT REST (FR-136): the pointer gone, every link in the row is marked — the look-alike included.
      await win.mouse.move(2, 2);
      await expect
        .poll(() => linkMarkedText(row), { timeout: 10_000, message: 'the row lost its at-rest marks' })
        .toContain(WEB_URL);
      const atRest = await linkMarkedText(row);
      expect(atRest).toContain(REAL_PATH);
      expect(atRest).toContain(LOOK_ALIKE);
      expect(atRest).toContain('nothere');

      /*
       * ══ T186 — each link kind, soft-wrapped, is marked on EVERY row it occupies ══
       *
       * The window is narrowed to its minimum so each fixture link wraps, and the screen cleared so
       * the whole fixture is in view — the view pass marks what is IN VIEW (FR-136). The narrowing
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
       * ══ T213, amended by T292 — an unfollowable hyperlink is plain text (FR-154 as FR-163 amends it) ══
       *
       * The live `file:` hyperlink is the control, and it goes first: once it is marked, the view pass
       * has run over these rows, so an unmarked one is judged, not pending. Nothing is asked of main
       * for any of them (FR-163). The whole block is the OSC 8 half — see `oscRuns` above.
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

      /**
       * Everything drawn on one row that could read as a link, sampled at the pointer's position:
       * throng's mark (the text under it), the underline that mark draws (its border, `terminal.css` —
       * dashed at rest, solid hovered), any text-decoration xterm left on the cells, and the hand.
       */
      const drawn = async (
        text: string,
      ): Promise<{ mark: string; markUnderline: string[]; underline: string[]; cursor: string; pointerHost: boolean }> => {
        const r = rowOf(text);
        const at = await charPoint(r, text, 3);
        const mark = await linkMarkedText(r);
        const markUnderline = await r.evaluate((el) => {
          const row = el.getBoundingClientRect();
          return [...(el.closest('.xterm')?.querySelectorAll<HTMLElement>('.terminal-link-mark') ?? [])]
            .filter((m) => {
              const b = m.getBoundingClientRect();
              return b.width > 0 && b.top < row.bottom - row.height / 4 && b.bottom > row.top + row.height / 4;
            })
            .map((m) => getComputedStyle(m).borderBottomStyle)
            .filter((s) => s !== 'none');
        });
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
        return { mark, markUnderline, underline, cursor, pointerHost };
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

      /*
       * T292 / FR-163: the two `file:` targets that name nothing — a missing file, an unreachable host
       * — are links: a mark at rest (its dashed underline), and hovered, the solid underline and the
       * hand (FR-164, modifier or not). Nothing was asked of main to draw them.
       */
      for (const f of UNFOLLOWED_FILES) {
        await win.mouse.move(2, 2);
        await expect
          // `rowText`: xterm draws a space as a no-break space, and these labels carry one.
          .poll(async () => rowText((await drawn(f.text)).mark), {
            timeout: 10_000,
            message: `${f.text} (${f.uri}) is a well-formed file: target, so it is marked at rest (FR-163)`,
          })
          .toBe(f.text);
        expect((await drawn(f.text)).markUnderline, `${f.text} carries the dashed at-rest underline`).toContain('dashed');

        await enter(f.text);
        await expect
          .poll(async () => (await drawn(f.text)).pointerHost, {
            timeout: 10_000,
            message: `${f.text} hovered never showed the hand (FR-164)`,
          })
          .toBe(true);
        const hover = await drawn(f.text);
        expect(hover.cursor, `${f.text} shows the hand on hover`).toBe('pointer');
        expect(hover.markUnderline, `${f.text} carries the solid hover underline`).toContain('solid');
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
      /*
       * No hover state at all for any of them: an unfollowable hyperlink has none (FR-154).
       *
       * Round five retired the hover tip this used to assert on. The two things that remain are the
       * status bar's readout and the native `title` on the terminal host — and the title is the one
       * worth checking here, because FR-169a made it the hover affordance a user actually sees, and
       * a stale one would name a target that Ctrl+click refuses to follow.
       */
      await expect(win.locator('[data-testid^="terminal-status-link-readout-"]')).toHaveCount(0);
      expect(
        await win.evaluate(() => document.querySelector('.terminal-panel')?.getAttribute('title') ?? ''),
      ).toBe('');
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * ══ 045 FR-060 (round five) — the switch OFF, over a link the PROGRAM declared ══
 *
 * WHY THIS CANNOT MOVE DOWN A LAYER. `link-detection-switches.test.ts` already pins the OFF state of
 * everything the provider and the view pass decide, with a fake terminal. What it cannot reach is the
 * three seams the widening added inside `use-terminal.ts`'s mount closure — `oscLinksInView`,
 * `setHoveredUri` and `openTerminalLink` — because none is exported and no test in this repo
 * constructs a real xterm `Terminal` at all. And a DECLARED hyperlink does not exist until a real
 * ConPTY has carried the OSC 8 sequence around its text, which is why the hyperlink half is gated on
 * the OS build exactly as T213's is. So the OFF state of the switch over a program-emitted link has
 * no cheaper layer.
 *
 * ANTI-VACUITY, three ways, because every assertion here is a negative:
 *   - the plain url shares the row, and this file's first declaration reads the SAME mark positively
 *     on a plain url in the same panel, so an empty reading is a decision rather than a broken probe;
 *   - `xterm-underline-5` is xterm's own class on every OSC 8 cell, written by its parser and nothing
 *     to do with throng (`terminal.css` only neutralises its rendering), so its presence is proof the
 *     hyperlink genuinely arrived while throng drew nothing over it;
 *   - `charPoint` throws with the row's whole text if a token is not there, so "the pointer missed"
 *     can never read as "nothing was marked";
 *   - and the config probe below reads the switch back out of the running app, so the one way every
 *     negative here could pass together — the seeded setting never arriving — is ruled out.
 *
 * OBSERVED RED, by accident and worth recording: run against a `packages/ui/dist` built BEFORE round
 * five widened the switch, it failed with `mark` reading `OSC8OFFhttps://example.com/plain-off` —
 * both links marked with the setting off, which is precisely the state this asserts is gone. A
 * rebuild turned it green. (It is also the `dist`-staleness trap CLAUDE.md records: the app loads
 * `dist`, vitest loads source, so every cheaper layer agreed while the app under test did not.)
 */
// One line, deliberately: e2e-budget.test.ts and e2e-tags.test.ts match the declaration with a LINE-based regex.
test('with editor.links.detectInTerminals off, a program-declared OSC 8 hyperlink is as inert as a plain url — no mark, no underline, no hand, no readout, no title, and a Ctrl+click opens nothing (045 FR-060)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-linksoff-'));
  // The setting has to be in settings.json BEFORE the app starts: the provider, the view pass and the
  // three closure seams all read it, and a test that toggled it afterwards would prove the hot-reload
  // path instead of the OFF state.
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-linksoff-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, editor: { links: { detectInTerminals: false } } }),
    'utf8',
  );
  writeOffScript(root);

  try {
    await runApp(
      async (app, win) => {
        // The one seam a followed http(s) link would reach (main re-validates and calls it): if
        // anything opens, it is recorded here.
        await app.evaluate(({ shell }) => {
          const g = globalThis as unknown as { __offOpened?: string[] };
          g.__offOpened = [];
          shell.openExternal = (url: string) => {
            g.__offOpened!.push(url);
            return Promise.resolve();
          };
        });
        const openedUrls = (): Promise<string[]> =>
          app.evaluate(() => (globalThis as unknown as { __offOpened?: string[] }).__offOpened ?? []);
        const windowsBefore = await app.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        );

        await createProject(win, 'LinksOff', root);
        // ANTI-VACUITY, before anything is read: the app this window is running really did take the
        // seeded switch. Every assertion below is a negative, and the one way they could all pass for
        // the wrong reason is the setting never arriving.
        expect(
          await win.evaluate(async () => {
            const cfg = (await window.throng?.config?.get()) as
              | { settings?: { editor?: { links?: { detectInTerminals?: unknown } } } }
              | undefined;
            return cfg?.settings?.editor?.links?.detectInTerminals;
          }),
          'the app did not take detectInTerminals:false from the seeded config root',
        ).toBe(false);
        const term = await openTerminal(win, root);
        await runTypedCommand(win, term, 'node off.js', { echoed: 'off.js', output: OFF_MARKER });

        const row = win.locator('.xterm-rows > div', { hasText: OFF_MARKER }).last();
        await expect(row).toBeVisible({ timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
        const rowBox = (await row.boundingBox())!;
        expect(rowText((await row.textContent()) ?? '')).toContain(OFF_WEB);
        expect(rowText((await row.textContent()) ?? '')).toContain(OFF_OSC_TEXT);

        /*
         * The OSC 8 half runs only where the OS's ConPTY carries a hyperlink around its text. Below
         * build 22000 no hyperlink arrives, so "the hyperlink drew nothing" would be true for the OS's
         * reason and prove nothing; the plain url on the same row is asked either way.
         */
        const oscRuns = osc8HalfRuns('the OFF state of detectInTerminals over a program-declared OSC 8 hyperlink (FR-060)');
        if (oscRuns) {
          // ANTI-VACUITY: xterm's own per-cell OSC 8 class — the hyperlink is really here.
          const oscCells = await row.evaluate((el) => el.querySelectorAll('.xterm-underline-5').length);
          expect(oscCells, 'no xterm OSC 8 cell on this row — the hyperlink never arrived').toBeGreaterThan(0);
        }

        /** Everything on this row that could read as a link, sampled at the pointer's position. */
        const drawnOff = async (
          token: string,
        ): Promise<{
          mark: string;
          hoverMark: string;
          underline: string[];
          cursor: string;
          pointerHost: boolean;
          title: string;
          readouts: number;
        }> => {
          const at = await charPoint(row, token, 3);
          return {
            mark: await linkMarkedText(row),
            hoverMark: await linkMarkedText(row, { hover: true }),
            underline: await row.evaluate((el) =>
              [...el.querySelectorAll('span')]
                .map((s) => getComputedStyle(s).textDecorationLine)
                .filter((d) => d !== 'none'),
            ),
            cursor: await win.evaluate(
              ([x, y]) => {
                const el = document.elementFromPoint(x, y);
                return el ? getComputedStyle(el).cursor : 'nothing';
              },
              [at.x, at.y] as [number, number],
            ),
            pointerHost: await term.evaluate((el) => el.classList.contains('terminal-link-pointer')),
            title: await win.evaluate(
              () => document.querySelector('.terminal-panel')?.getAttribute('title') ?? '',
            ),
            readouts: await win.locator('[data-testid^="terminal-status-link-readout-"]').count(),
          };
        };
        /** Arrive from the row BELOW, so each hover is a fresh query rather than a cached reply. */
        const enterOff = async (token: string): Promise<void> => {
          const at = await charPoint(row, token, 3);
          await win.mouse.move(at.x, at.y + rowBox.height);
          await win.mouse.move(at.x, at.y);
        };

        const tokens = oscRuns ? [OFF_WEB, OFF_OSC_TEXT] : [OFF_WEB];
        for (const token of tokens) {
          // Hovered, and hovered with Ctrl held — the modifier is what turns a live link into the hand.
          for (const ctrl of [false, true]) {
            await enterOff(token);
            if (ctrl) await win.keyboard.down('Control');
            try {
              const held = ctrl ? ' with Ctrl held' : '';
              const got = await drawnOff(token);
              expect(got.mark, `${token} is marked${held}`).toBe('');
              expect(got.hoverMark, `${token} is marked in the HOVER state${held}`).toBe('');
              expect(got.underline, `${token} is underlined${held}`).toEqual([]);
              expect(got.cursor, `${token} shows the hand${held}`).not.toBe('pointer');
              expect(got.pointerHost, `${token} set the hand on the panel${held}`).toBe(false);
              expect(got.readouts, `${token} produced a status-bar readout${held}`).toBe(0);
              expect(got.title, `${token} put a target in the panel's native title${held}`).toBe('');
            } finally {
              if (ctrl) await win.keyboard.up('Control');
            }
          }
        }

        /*
         * AT REST, and LAST rather than first, because at rest there is nothing to poll for.
         *
         * An empty at-rest reading taken straight off the output is satisfied by a view pass that has
         * not drawn yet, and it was: measured on the first run of this test, the at-rest read came
         * back empty and the hover a moment later found both links marked. The hovers above force
         * real renders, so by here the marks pass has certainly run.
         */
        await win.mouse.move(2, 2);
        const rest = await drawnOff(OFF_WEB);
        expect(rest.mark, 'a link was marked at rest with detectInTerminals off').toBe('');
        expect(rest.underline, 'something on the row is underlined at rest').toEqual([]);

        // A Ctrl+click on the DECLARED hyperlink opens nothing — the gesture is the program's (FR-060).
        if (oscRuns) {
          const at = await charPoint(row, OFF_OSC_TEXT, 3);
          await win.keyboard.down('Control');
          try {
            await win.mouse.click(at.x, at.y);
          } finally {
            await win.keyboard.up('Control');
          }
          /*
           * Fenced on a real round-trip through this same terminal rather than a guessed idle period:
           * an open, if one happened, has hops of its own to make, and a shell that has echoed a later
           * command is proof that the opportunity has passed. Same reasoning as `fenceOnEcho` in
           * `terminal-link-once.e2e.ts`.
           */
          // Split across a concatenation for `narrowTerminalWindow`'s reason: typed whole, the ECHO
          // already satisfies the output wait and the fence would resolve before the round trip.
          await runTypedCommand(win, term, "echo ('LINKSOFF'+'FENCE')", {
            echoed: "'FENCE')",
            output: 'LINKSOFFFENCE',
          });
          expect(await openedUrls(), 'a Ctrl+click opened a link with detectInTerminals off').toEqual([]);
          expect(
            await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
            'a Ctrl+click opened a window with detectInTerminals off',
          ).toBe(windowsBefore);
        }
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(cfgRoot);
  }
});
