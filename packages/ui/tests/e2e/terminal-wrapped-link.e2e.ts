import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  type OpenApp,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';

/*
 * #326 — a wrapped terminal hyperlink is underlined only on its first row.
 *
 * The link works: clicking any row of it opens the correct, complete URL. Only the DRAWING stops at
 * the row break, so what looks like a link is shorter than what behaves like one.
 *
 * ══ THE TWO CANDIDATES, AND WHY ONLY ONE SURVIVES READING THE SOURCE ══
 *
 * throng puts TWO link providers on a terminal, and they are not the same code:
 *
 *   - PLAIN-TEXT URLs, matched by `WebLinksAddon` (use-terminal.ts, `new WebLinksAddon(...)`).
 *     `@xterm/addon-web-links` 0.12.0 IS wrap-aware — it stitches wrapped lines into one string
 *     (up to 2048 chars) before matching, so its range spans every row the URL occupies.
 *
 *   - OSC 8 HYPERLINKS, matched by xterm's own built-in `OscLinkProvider`. That one takes a single
 *     `y` and never leaves it: every range it builds has `start.y === y` and `end.y === y`. Its
 *     closing comment says so outright —
 *
 *         // TODO: Handle fetching and returning other link ranges to underline other links with
 *         //       the same id
 *
 *     A wrapped OSC 8 link is exactly that: cells on several buffer lines sharing one `urlId`.
 *
 * The renderer is NOT the fault, which is worth stating because it was the first suspect.
 * `DomRenderer.ts` walks every row of whatever range it is given, starting at `x` on the first row
 * and 0 on continuation rows (`i === y ? x : 0`), ending at `x2` on the last and `cols` otherwise.
 * Give it a two-row range and it underlines two rows. It is being given a one-row range.
 *
 * ══ SO THIS TEST IS A DISCRIMINATOR, NOT JUST A REPRODUCTION ══
 *
 * Both link kinds are driven through the same gesture, in the same panel, at the same width:
 *
 *   - the PLAIN URL is the CONTROL. It must already underline across rows. If it does not, the
 *     reading above is wrong, the fault is somewhere common to both paths, and the OSC 8 assertion
 *     below would be blaming the wrong component. A test that only checked the failing case could
 *     not tell those apart.
 *   - the OSC 8 link is the DEFECT.
 *
 * ══ WHY THE FIX IS NOT A ONE-LINER, WHICH IS WORTH KNOWING BEFORE ANYONE TRIES ══
 *
 * The obvious move — register a link provider of our own that groups cells by `urlId` across wrapped
 * lines — DOES NOT WORK, and fails silently rather than loudly:
 *
 *   - `CoreBrowserTerminal.ts` registers `OscLinkProvider` in its constructor, so the built-in is
 *     always index 0 and discards the disposable that would remove it.
 *   - `Linkifier.ts`'s `_removeIntersectingLinks` walks providers in INDEX order and deletes any
 *     link whose cells overlap cells a lower-index provider already claimed. Ours would be index 1+
 *     and would lose on precisely the cells in question.
 *   - The public API offers `registerLinkProvider` and nothing else: no way to unregister the
 *     built-in, and `IBufferCell` exposes no `urlId`, so the grouping cannot be done from outside.
 *
 * So a fix means one of: an upstream change to `OscLinkProvider` (its TODO), a local patch of the
 * dependency, or a documented reach through `(term as any)._core._linkProviderService` to splice the
 * built-in out. That is a project decision, not something to pick while writing a test.
 *
 * ══ WHY E2E ══
 *
 * The underline is drawn, not computed: xterm's DOM renderer sets an inline
 * `text-decoration: underline` per cell span on hover (`DomRendererRowFactory.ts`, `isLinkHover`).
 * Reproducing it needs a real xterm with a real buffer, a real wrap, and a real pointer over a
 * specific cell. No test in this repo constructs an xterm `Terminal` at all, so there is no seam
 * below this one. It is cheap as E2E goes — one shared app, no daemon state, no real shell work.
 */

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

let projectSeq = 0;
const createProject = (win: Page, name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/**
 * A long https URL, and the same URL again as an OSC 8 hyperlink with long link TEXT.
 *
 * Both are far wider than any panel this test can produce, so both are certain to wrap — the defect
 * only exists at a row break, and a fixture that happened to fit on one line would pass for free.
 * https, because `OscLinkProvider` drops any non-http(s) URL before it ever builds a range.
 */
const LONG_PATH = 'abcdefghij'.repeat(24); // 240 chars
const PLAIN_URL = `https://example.invalid/plain/${LONG_PATH}`;
const OSC8_URL = `https://example.invalid/osc8/${LONG_PATH}`;

function writeFixture(root: string): void {
  const lines = [
    `const plain = ${JSON.stringify(PLAIN_URL)};`,
    `const osc8Url = ${JSON.stringify(OSC8_URL)};`,
    "process.stdout.write('PLAIN_BEGIN\\r\\n');",
    "process.stdout.write(plain + '\\r\\n');",
    "process.stdout.write('OSC8_BEGIN\\r\\n');",
    // ESC ] 8 ; ; <uri> ST  <text>  ESC ] 8 ; ; ST — the link TEXT is the long one, so it wraps.
    "process.stdout.write('\\x1b]8;;' + osc8Url + '\\x1b\\\\' + osc8Url + '\\x1b]8;;\\x1b\\\\');",
    "process.stdout.write('\\r\\nDONE\\r\\n');",
  ];
  writeFileSync(join(root, 'links.js'), lines.join('\n'), 'utf8');
}

async function startTerminal(win: Page, root: string): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  return pid;
}

