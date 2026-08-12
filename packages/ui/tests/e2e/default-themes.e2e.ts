import { mkdtempSync, mkdirSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, cleanupTemp, createProject, firstPanelId, settle } from './harness.js';

/**
 * US7 (007 Phase E data, SC-007): a fresh install ships all 14 default themes plus
 * `throng` (15 total) in the Themes selector, and a delete → restore cycle brings a
 * default back.
 */
const EXPECTED_15 = [
  'throng', 'Light', 'Snake', 'Gothic', 'Windows Terminal', 'Bash', 'SUBNET',
  'VSCode', 'VI-VIM', 'English Garden', 'Matrix', 'Cyberpunk', 'Claude', 'Debian', 'Ubuntu',
];

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-def-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

async function openThemes(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-themes').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();
  return prefs;
}

test('a fresh install lists all 14 default themes plus throng (15) and restores after delete', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      const select = prefs.getByTestId('theme-select');
      await expect.poll(() => select.locator('option').count()).toBe(15);
      const options = await select.locator('option').allTextContents();
      for (const name of EXPECTED_15) expect(options).toContain(name);

      // Select Matrix and delete it; the toolbar acts on the selected theme.
      await select.selectOption('Matrix');
      await expect(select).toHaveValue('Matrix'); // select = activate; wait for it to land
      await prefs.getByTestId('theme-delete').click();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'Matrix.json'))).toBe(false);
      // A deleted built-in leaves the list entirely; Restore All is the only way back (FR-005a).
      await expect
        .poll(() => select.locator('option').allTextContents())
        .not.toContain('Matrix');

      await prefs.getByTestId('theme-restore-all').click();
      await prefs.getByTestId('theme-confirm-yes').click();
      await expect.poll(() => existsSync(join(cfgRoot, 'themes', 'Matrix.json'))).toBe(true);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * 030 US4 (T056d) — THE SHARED FAILURE BANNER, UNDER ALL 15 SHIPPED THEMES.
 *
 * Here rather than in `panel-failure-banner.e2e.ts` because this file already owns the fact that
 * there are fifteen themes and what they are called: the list, the selector and the restore path all
 * live above, and a second copy of `EXPECTED_15` would be one more thing to keep in step.
 *
 * FR-047 / US4 AC10: the banner carries NO colours of its own and renders legibly in every shipped
 * theme. Three assertions, because each is capable of passing while the other two fail:
 *
 *   1. LEGIBLE — the banner's text contrasts with the background actually behind it, in every theme.
 *      A banner that inherits a token meant for a different surface passes (2) and (3) and is still
 *      unreadable in Matrix.
 *   2. THEMED — the effective colours CHANGE across the fifteen. A component with a hard-coded
 *      `#c33` is perfectly legible and identical everywhere, which is exactly the defect FR-047
 *      names, and it is invisible to (1).
 *   3. TOKENISED — no rule of the banner's own stylesheet declares a literal colour. (2) is
 *      satisfied by a component that themes its background and hard-codes its border; this is the
 *      assertion that reads the source of truth rather than the outcome.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/** sRGB relative luminance (WCAG 2.x), for the contrast ratio below. */
function luminance([r, g, b]: [number, number, number]): number {
  const chan = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(value: string): [number, number, number] | null {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

interface BannerColours {
  colour: string;
  /** The first NON-transparent background up the ancestor chain — what is really behind the text. */
  background: string;
  border: string;
}

/**
 * The banner's colours as rendered, resolving an inherited background rather than reporting
 * `rgba(0, 0, 0, 0)`.
 *
 * A transparent banner over a themed panel is a legitimate way to take colours from the theme, so
 * reading `background-color` off the root alone would fail a correct implementation and, worse,
 * would report every theme as identically transparent — passing the "no literal colour" idea while
 * measuring nothing at all.
 */
async function bannerColours(win: Page, panelId: string): Promise<BannerColours> {
  return win.getByTestId(`panel-failure-${panelId}`).evaluate((el) => {
    const cs = getComputedStyle(el);
    let node: Element | null = el;
    let background = 'rgba(0, 0, 0, 0)';
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg)) {
        background = bg;
        break;
      }
      node = node.parentElement;
    }
    return { colour: cs.color, background, border: cs.borderTopColor };
  });
}

