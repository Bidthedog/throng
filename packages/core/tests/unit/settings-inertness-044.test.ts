import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 044 T167 — every one of the nine new preview/navigation preferences does something.
 *
 * `editor.previews.updateDelayMs`, `.maxWaitMs`, `.copyFormat`, `.syncScroll`,
 * `.providers.markdown.enabled`, `.providers.markdown.defaultOpenAction`,
 * `.providers.markdown.loadRemoteImages`, `.providers.markdown.showFrontMatter`, and
 * `editor.navigation.historySize`. Seven shipped first; `syncScroll` (FR-114) and `showFrontMatter`
 * (FR-117) joined in the 2026-09-15 iteration (T186), and this guard stays red for each until its
 * reader lands — `preview-panel.tsx` (T202) and `markdown-body.tsx` (T205). `settings-inertness-043.test.ts` is the pattern this file follows;
 * its header explains what an inert setting is and why this is a unit test rather than a component one.
 * That reasoning is not repeated here — only what differs.
 *
 * ══ THE GENERATED-KEY DIFFERENCE FROM 043 ══
 *
 * 043's eight keys are each read by name, once, at one call site. Several of 044's nine are NOT: the
 * four `providers.markdown.*` leaves are declared once by `providers/markdown.ts` but consumed
 * through code that is deliberately generic over EVERY provider (FR-070/FR-071) — `enabledProviderFor`,
 * `previewAffordance` and `defaultOpenActionFor` (`preview/registry.ts`, `config/preview-settings.ts`)
 * take a provider id and never write `markdown` themselves. A reader-by-literal-key match, the way 043's
 * `readersOf` works, would report them inert forever, regardless of whether the wiring is real —
 * that would be reporting the ABSENCE of something these keys are designed never to have.
 *
 * So a reader here is one of three shapes, not 043's two:
 *
 *   1. a property read of the leaf (`.loadRemoteImages`), as 043 has;
 *   2. the leaf destructured out of something, as 043 has;
 *   3. a CALL to a helper whose name is built FROM the leaf (`defaultOpenActionFor(`,
 *      `enabledProviderFor(`) — the generic-over-providers shape above. The leaf still opens the
 *      identifier, so this is the same kind of evidence a property read is: proof some caller outside
 *      the config layer asked for this value's effect, not proof of what it did with it.
 *
 * The section check does the same job 043's `inFiles` check does — ruling out a same-named leaf that
 * has nothing to do with this feature (`enabled` is one of the most overloaded leaves in the settings
 * model) — but as one word rather than 043's single literal, because these nine keys span two
 * structural levels: `editor.previews` directly, and `editor.previews.providers.<id>` beneath it, and
 * production code names the level it is at ("provider"/"providers" for the generic per-provider
 * helpers, "preview"/"previews" everywhere else in the package) rather than always naming both.
 * `editor.navigation.historySize` sits outside `previews` altogether — FR-108 is deliberately in the
 * navigation block because it governs editors too (`app-settings.ts`) — so it gets its own marker.
 *
 * `config/preview-settings.ts` joins 043's `CONFIG_LAYER`: like `app-settings.ts`, it declares the
 * shipped defaults, the descriptors and the tolerant parse for every one of these keys BY CONSTRUCTION,
 * so a match there is worth nothing — it is the generator `settings-metadata.ts` and `app-settings.ts`
 * call, not a consumer. Its own derived-value helpers (`effectiveMaxWaitMs`, `defaultOpenActionFor`,
 * `remoteImagesPermitted`) are real consumers, but each is also called from a file outside this list
 * (`preview-service.ts`, `open-router.ts`), which is where the reader is credited instead.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const CONFIG_LAYER = [
  'app-settings.ts',
  'settings-metadata.ts',
  'metadata.ts',
  'shipped-defaults.ts',
  'preview-settings.ts',
];

/** `editor.previews` and everything under it, including the per-provider leaves. */
const PREVIEW_SECTION = /\b(?:previews?|providers?)\b/;
/** `editor.navigation`, which `historySize` sits in rather than beside `previews` (see header). */
const NAVIGATION_SECTION = /\bnavigation\b/;

