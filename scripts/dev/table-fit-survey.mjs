#!/usr/bin/env node
/**
 * 047 T067, SC-006a — how many of the repo's own tables fit a half-width Markdown preview with no
 * horizontal scrollbar, once `table-layout.ts` (T065/T066) lays them out.
 *
 * ══ DEV-ONLY, NOT SHIPPED, NOT IN THE GATE (research R13, quickstart.md "SC-006a corpus check") ══
 *
 * SC-006a's "≥ 95% of `docs/` and `specs/` tables fit" claim needs a REAL layout pass — jsdom has no
 * layout, so the pure water-filling function (`core/tests/unit/table-widths.test.ts`) can prove the
 * algorithm but not this number. This script is the other half: it launches throng against this repo
 * as its own project (which conveniently has `docs/` and `specs/`), previews every `.md` file under
 * either at half the window's width, and counts how many `<table>` elements need no horizontal scroll
 * to show all of their content. Run it once before sign-off and record the percentage in the PR body
 * (T072 — not this script's job; this script only measures).
 *
 * ══ USAGE ══
 *
 *   npm run build                        # this script drives the BUILT app, like the E2E harness
 *   node scripts/dev/table-fit-survey.mjs
 *   node scripts/dev/table-fit-survey.mjs --width 900   # half-width is derived from the launch
 *                                                        # window's own size by default; override it
 *                                                        # directly if a specific figure is wanted
 *
 * ══ WHY IT DOES NOT REUSE `tests/e2e/harness.ts` ══
 *
 * That file is loaded by the Playwright TEST runner, which transpiles TypeScript on the fly; a plain
 * `node` process cannot import it directly. This script re-derives the small slice of its launch
 * sequence it actually needs (a fresh config root and user-data dir, the app spawning its own daemon,
 * `createProject`'s three clicks) rather than pull in a TS build step for a dev-only tool. Where the
 * two overlap, the shape here deliberately matches the harness's (`electron.launch`, `THRONG_PIPE_NAME`
 * + `THRONG_DATABASE_PATH` so the app spawns its own daemon, `claudeFreeEnv`) so a reader who knows the
 * E2E suite recognises it.
 *
 * ══ HOW "FITS" IS MEASURED ══
 *
 * Generic over `table-layout.ts`'s own DOM shape (a wrapper element around an overflowing table, or
 * none at all): for each `<table>`, walk its ancestors up to the preview body looking for one whose
 * computed `overflow-x` is `auto`/`scroll` AND whose `scrollWidth` exceeds its `clientWidth` — that is
 * a real horizontal scrollbar being shown because of THIS table's content. No such ancestor: the table
 * fits.
 */
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN_ENTRY = join(ROOT, 'packages/ui/dist/main/main.js');
const QUICK_OPEN_CHORD = 'Control+Shift+T';
const QUICK_OPEN_TIMEOUT_MS = 15_000;
/** One file's whole survey — open, draw, count. Far above the slowest spec's few seconds. */
const FILE_DEADLINE_MS = 90_000;

function claudeFreeEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(CLAUDE|ANTHROPIC)/i.test(key)) delete env[key];
  }
  return env;
}

/** Every `.md` file under `dir`, repo-root-relative with forward slashes, sorted for a stable order. */
function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const full = join(entry.parentPath ?? entry.path, entry.name);
    out.push(relative(ROOT, full).split('\\').join('/'));
  }
  return out.sort();
}