test('the shared failure banner takes its colours from every shipped theme, and carries none of its own', async () => {
  test.setTimeout(300_000);
  const cfgRoot = freshCfgRoot();
  const root = mkdtempSync(join(tmpdir(), 'throng-theme-banner-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'code.txt'), 'ORIGINAL-CONTENT\n');

  try {
    await runApp(
      async (app, win) => {
        await settle(win);
        await createProject(win, 'ThemedFailure', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        await expect(win.getByTestId(`editor-${pid}`)).toBeVisible({ timeout: 20_000 });
        const tree = win.getByTestId('file-explorer-tree');
        await tree.getByText('src', { exact: true }).dblclick();
        await tree.getByText('code.txt', { exact: true }).click();
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'ORIGINAL-CONTENT',
          { timeout: 20_000 },
        );

        /*
         * Break the path with the panel UNMOUNTED, so the editor learns on its next mount
         * (`editor-coordinator.ts#verifyPath`) and comes up `unloadable` without being marked dirty.
         * The watcher route would reach the same banner and leave a dirty buffer behind it, which is
         * a save prompt waiting to happen in a file that is about colours.
         */
        await win.getByTestId('tab-add').click();
        const chips = win.getByTestId('tab-strip').locator('.tab-chip');
        await expect(chips).toHaveCount(2, { timeout: 20_000 });
        await chips.nth(1).click();
        renameSync(join(root, 'src'), join(root, 'src-moved'));
        await chips.first().click();

        const brokenPid = await firstPanelId(win);
        // SETUP, stated in whichever markup is current: the panel really is in its failure state,
        // so a red below is about the banner's colours and not about a panel that is perfectly fine.
        await expect(
          win.locator(
            `[data-testid="panel-failure-${brokenPid}"], [data-testid="editor-unloadable-${brokenPid}"]`,
          ),
          'the editor never reached its failure state — SETUP failure, not a theme failure',
        ).toHaveCount(1, { timeout: 30_000 });
        const banner = win.getByTestId(`panel-failure-${brokenPid}`);
        await expect(banner).toBeVisible();

        /*
         * ── 3. The banner's own rules declare no literal colour (FR-047). ───────────────────────
         *
         * The rules are found through the banner's OWN class list, read off the rendered element,
         * rather than through a guessed `.panel-failure` prefix. A guessed selector that matched
         * nothing would report an empty list of offenders and pass — a component that hard-codes
         * every colour it has would sail through it, which is the exact opposite of the point. The
         * matched-rule count is asserted for the same reason.
         */
        const audit = await banner.evaluate((el) => {
          const classes = Array.from(el.classList);
          const offenders: string[] = [];
          let matched = 0;
          for (const sheet of Array.from(document.styleSheets)) {
            let rules: CSSRuleList;
            try {
              rules = sheet.cssRules;
            } catch {
              continue; // a sheet we may not read has nothing of ours in it
            }
            for (const rule of Array.from(rules)) {
              const selector = (rule as CSSStyleRule).selectorText;
              if (!selector || !classes.some((c) => selector.includes(`.${c}`))) continue;
              matched += 1;
              const text = (rule as CSSStyleRule).style.cssText;
              // `var(--…)`, `transparent`, `inherit` and `currentColor` are fine; a literal is not.
              const stripped = text.replace(/var\([^)]*\)/g, '');
              if (/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(stripped)) offenders.push(`${selector} { ${text} }`);
            }
          }
          return { classes, matched, offenders };
        });
        expect(
          audit.matched,
          `no stylesheet rule matches any of the banner's classes (${audit.classes.join(', ')}) — ` +
            'the colour audit below would have had nothing to look at',
        ).toBeGreaterThan(0);
        expect(
          audit.offenders,
          'the banner stylesheet hard-codes colours instead of using theme tokens',
        ).toEqual([]);

        // ── 1 & 2. Legible in every theme, and different across them. ────────────────────────────
        const prefs = await openThemes(app, win);
        const select = prefs.getByTestId('theme-select');
        await expect.poll(() => select.locator('option').count()).toBe(15);

        const seen = new Set<string>();
        for (const theme of EXPECTED_15) {
          await select.selectOption(theme);
          await expect(select).toHaveValue(theme); // select = activate; wait for it to land
          // Polled: the theme is applied to the MAIN window over IPC, a beat after the selector
          // settles in the preferences window.
          await expect
            .poll(async () => (await bannerColours(win, brokenPid)).colour, { timeout: 10_000 })
            .not.toBe('');

          const { colour, background, border } = await bannerColours(win, brokenPid);
          const fg = parseRgb(colour);
          const bg = parseRgb(background);
          expect(fg, `${theme}: the banner has no text colour`).not.toBeNull();
          expect(bg, `${theme}: nothing behind the banner has a background`).not.toBeNull();
          // 3:1 — WCAG's non-text / large-text floor. A banner is a headline plus icon controls, and
          // the claim being tested is legibility, not body-copy AA.
          expect(
            contrast(fg!, bg!),
            `${theme}: the failure banner is not legible (${colour} on ${background})`,
          ).toBeGreaterThanOrEqual(3);
          seen.add(`${colour}|${background}|${border}`);
        }

        /*
         * The colours MOVED with the theme. Fifteen themes producing one triple means the component
         * is painting itself — legibly, consistently and wrongly, which is the one failure mode the
         * contrast check above cannot see. Three distinct triples rather than fifteen because
         * several shipped themes deliberately share a palette family.
         */
        expect(
          seen.size,
          'the banner rendered identically under every theme — it is carrying its own colours',
        ).toBeGreaterThanOrEqual(3);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(root);
  }
});