/** The nine keys 044 adds, with the behaviour each is supposed to move. */
const NEW_KEYS = [
  {
    key: 'editor.previews.updateDelayMs',
    governs: 'the trailing debounce before a parented preview shows an edit (FR-060)',
    section: PREVIEW_SECTION,
  },
  {
    key: 'editor.previews.maxWaitMs',
    governs:
      'the longest a parented preview goes without showing a change while typing continues (FR-060a)',
    section: PREVIEW_SECTION,
  },
  {
    key: 'editor.previews.copyFormat',
    governs: 'what Copy puts on the clipboard from a preview: rich text or plain (FR-035b)',
    section: PREVIEW_SECTION,
  },
  {
    key: 'editor.previews.providers.markdown.enabled',
    governs: 'whether Markdown previews are offered at all (FR-001, FR-062, FR-065)',
    section: PREVIEW_SECTION,
  },
  {
    key: 'editor.previews.providers.markdown.defaultOpenAction',
    governs:
      'whether opening a Markdown file from File Explorer or Quick Open opens an editor or its preview (FR-050 – FR-052)',
    section: PREVIEW_SECTION,
  },
  {
    key: 'editor.previews.providers.markdown.loadRemoteImages',
    governs: 'whether a Markdown preview requests the https images it links, or shows their alt text (FR-092)',
    section: PREVIEW_SECTION,
  },
  {
    key: 'editor.previews.syncScroll',
    governs: "whether a preview beside its editor follows the editor's scroll position (FR-113, FR-114)",
    section: PREVIEW_SECTION,
  },
  {
    key: 'editor.previews.providers.markdown.showFrontMatter',
    governs: "whether a Markdown preview shows the document's front matter block (FR-117)",
    section: PREVIEW_SECTION,
  },
  {
    key: 'editor.navigation.historySize',
    governs: "how many files each editor and preview panel's Back/Forward history holds (FR-108)",
    section: NAVIGATION_SECTION,
  },
] as const;

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
 * Files that READ `key`, under `section` (see header for why the check is a whole word rather than
 * 043's single literal). Three read shapes:
 *
 *   1. the leaf is read as a property — `.loadRemoteImages`
 *   2. the leaf is destructured out of something
 *   3. a helper whose name is BUILT from the leaf is called — `defaultOpenActionFor(`,
 *      `enabledProviderFor(` — the generic-over-providers shape 043 has no equivalent of.
 *
 * A bare mention of the identifier is still not enough on its own — `draw(enabled)` merely names a
 * parameter, exactly how #95 hid.
 */
function readersOf(key: string, section: RegExp, sources: { file: string; text: string }[]): string[] {
  const leaf = key.split('.').pop() as string;
  const propertyRead = new RegExp(`\\.\\s*${leaf}\\b`);
  const destructured = new RegExp(`\\{[^}]*\\b${leaf}\\b[^}]*\\}\\s*=`);
  const helperCall = new RegExp(`\\b${leaf}\\w*\\(`);
  return sources
    .filter(
      ({ text }) =>
        section.test(text) && (propertyRead.test(text) || destructured.test(text) || helperCall.test(text)),
    )
    .map(({ file }) => file.slice(REPO_ROOT.length).replace(/\\/g, '/'));
}

describe('044 adds no inert setting (T167)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('renders a control for all nine keys', () => {
    // The premise of the tests below. A key with no descriptor is not inert — it is invisible, which is
    // a different defect and one `settings-metadata.test.ts` and the completeness gate own.
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });

  it('has production code reading every one of them', () => {
    const sources = productionSources();
    const inert = NEW_KEYS.filter(({ key, section }) => readersOf(key, section, sources).length === 0).map(
      ({ key, governs }) => `${key} (should govern ${governs})`,
    );
    expect(
      inert,
      `These settings are rendered as live controls in Preferences but nothing outside the config ` +
        `layer reads them, so changing them does nothing: ${inert.join('; ')}`,
    ).toEqual([]);
  });

  it('names where each one is read, so the wire can be checked by eye', () => {
    // Not a stronger assertion than the one above — a REPORT. An inertness guard that only ever says
    // "fine" teaches a later reader nothing about where to look when it stops saying so.
    const sources = productionSources();
    for (const { key, section } of NEW_KEYS) {
      const readers = readersOf(key, section, sources);
      expect(readers.length, `${key} is read in: ${readers.join(', ')}`).toBeGreaterThan(0);
    }
  });
});