/** `--flag value` from argv, or `fallback`. */
function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const files = [...markdownFiles(join(ROOT, 'docs')), ...markdownFiles(join(ROOT, 'specs'))];
  if (files.length === 0) {
    console.error(`no .md files found under docs/ or specs/ — is ${ROOT} the repo root?`);
    process.exitCode = 1;
    return;
  }

  const userData = mkdtempSync(join(tmpdir(), 'throng-survey-ud-'));
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-survey-cfg-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-survey-data-'));
  const pipeName = `\\\\.\\pipe\\throng-survey-${process.pid}-${Date.now()}`;

  // Every file previews in place (044 FR-070): the shipped default for a text provider is 'editor',
  // and typing through Quick Open one file at a time is not this script's job to click past.
  mkdirSync(cfgRoot, { recursive: true });
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ editor: { previews: { providers: { markdown: { defaultOpenAction: 'preview' } } } } }, null, 2),
  );

  console.log(`launching throng against ${ROOT} (${files.length} .md files under docs/ and specs/)…`);
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userData}`],
    env: {
      ...claudeFreeEnv(),
      THRONG_PIPE_NAME: pipeName,
      THRONG_CONFIG_ROOT: cfgRoot,
      THRONG_DATABASE_PATH: join(dataDir, 'throng.db'),
    },
  });

  let fitting = 0;
  let total = 0;
  const overflowing = [];
  const skipped = [];
  /** The file the app stopped answering on, if it did. */
  let stalled = null;

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await win.getByTestId('project-new').click();
    await win.getByTestId('project-root-input').fill(ROOT);
    await win.getByTestId('project-name-input').fill('table-fit-survey');
    await win.getByTestId('project-save').click();
    await win.locator('.project-item[data-active="true"]').first().waitFor({ timeout: 15_000 });

    // SC-006a's "a preview half the width of a typical window": the PREVIEW PANEL is sized to half the
    // launch window's width (or --width), not the window — the side panes take their share of a window,
    // and halving the window left a 262px preview, a quarter of one. The first file opens a preview to
    // measure, and the window is widened or narrowed by the difference.
    const target = argValue('--width', null) ?? (await app.evaluate(({ BrowserWindow }) => Math.round(BrowserWindow.getAllWindows()[0].getContentSize()[0] / 2)));
    await surveyOne(win, files[0]);
    const previewWidth = () =>
      win.locator('[data-testid^="preview-body-"]').first().evaluate((el) => el.clientWidth);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const delta = target - (await previewWidth());
      if (Math.abs(delta) <= 2) break;
      await app.evaluate(({ BrowserWindow }, d) => {
        const [bw] = BrowserWindow.getAllWindows();
        const [w, h] = bw.getContentSize();
        bw.setContentSize(w + d, h);
      }, delta);
      await win.waitForTimeout(300);
    }
    console.log(`preview panel ${await previewWidth()}px (target ${target}px)`);

    for (const [index, rel] of files.entries()) {
      const started = Date.now();
      const counted = await withDeadline(surveyOne(win, rel), FILE_DEADLINE_MS);
      if (counted === 'timeout') {
        // A renderer that stops answering on one document is a finding in its own right, not noise to
        // skip past: name it and stop, rather than hang the survey for hours as it once did.
        console.log(`[${index + 1}/${files.length}] ${rel} — no answer within ${FILE_DEADLINE_MS / 1000}s; stopping`);
        stalled = rel;
        break;
      }
      if (counted === null) {
        skipped.push(rel);
        console.log(`[${index + 1}/${files.length}] ${rel} — skipped`);
        continue;
      }
      fitting += counted.fit;
      total += counted.all;
      if (counted.all > 0 && counted.fit < counted.all) overflowing.push(`${rel} (${counted.fit}/${counted.all})`);
      console.log(`[${index + 1}/${files.length}] ${rel} ${counted.fit}/${counted.all} ${Date.now() - started}ms`);
    }
  } finally {
    await withDeadline(app.close(), 15_000);
  }

  report({ fitting, total, overflowing, skipped, stalled });
}

/** `promise`'s value, or `'timeout'` once `ms` pass first. */
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Open `rel` through Quick Open and count its tables; `null` when it never drew a preview. */
async function surveyOne(win, rel) {
  await win.keyboard.press(QUICK_OPEN_CHORD);
  await win.getByTestId('quickopen-input').fill(rel);
  const row = win.getByTestId(`quickopen-row-${rel}`);
  const found = await row
    .waitFor({ timeout: QUICK_OPEN_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!found) {
    await win.keyboard.press('Escape').catch(() => {});
    return null;
  }
  const body = win.locator('[data-testid^="preview-markdown-"]').first();
  // What the preview showed BEFORE this open: the count below must read the file just opened, and a
  // Last Active preview re-draws in place, so its element is there from the start.
  const shownBefore = (await body.count()) > 0 ? await body.evaluate((el) => el.textContent ?? '') : null;
  await row.click();

  await body.waitFor({ timeout: 15_000 }).catch(() => {});
  if ((await body.count()) === 0) return null;
  /* eslint-disable no-undef */
  if (shownBefore !== null) {
    // Two files with identical text never finish this wait; they are counted as drawn once it ends.
    await win
      .waitForFunction((before) => document.querySelector('[data-testid^="preview-markdown-"]')?.textContent !== before, shownBefore, { timeout: 15_000 })
      .catch(() => {});
  }
  // `table-layout.ts` has run on a table once it carries its `<colgroup>`.
  await win
    .waitForFunction(() => [...(document.querySelector('[data-testid^="preview-markdown-"]')?.querySelectorAll('table') ?? [])].every((t) => t.querySelector(':scope > colgroup')), undefined, { timeout: 5_000 })
    .catch(() => {});

  // FR-062's own terms, per table: a table fits when it needed no scroll wrapper (or its wrapper does not
  // actually scroll) and it ends inside the panel. Anything else in the document — a wide code block —
  // scrolling the body says nothing about the tables.
  return body.evaluate((el) => {
    const panelRight = el.getBoundingClientRect().right;
    let fit = 0;
    let all = 0;
    for (const table of el.querySelectorAll('table')) {
      all += 1;
      const wrapper = table.closest('.preview-table-scroll');
      const scrolls = wrapper !== null && wrapper.scrollWidth > wrapper.clientWidth + 1;
      const pastPanel = wrapper === null && table.getBoundingClientRect().right > panelRight + 1;
      if (!scrolls && !pastPanel) fit += 1;
    }
    return { fit, all };
  });
  /* eslint-enable no-undef */
}

function report({ fitting, total, overflowing, skipped, stalled }) {
  const pct = total > 0 ? ((fitting / total) * 100).toFixed(1) : '0.0';
  console.log('');
  console.log(`SC-006a: ${fitting} / ${total} tables fit at half width (${pct}%)`);
  if (overflowing.length > 0) {
    console.log('overflowing:');
    for (const line of overflowing) console.log(`  - ${line}`);
  }
  if (skipped.length > 0) {
    console.log(`skipped (never resolved in Quick Open or drew no preview): ${skipped.length}`);
    for (const rel of skipped) console.log(`  - ${rel}`);
  }
  if (stalled !== null) {
    console.error(`\nstopped: the app stopped answering on ${stalled}`);
    process.exitCode = 1;
  } else if (total > 0 && fitting / total < 0.95) {
    console.error(`\nbelow the SC-006a threshold (95%)`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
