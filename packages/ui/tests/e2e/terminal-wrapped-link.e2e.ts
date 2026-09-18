import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  linkMarkedText,
  type OpenApp,
  TERMINAL_OUTPUT_TIMEOUT_MS,
} from './harness.js';
import { osc8HalfRuns } from './admin.js';

/*
 * #326 — a wrapped terminal hyperlink was underlined only on its first row.
 *
 * The link worked: clicking any row of it opened the correct, complete URL. Only the DRAWING stopped
 * at the row break, so what looked like a link was shorter than what behaved like one.
 *
 * ══ WHY IT HAPPENED ══
 *
 * xterm's built-in `OscLinkProvider` takes a single `y` and never leaves it: every range it builds has
 * `start.y === end.y === y` (its own TODO says so), and xterm drew its hover underline over exactly
 * that range. A wrapped OSC 8 link is cells on several buffer lines sharing one `urlId`, so only the
 * hovered row was drawn.
 *
 * ══ HOW 045 FIXED IT, AND WHAT THIS NOW MEASURES ══
 *
 * xterm's own link visuals are switched off inside a terminal panel (`terminal.css`; O10, research
 * R22), and throng draws the ONE link affordance itself as xterm decorations (`link-marks.ts`):
 * dashed at rest on every row a link occupies, solid on hover across every row of THAT link — for an
 * OSC 8 link, every adjacent row carrying the same target (FR-131). So this measures throng's mark in
 * its hover state (`.terminal-link-mark--hover`), not xterm's inline underline, which no longer
 * exists to be measured.
 *
 * ══ THE CONTROL ══
 *
 * Both link kinds are driven through the same gesture, in the same panel, at the same width. The
 * PLAIN url comes from throng's own provider, which reads the LOGICAL line, so it spans every row by
 * construction; if it does not, the fault is common to both paths — or this harness cannot see a
 * multi-row mark at all — and the OSC 8 assertion would be blaming the wrong component.
 *
 * ══ WHY E2E ══
 *
 * The mark is drawn, not computed: a real xterm, a real buffer, a real wrap and a real pointer over a
 * specific cell. `terminal-link-affordance.test.ts` pins the hover grouping with a fake terminal; it
 * cannot say what a real Linkifier reports for a wrapped OSC 8 cell, or where a decoration lands.
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
 * Hover a cell of the FIRST row of the link starting with `urlText`, then count how many rows carry
 * throng's mark in the hover state.
 *
 * Rows are counted, not marks: a mark is one decoration per row, but a count of elements would also
 * move with anything else xterm happens to render in the decoration container.
 */
async function hoverMarkedRowsAfterHoveringLink(win: Page, pid: string, urlText: string): Promise<number> {
  const rows = win.getByTestId(`terminal-${pid}`).locator('.xterm-rows > div');
  const first = rows.filter({ hasText: urlText.slice(0, 40) }).first();
  await expect(first).toBeVisible({ timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
  const box = await first.boundingBox();
  if (box === null) throw new Error('the row holding the link has no box — nothing to hover');
  // Arrive from the line below: xterm re-queries its link providers only when the LINE changes.
  await win.mouse.move(box.x + box.width / 3, box.y + box.height * 1.5);
  await win.mouse.move(box.x + box.width / 3, box.y + box.height / 2);

  let count = 0;
  for (let i = 0; i < (await rows.count()); i += 1) {
    if ((await linkMarkedText(rows.nth(i), { hover: true })).length > 0) count += 1;
  }
  return count;
}

// One line, deliberately: e2e-budget.test.ts and e2e-tags.test.ts match the declaration with a LINE-based regex.
test('a wrapped OSC 8 hyperlink is underlined on every row it occupies, as a wrapped plain URL already is (#326)', { tag: ['@extended', '@terminal', '@reserve:layout'] }, async () => {
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

  // ══ CONTROL: the plain URL, from the provider that reads the logical line ══
  await expect
    .poll(() => hoverMarkedRowsAfterHoveringLink(win, pid, PLAIN_URL), {
      timeout: 10_000,
      message:
        'a wrapped PLAIN url must be marked as hovered on every row it occupies. If this stays at 1 ' +
        'or 0, the fault is not specific to OSC 8 and the assertion below is blaming the wrong provider',
    })
    .toBeGreaterThan(1);

  /*
   * ══ THE DEFECT: the same URL, delivered as an OSC 8 hyperlink ══
   *
   * Only where the OS's ConPTY carries the hyperlink around its text (`osc8HalfRuns`, admin.ts). Below
   * build 22000 it wraps nothing, and because this link's TEXT is its url, the plain-url provider
   * would mark every row anyway — the assertion would pass having measured the control twice. So it
   * is reported NOT RUN there instead.
   */
  if (!osc8HalfRuns('the wrapped OSC 8 hover mark (#326)')) return;
  await expect
    .poll(() => hoverMarkedRowsAfterHoveringLink(win, pid, OSC8_URL), {
      timeout: 10_000,
      message:
        "a wrapped OSC 8 hyperlink is marked as hovered only on the row under the pointer: xterm's " +
        'OscLinkProvider reports one row at a time, and the hover state must span every adjacent row ' +
        'with the same target (FR-131, #326)',
    })
    .toBeGreaterThan(1);
});