/**
 * Hover the first cell of the row containing `marker`'s following line, then count how many ROWS
 * carry an underlined span.
 *
 * The underline is an inline style the DOM renderer writes per cell
 * (`charElement.style.textDecoration = 'underline'`), so this reads what is actually drawn rather
 * than what any provider claims. Rows are counted, not spans: a row is split into several spans for
 * unrelated reasons (colour runs, the cursor cell), so a span count would move for reasons that have
 * nothing to do with this defect.
 */
async function underlinedRowsAfterHoveringLink(
  win: Page,
  pid: string,
  urlText: string,
): Promise<number> {
  const cell = win
    .getByTestId(`terminal-${pid}`)
    .locator('.xterm-rows > div')
    .filter({ hasText: urlText.slice(0, 40) })
    .first();
  await expect(cell).toBeVisible({ timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  const box = await cell.boundingBox();
  if (box === null) throw new Error('the row holding the link has no box — nothing to hover');
  // A little inside the row, well clear of its left edge, so the pointer is certainly on a link cell.
  await win.mouse.move(box.x + box.width / 3, box.y + box.height / 2);

  return win
    .getByTestId(`terminal-${pid}`)
    .locator('.xterm-rows > div')
    .evaluateAll(
      (rows) =>
        rows.filter((row) =>
          [...row.querySelectorAll('span')].some(
            (s) => (s as HTMLElement).style.textDecoration === 'underline',
          ),
        ).length,
    );
}

// One line, deliberately: e2e-budget.test.ts and e2e-tags.test.ts match the declaration with a LINE-based regex.
test('a wrapped OSC 8 hyperlink is underlined on every row it occupies, as a wrapped plain URL already is (#326)', { tag: ['@extended', '@terminal', '@reserve:layout'] }, async () => {
  /*
   * SKIPPED BY DEFAULT — the reproduction is confirmed, the fix is not yet decided.
   *
   * This fails on its last assertion, on purpose. #326 is real and reproduced, but no fix has landed
   * because none is available through xterm's public API (see the header), and a red test for
   * undelivered work would make `npm run gate` permanently red.
   *
   * Skipped IN THE BODY, not at the declaration: both guards match a declaration with
   * `/^\s*test\(/`, so `test.skip(` at the front would drop this file out of the budget ratchet and
   * leave it untagged, running it in neither lane.
   *
   *     THRONG_I326_REPRO=1 npx playwright test packages/ui/tests/e2e/terminal-wrapped-link.e2e.ts --workers=1
   *
   * Un-skip it in the commit that fixes the defect — at which point it passes and becomes the
   * regression test.
   */
  test.skip(
    process.env.THRONG_I326_REPRO !== '1',
    '#326 is reproduced but unfixed; this fails by design. Set THRONG_I326_REPRO=1 to run it.',
  );

  const root = mkdtempSync(join(tmpdir(), 'throng-wraplink-'));
  writeFixture(root);

  const win = shared.win;
  await createProject(win, 'WrapLink', root);
  const pid = await startTerminal(win, root);
  const term = win.getByTestId(`terminal-${pid}`);

  await term.click();
  await win.keyboard.type('node links.js', { delay: 10 });
  await win.keyboard.press('Enter');
  await expect(term).toContainText('DONE', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

  /*
   * ══ CONTROL: the plain URL, whose provider IS wrap-aware ══
   *
   * This must already span more than one row. If it does not, the fault is common to both link
   * paths — or this harness cannot see a multi-row underline at all — and the assertion after it
   * would be pointing at the wrong component.
   */
  const plainRows = await underlinedRowsAfterHoveringLink(win, pid, PLAIN_URL);
  expect(
    plainRows,
    'a wrapped PLAIN url must underline on every row it occupies — WebLinksAddon 0.12.0 stitches ' +
      'wrapped lines before matching. If this is 1, the defect is not specific to OSC 8 and the ' +
      'assertion below is blaming the wrong provider',
  ).toBeGreaterThan(1);

  // ══ THE DEFECT: the same URL, delivered as an OSC 8 hyperlink ══
  const osc8Rows = await underlinedRowsAfterHoveringLink(win, pid, OSC8_URL);
  expect(
    osc8Rows,
    'a wrapped OSC 8 hyperlink is underlined only on its first row: xterm\'s OscLinkProvider builds ' +
      'every range with start.y === end.y === the hovered line, so the renderer is handed one row ' +
      'for a link that occupies several. Clicking any row still opens the whole URL, which is why ' +
      'this reads as a drawing fault rather than a broken link (#326)',
  ).toBeGreaterThan(1);
});
