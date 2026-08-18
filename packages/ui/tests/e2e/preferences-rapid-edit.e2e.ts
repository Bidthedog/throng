import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { openApp, settle, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';

/**
 * Issue #50 — two edits in quick succession must not clobber each other.
 *
 * The preferences editors apply immediately and each edit writes the WHOLE document,
 * computed from the renderer's copy of it. That copy used to refresh only when the config
 * watcher round-tripped the file back, so a second edit made inside that window was computed
 * from a pre-first-edit snapshot and silently reverted the first. Nothing errored; the user's
 * change was simply gone.
 *
 * These tests do the edits back-to-back with no settling wait — the point is precisely that
 * the user is faster than the round-trip.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-rapid-'));
  cfgRoots.push(dir);
  return dir;
}
/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * Neither test seeded anything. Both read the SHIPPED value of what they are about to edit before
 * editing it (`zoom.in`'s chord count, `editor.autoSave` being false), so both depend on arriving at a
 * pristine config root — which is precisely what `restoreConfigRoot` guarantees, and what running
 * second in a shared app would otherwise take away.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed config root does not
 * fail, it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional. These tests share a window, a config root and the ONE preferences
 * window throng allows, so they must not interleave — and when one fails the rest are SKIPPED rather
 * than run against whatever state the failure left behind (see `openApp` in harness.ts).
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let cfgRoot: string;
let baseline: ConfigRootSnapshot;

test.beforeAll(async () => {
  cfgRoot = freshCfgRoot();
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
  await settle(shared.win);
  // Photograph the root only once first-run seeding has finished — settings, key bindings and every
  // shipped theme. A partial snapshot would have every later restore DELETE whatever arrived late.
  await expect.poll(() => configRootSeeded(cfgRoot), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(cfgRoot);
});

/*
 * Put the config root back between tests — with the preferences window CLOSED FIRST.
 *
 * The order is load-bearing twice over. A dirty JSON buffer raises `json-external-change` when the
 * file changes underneath it, so restoring against an open window would hand the next test a notice
 * it never asked for. And the on-entry snapshot that Revert and Revert All compare against is
 * captured when the preferences window MOUNTS (`preferences-app.tsx`), so carrying one window across
 * tests would carry the first test's baseline into the last one.
 */
test.afterEach(async () => {
  await closePrefsWindow(shared.app);
  await settleConfigRoot(baseline);
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

function readJson(cfgRoot: string, file: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, file), 'utf8'));
  } catch {
    return null;
  }
}

async function openPrefs(app: ElectronApplication, win: Page, tab: 'settings' | 'keybindings'): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

test('two key-binding edits in quick succession both survive (#50)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'keybindings');
      await expect(prefs.getByTestId('keybindings-tab')).toBeVisible();

      const zoomInBefore: string[] = readJson(cfgRoot, 'keybindings.json').bindings['zoom.in'];
      const zoomOutBefore: string[] = readJson(cfgRoot, 'keybindings.json').bindings['zoom.out'];

      /*
       * Let the row become interactive before the pair — NOT between them.
       *
       * The failure was always the same shape: `zoom.in` came back with ALL its chords while
       * `zoom.out` kept its removal, i.e. the FIRST click did nothing. That reads like the #50 bug
       * this test guards (a second write computed from a pre-first-write snapshot), which is why it
       * is worth being explicit that it is not: making renderer edits compose from the last written
       * map changed the failure rate not at all (1-in-8 before, 1-in-12 after — noise), whereas a
       * settle before the first click took it to 12/12.
       *
       * So the click was being dispatched at a row Playwright considers actionable — visible, stable,
       * enabled — before React had bound its handler. Nothing observable reflects that binding, which
       * is the one case where a bounded wait beats waiting on a condition. It goes BEFORE the pair;
       * the two clicks stay back-to-back, because their being back-to-back is the whole point.
       */
      // sleep-justified: React's own handler-binding for this row raises no event, sets no
      // sleep-justified: attribute and changes no text — there is nothing to poll() or quiesced()
      // sleep-justified: on, which is what the paragraph above measured and this 600ms stands in for.
      await prefs.waitForTimeout(600);
      // Back-to-back, with NO wait between them — this is the whole point.
      await prefs.getByTestId('binding-zoom.in-remove-0').click();
      await prefs.getByTestId('binding-zoom.out-remove-0').click();

      /*
       * Poll for BOTH, together.
       *
       * The two writes are independent, so waiting for one and then asserting the other with a
       * non-retrying `expect` is a race the test itself creates: zoom.out can land first and the
       * check on zoom.in then reads a file that is a few milliseconds from being correct. It failed
       * that way repeatedly across full runs while passing alone — and the claim being made is that
       * BOTH survive, so both belong in the same wait.
       */
      await expect
        .poll(() => {
          const b = readJson(cfgRoot, 'keybindings.json')?.bindings ?? {};
          return `${b['zoom.out']?.length},${b['zoom.in']?.length}`;
        })
        .toBe(`${zoomOutBefore.length - 1},${zoomInBefore.length - 1}`);
    },
  );
});

test('two settings edits in quick succession both survive (#50)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      const before = readJson(cfgRoot, 'settings.json');
      expect(before.editor.autoSave).toBe(false);
      expect(before.editor.warnOnMissingFile).toBe(true);

      /*
       * The same settle the keybindings case above needs, for the same reason — see its comment.
       *
       * This failed once in a full-suite run under six CPU hogs with `Expected "false,true",
       * Received "false,false"`: `warnOnMissingFile` (the SECOND click) landed and `autoSave` (the
       * FIRST) did not, which is the signature of a click dispatched at a row Playwright considers
       * actionable before React has bound its handler.
       *
       * Being straight about the evidence: unlike the keybindings case, this was NOT reproducible in
       * isolation — 18 runs under eight and ten CPU hogs all passed. So the justification here is the
       * identical failure signature and the sibling's measured result (12/12 after its settle), plus
       * the fact that the two tests were otherwise structurally identical and only one had the wait.
       * Repeated full-suite runs are the verification, because that is the only place it has failed.
       */
      // sleep-justified: same as the keybindings case above — no observable marks the moment
      // sleep-justified: React finishes binding this row's click handler, so there is nothing for
      // sleep-justified: a poll to watch; this 600ms is the bounded wait in its place.
      await prefs.waitForTimeout(600);
      // Toggle two independent settings back-to-back, with NO wait between them.
      await prefs.getByTestId('control-editor.autoSave').click();
      await prefs.getByTestId('control-editor.warnOnMissingFile').click();

      // Both toggles in one wait — same reason as the keybindings case above: the second must not
      // have reverted the first, and reading it before it has landed proves nothing either way.
      await expect
        .poll(() => {
          const e = readJson(cfgRoot, 'settings.json')?.editor ?? {};
          return `${e.warnOnMissingFile},${e.autoSave}`;
        })
        .toBe('false,true');
    },
  );
});
