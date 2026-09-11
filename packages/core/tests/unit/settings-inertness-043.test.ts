import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 043 FR-059a — every one of the eight `search.inFiles.*` preferences does something, and the
 * sibling it was added beside was not unplugged on the way in.
 *
 * Six at FR-059; the seventh and eighth arrive with FR-082, which is why FR-059's own table carries
 * an amendment reading "eight, not six".
 *
 * ══ WHAT AN INERT SETTING IS, AND WHY IT IS A DEFECT RATHER THAN AN OVERSIGHT ══
 *
 * A setting is inert when it is declared, defaulted, persisted, rendered as a live control in the
 * Settings editor — and read by nothing. The user changes it, the app writes it to `settings.json`,
 * and nothing happens. That is #95's `explorer.openMode`, which shipped that way for a year, and
 * #108 is the fleet-wide guard being written to catch the class. There is no such guard yet, so
 * each feature that adds settings writes its own; `settings-inertness-040.test.ts` is the pattern
 * this file copies.
 *
 * ══ THE ONE THING THIS FILE DOES THAT 040'S DOES NOT ══
 *
 * 040 matched a reader by LEAF alone (`.showGutter`), and its own header records the cost: the leaf
 * `showStatusBar` belongs to two settings, so the match cannot tell `editor.showStatusBar` from
 * `terminals.showStatusBar`. Here that weakness would not be a caveat, it would be a false pass:
 *
 *   - `openTarget` is ALREADY a leaf of `editor` (`app-settings.ts:216`), read by the editor's own
 *     open path. Leaf-only matching would report `search.inFiles.openTarget` as live before a line
 *     of this feature existed.
 *   - `trigger` is an ordinary English word that appears all over a renderer.
 *
 * So a reader here must name `inFiles` in the same file AS WELL as reading the leaf. That is still
 * idiom-broad — it accepts `settings.search.inFiles.trigger`, and it accepts pulling the section out
 * first (`const inFiles = settings.search.inFiles`) and reading `inFiles.trigger` below — but it can
 * no longer be satisfied by a setting that merely shares a leaf name with one of these eight.
 *
 * ══ WHY THIS IS A UNIT TEST AND NOT A COMPONENT ONE ══
 *
 * The claim is about the whole repository's source, not about a rendered form. What no rendered
 * component can show is that NOTHING ANYWHERE reads the value, because the evidence for that is an
 * absence across every file. This tier can read every file.
 *
 * A reader here is not proof the effect is CORRECT — it is proof the wire exists at all, which is
 * the only thing an inertness guard can honestly claim.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * The config layer: where a setting is declared, parsed, defaulted, shipped and persisted. Every
 * one of these files names every key by construction, so a match here is worth nothing.
 */
const CONFIG_LAYER = [
  'app-settings.ts',
  'settings-metadata.ts',
  'metadata.ts',
  'shipped-defaults.ts',
];

/** The eight keys 043 adds, with the behaviour each is supposed to move. */
const NEW_KEYS = [
  {
    key: 'search.inFiles.openTarget',
    governs: 'whether a search reuses the last Find in Files panel or opens a new one (FR-021)',
  },
  {
    key: 'search.inFiles.trigger',
    governs: 'whether a scan waits for Run or starts as you type (FR-043a, FR-043b)',
  },
  {
    key: 'search.inFiles.settleMs',
    governs: 'how long as-you-type waits before walking the tree (FR-043b)',
  },
  {
    key: 'search.inFiles.defaultGrouping',
    governs: 'how a fresh results panel groups its rows (FR-033a)',
  },
  {
    key: 'search.inFiles.rememberGrouping',
    governs: "whether a panel's grouping choice outlives the search that set it (FR-033b)",
  },
  {
    key: 'search.inFiles.warnIrreversibleCommit',
    governs: 'the confirmation before a replace that cannot be undone (FR-057c)',
  },
  /*
   * The two FR-082 adds, and this guard is worth more to them than to the six above.
   *
   * A display preference is the easiest kind of setting to leave inert, because a control that
   * renders, stores a mode and governs nothing looks EXACTLY like one that works — the notice still
   * appears, it just answers to the wrong number. The six above all change something a user watches
   * for; these two change how long they get to read it.
   */
  {
    key: 'search.inFiles.summaryNoticeMode',
    governs: "the replace summary notice's own display mode, on all three outcomes (FR-082)",
  },
  {
    key: 'search.inFiles.summaryNoticeTimeoutMs',
    governs: 'how long a timed replace summary notice stays on screen (FR-082)',
  },
] as const;

/**
 * The setting 043 stood next to — the section's only existing leaf, and the one a rewrite of the
 * search settings block could plausibly have dropped on the way past.
 *
 * `asYouTypeDebounceMs` is the sharp case rather than an arbitrary neighbour: it times the FIND
 * BAR's re-scan of one buffer, and `settleMs` times the file walk. The two are close enough in
 * meaning that collapsing them into one key is the obvious tidy-up, and FR-043b says they stay
 * apart (120 ms is tuned for a buffer, not for 5,000 files on disk).
 */
const NEIGHBOURS = ['search.asYouTypeDebounceMs'];

function productionSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist') walk(p);
      } else if (/\.(ts|tsx)$/.test(entry) && !CONFIG_LAYER.some((c) => p.endsWith(c))) {
        out.push({ file: p, text: readFileSync(p, 'utf8') });
      }
    }
  };
  for (const pkg of readdirSync(join(REPO_ROOT, 'packages'))) {
    const src = join(REPO_ROOT, 'packages', pkg, 'src');
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(src);
  }
  return out;
}

/**
 * Files that READ `key`. Two conditions, and the second is what the header above is about:
 *
 *   1. the leaf is read — `.trigger`, or destructured out of something
 *   2. the file also names `inFiles`, so the read is demonstrably of THIS section
 *
 * A bare mention of the identifier is NOT enough on its own, and that is the point: `draw(trigger)`
 * merely names a PARAMETER, which is precisely how #95 hid — the caller passed a different setting
 * into it.
 */
function readersOf(key: string, sources: { file: string; text: string }[]): string[] {
  const leaf = key.split('.').pop() as string;
  const propertyRead = new RegExp(`\\.\\s*${leaf}\\b`);
  const destructured = new RegExp(`\\{[^}]*\\b${leaf}\\b[^}]*\\}\\s*=`);
  const section = /\binFiles\b/;
  return sources
    .filter(({ text }) => section.test(text) && (propertyRead.test(text) || destructured.test(text)))
    .map(({ file }) => file.slice(REPO_ROOT.length).replace(/\\/g, '/'));
}

describe('043 adds no inert setting (FR-059a)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('renders a control for all eight keys', () => {
    // The premise of the tests below. A key with no descriptor is not inert — it is invisible,
    // which is a different defect and one `settings-metadata.test.ts` and the completeness gate own.
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });

  /*
   * ══ THESE TWO WERE `it.fails`, AND T111 UN-INVERTED THEM ══
   *
   * They were written at T024, at the FOUNDATION of the feature: the six keys existed, the Settings
   * editor drew six controls for them, and — by design at that point — not one line of the panel
   * that consumes them had been written. The assertion was correct and RED, and it stayed red for
   * as long as the feature was half-built.
   *
   * `it.skip` was the obvious way to keep the suite honest in the meantime, and it has one flaw
   * that mattered here: a skipped test is green forever, INCLUDING on the day the last reader
   * lands. Nothing would have made anyone come back.
   *
   * `it.fails` asserts that the assertion below THROWS. So it was green at T024 (six inert keys),
   * green through every intermediate wave (some inert keys), and it turned RED by itself the moment
   * the sixth reader was written — `search.inFiles.warnIrreversibleCommit`, read by name in
   * `packages/ui/src/main/replace-commit-service.ts` at 043 T097. The test could not be forgotten,
   * because FINISHING the feature is what broke it.
   *
   * That is what happened, and this is the un-inversion: from here on these are ordinary guards,
   * and a future change that unplugs any of them turns them red again. FR-082's two joined the list
   * the same way and were red for the same reason until their reader landed (T205).
   */
  it('has production code reading every one of them', () => {
    const sources = productionSources();
    const inert = NEW_KEYS.filter(({ key }) => readersOf(key, sources).length === 0).map(
      ({ key, governs }) => `${key} (should govern ${governs})`,
    );
    expect(
      inert,
      `These settings are rendered as live controls in Preferences but nothing outside the config ` +
        `layer reads them, so changing them does nothing: ${inert.join('; ')}`,
    ).toEqual([]);
  });

  it('names where each one is read, so the wire can be checked by eye', () => {
    // Not a stronger assertion than the one above — a REPORT. An inertness guard that only ever
    // says "fine" teaches a later reader nothing about where to look when it stops saying so.
    const sources = productionSources();
    for (const { key } of NEW_KEYS) {
      const readers = readersOf(key, sources);
      expect(readers.length, `${key} is read in: ${readers.join(', ')}`).toBeGreaterThan(0);
    }
  });
});

describe('043 made no existing setting inert (FR-059a)', () => {
  it('leaves the find bar’s own delay still being read', () => {
    /*
     * The other half, and the half a feature of this shape is likeliest to break by accident: 043
     * adds a second timing preference to the same section, and a refactor that routed both the bar
     * and the file walk through the new one would leave `asYouTypeDebounceMs` rendered, stored and
     * dead — with every new test passing.
     *
     * Matched by leaf alone, deliberately: this key predates `inFiles` and its readers have no
     * reason to name that section.
     */
    const sources = productionSources();
    const unplugged = NEIGHBOURS.filter((key) => {
      const leaf = key.split('.').pop() as string;
      const propertyRead = new RegExp(`\\.\\s*${leaf}\\b`);
      const destructured = new RegExp(`\\{[^}]*\\b${leaf}\\b[^}]*\\}\\s*=`);
      return !sources.some(({ text }) => propertyRead.test(text) || destructured.test(text));
    });
    expect(
      unplugged,
      `043 left these existing settings with no reader outside the config layer: ` +
        `${unplugged.join(', ')}. FR-059a forbids making an existing setting inert.`,
    ).toEqual([]);
  });
});
