/**
 * 031 US4 — the name limit, in the running application (#226).
 *
 * `contracts/name-limit.md` splits into two halves, and only one of them can be settled by a unit
 * test. `countGraphemes`/`truncateGraphemes` are pure and are covered there (N1–N9). What is NOT
 * pure — the limit being APPLIED — is C1–C6 and NP1–NP4, and almost all of it now lives below this
 * layer. What is left here is one test, and it is here for one reason: a COMPUTED colour and weight
 * either side of the limit, against a real inherited cascade (034 FR-049).
 *
 *
 * ══ WHAT NO LONGER IS (034 FR-045) ══
 *
 * The BOX itself — the cap on the way in, the counter appearing at ten remaining, the grapheme
 * cut, the paste, the at-limit marking, no invalid marking, and a limit lowered under an open
 * box — is `packages/ui/tests/component/name-limit-field.test.ts`, which asserts every one of
 * them TWICE: once per call site, because the tab chip and the panel header render the same
 * `NameLimitField`. That there are exactly two such call sites, both taking
 * `settings.tabs.maxNameLength`, is `packages/ui/tests/unit/name-limit-call-sites.test.ts`.
 *
 *
 * ══ AND WHAT NO LONGER IS (035 T055/T056) — FIVE REMOVED ══
 *
 * Everything this file used to say about the STORE went to
 * `packages/ui/tests/component/tab-name-limit-store.test.ts`:
 *
 *   `:265` T081  — committing a rename applies the limit, so an over-long name cannot be
 *                  reintroduced (FR-035f)
 *   `:329` T082  — lowering the limit mid-rename updates the counter immediately (C5)
 *   `:355` T083  — a persisted layout holding a 300-character name loads, shortened and marked (NP4)
 *   `:447` T084a — lower then raise the limit with nothing else changed, and the full names
 *                  return (NP1, NP3)
 *   `:509` T084b — an ordinary layout save at the lower limit makes the shortening permanent (NP2)
 *
 * The header this file used to carry said those four persistence tests "relaunch or write a layout"
 * and stay untouched. That was true of what they DID and not of what they CLAIMED. Underneath every
 * one of them are two seams in the renderer, and neither is a window, a process or a paint:
 * `boundLayoutNames` reaching both save paths in `workspace-store.tsx` — the drain and the 400 ms
 * debounce — and the limit being read LIVE at the moment of the write, which is why it is held in a
 * ref rather than closed over. `boundLayoutNames` is pure and was already covered by
 * `core/tests/unit/bound-layout-names.test.ts`; what had no test at any layer was the WIRING.
 *
 * The component file drives a REAL `ConfigProvider` through `window.throng.config.onChange` — the
 * same callback main broadcasts a reloaded document on — and a stateful fake daemon, so switching
 * project and back is a genuine reload rather than a re-render. That is what makes NP1 and NP3
 * falsifiable at all: the renderer holds the full title in memory whatever the strip is drawing, so
 * only a round trip through the store can tell "read it and left it" from "read it and rewrote it".
 *
 * Red-proven against seven mutations, each of which reddens something a different one does not:
 * `flush-not-bound`, `debounce-not-bound` (the two save paths, separately), `limit-frozen-at-mount`
 * (the ref), `saves-on-load`, `load-bounds-state` (the pre-031 shape — apply the limit when you read
 * it), `never-marked`, and `field-ignores-limit-change`.
 *
 *
 * ══ HOW THE LIMIT IS CHANGED, AND WHY THE WAITS ARE HONEST ══
 *
 * The limit is a setting, so this test writes `settings.json` in the run's own config root and lets
 * hot-reload apply it (#108) — the preferences window would steal focus, and throng closes menus on
 * blur, so a focus-stealing spec makes some *unrelated* test flake.
 *
 * A settings write lands asynchronously, and no helper can tell you when. So nothing here waits for
 * "the setting to apply": the wait is for the CONDITION it is about — a counter whose total reads
 * the new limit — which cannot come true at the old value. Self-verifying rather than timed, which
 * is the difference between a poll and a sleep.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  cleanupTemp,
  settle,
  type OpenApp,
} from './harness.js';
import { stripGeometry } from './helpers/tabs.js';
import {
  writeTabSettings,
  tabIdOf,
  startTabRename,
  tabRenameCounter,
  awaitFieldLimit,
  counterStyle,
} from './helpers/tab-settings.js';

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let cfgRoot: string;
let dataDir: string;
const roots: string[] = [];

test.beforeAll(async () => {
  cfgRoot = mkdtempSync(join(tmpdir(), 'throng-namelimit-cfg-'));
  dataDir = mkdtempSync(join(tmpdir(), 'throng-namelimit-data-'));
  // The config root is OURS, so `writeTabSettings` can drive the limit.
  shared = await openApp({ dataDir, env: { THRONG_CONFIG_ROOT: cfgRoot } });
  await settle(shared.win);
});

test.afterAll(async () => {
  await shared?.close();
  cleanupTemp(cfgRoot);
  cleanupTemp(dataDir);
  for (const r of roots) cleanupTemp(r);
});

let seq = 0;

/** A fresh project (and therefore a fresh single-tab strip) for the test about to run. */
async function project(prefix: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'throng-namelimit-'));
  roots.push(root);
  const name = `${prefix}-${(seq += 1)}`;
  await newProject(shared.win, name, root);
  return name;
}

/** The id of the project's one tab. */
async function onlyTabId(): Promise<string> {
  const g = await stripGeometry(shared.win);
  expect(g.tabs.length, 'a fresh project opens with exactly one tab').toBe(1);
  return tabIdOf(g.tabs[0]!.testId);
}

/**
 * A deterministic name of `n` characters whose every prefix differs from every other prefix, so
 * "shortened to 30" and "shortened to 16" can never be confused for one another.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const name = (n: number): string =>
  Array.from({ length: n }, (_, i) => ALPHABET[i % ALPHABET.length]).join('');

// ── C1–C3, C6: the counter, against a real cascade ────────────────────────────────────────────

test('T078 — the field stops at the limit; the counter shows within ten of it and is not an error', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  const win = shared.win;
  await project('Counter');
  const tab = await onlyTabId();
  writeTabSettings(cfgRoot, { maxNameLength: 30 });

  const input = await startTabRename(win, tab);
  const counter = tabRenameCounter(win, tab);
  await awaitFieldLimit(input, counter, 30);

  // C2 — from ten remaining onwards, used against total.
  await input.fill(name(20));
  await expect(counter, 'C2: the counter appears at ten remaining').toHaveText('20/30');
  const approaching = await counterStyle(counter);

  // The field STOPS at the limit: forty characters offered, thirty accepted, cut where the limit is.
  await input.fill(name(40));
  await expect(counter, 'C2: at-limit reads used === total').toHaveText('30/30');

  /*
   * C3 — NOT an error state, and THE reason this test is still at this layer.
   *
   * `counterStyle` reads a COMPUTED colour and font-weight, which is a fact about a real inherited
   * cascade — 034 FR-049, and one of the two things jsdom structurally cannot produce. Asserted as
   * "nothing about it changed", which is stronger than checking for the absence of one class name:
   * a red counter, a bolded one, or a notice raised behind it would each fail. The counter is
   * asserted PRESENT first, so the absence checks cannot pass against an unrendered DOM.
   */
  const atLimit = await counterStyle(counter);
  expect(atLimit.color, 'C3: reaching the limit must not recolour the counter').toBe(
    approaching.color,
  );
  expect(atLimit.fontWeight, 'C3: nor re-weight it').toBe(approaching.fontWeight);
  /*
   * Counted as CHILDREN OF THE NOTICE LIST, not by a `notice-` test-id prefix.
   *
   * The prefix stopped meaning "a notice" when 030 added the growth delta region (FR-032a) — a
   * visually-hidden `aria-live` element, `notice-growth-live`, which is always in the DOM and empty
   * until a consolidated notice grows. A prefix match therefore counted 1 here forever, and read as
   * "the tab name limit raises a notice", which it does not. The container's children are the
   * notices themselves, so this says what it means and cannot be broken by a part gaining a name.
   */
  await expect(
    win.getByTestId('notices').locator('> *'),
    'C3: no notice is raised',
  ).toHaveCount(0);

  // Closes the box, and reads the title as the sync point for it having closed. The CLAIM that
  // a commit at the limit is not blocked is name-limit-field.test.ts:182 (`onCommit` fires with
  // the cut value); the rendered round trip through the store is
  // `component/tab-name-limit-store.test.ts`, which asserts on what reached `workspace.save`.
  await input.press('Enter');
  await expect(win.getByTestId(`tab-title-${tab}`)).toHaveText(name(30));
});
