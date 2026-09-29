import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 047 T017 — the four new settings this spec adds, none of which core itself consumes (Principle X).
 *
 * `editor.previews.openTarget`, `editor.previews.providers.markdown.gutter`,
 * `editor.previews.providers.markdown.headingJumpMs` and `editor.markdownSectionsOpen`. Every one of
 * them is a RENDERER concern — where a standalone preview opens (`open-preview.ts`, US2), the preview
 * gutter and heading-jump scroll (the Markdown body, US3/US4/US6), and a document's initial fold state
 * (`EditorCoordinator`, US3) — so this guard is EXPECTED TO STAY RED here, in core, until each reader
 * lands in the renderer or main-process code that owns it. `settings-inertness-044.test.ts` is the
 * pattern this file follows, including its three-shape `readersOf` (a property read, a destructure, or
 * a call to a helper whose name is built from the leaf); its header explains why a bare identifier
 * mention is not enough and is not repeated here.
 *
 * A comment SPELLING OUT the dotted key or the leaf name as a property access would itself count as a
 * "read" by the regexes below, so none of core's own provider/settings declarations do that — see the
 * comments beside `gutter`/`headingJumpMs` in `preview/providers/markdown.ts` and beside
 * `markdownSectionsOpen` in `config/app-settings.ts`.
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
/** Where `markdownSectionsOpen`'s reader is expected to talk about — fold state, not previews. */
const FOLD_SECTION = /\b(?:fold|markdownSectionsOpen)\b/;

/** The four keys 047 adds, with the behaviour each is supposed to move. */
const NEW_KEYS = [
  {
    key: 'editor.previews.openTarget',
    governs:
      'where a STANDALONE preview opens — reuse the last active preview panel in the visible tab, or always open a new one (FR-015a)',
    section: PREVIEW_SECTION,
    // OVERRIDE: `openTarget` alone collides with the PRE-EXISTING, unrelated `editor.openTarget`
    // (023, the editor tab-reuse target) — a bare-leaf match would credit every one of that
    // setting's many readers to this one. `previews.openTarget` (however it is spelled: `.`, `?.`,
    // destructured off `previews`) is the shape that actually reads THIS key.
    leafPattern: /previews\??\.\s*openTarget\b|\{[^}]*\bopenTarget\b[^}]*\}\s*=\s*(?:\w+\.)?previews\b/,
  },
  {
    key: 'editor.previews.providers.markdown.gutter',
    governs: "whether a Markdown preview draws its fold gutter, with each heading's fold arrow (FR-032b)",
    section: PREVIEW_SECTION,
    leafPattern: undefined,
  },
  {
    key: 'editor.previews.providers.markdown.headingJumpMs',
    governs: 'how long a jump to a heading in a Markdown preview takes to scroll into view (FR-042d)',
    section: PREVIEW_SECTION,
    leafPattern: undefined,
  },
  {
    key: 'editor.markdownSectionsOpen',
    governs:
      "a Markdown document's initial fold state — expanded or collapsed — in the editor and a freshly opened preview alike (FR-039)",
    section: FOLD_SECTION,
    leafPattern: undefined,
  },
] as const satisfies readonly { key: string; governs: string; section: RegExp; leafPattern: RegExp | undefined }[];

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
 * Files that READ `key`, under `section` (see header for why the check is a whole word rather than a
 * single literal). Three read shapes: a property read (`.gutter`), a destructure, or a call to a
 * helper whose name is BUILT from the leaf. A bare mention of the identifier is still not enough on
 * its own — `draw(enabled)` merely names a parameter, exactly how #95 hid.
 *
 * `leafPattern`, when given, REPLACES the bare-leaf property/destructure pair — for a leaf name that
 * collides with an unrelated, already-live setting (see `openTarget`'s entry above), the bare leaf
 * alone cannot tell the two apart.
 */
function readersOf(
  key: string,
  section: RegExp,
  sources: { file: string; text: string }[],
  leafPattern?: RegExp,
): string[] {
  const leaf = key.split('.').pop() as string;
  const propertyRead = leafPattern ?? new RegExp(`\\.\\s*${leaf}\\b`);
  const destructured = leafPattern ?? new RegExp(`\\{[^}]*\\b${leaf}\\b[^}]*\\}\\s*=`);
  const helperCall = new RegExp(`\\b${leaf}\\w*\\(`);
  return sources
    .filter(
      ({ text }) =>
        section.test(text) && (propertyRead.test(text) || destructured.test(text) || helperCall.test(text)),
    )
    .map(({ file }) => file.slice(REPO_ROOT.length).replace(/\\/g, '/'));
}

describe('047 adds no inert setting (T017)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('renders a control for all four keys', () => {
    // The premise of the tests below. A key with no descriptor is not inert — it is invisible, which is
    // a different defect and one `settings-metadata.test.ts` and the completeness gate own.
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });

  /*
   * EXPECTED RED. Nothing in core consumes these four keys — each one's reader belongs to the
   * renderer or main-process agent building the surface it governs (US2's open-preview.ts, US3/US4's
   * Markdown body and EditorCoordinator, US6's heading-jump tween). This test names exactly what is
   * still missing, and turns green on its own once each reader lands — it is not meant to be made to
   * pass by adding a reader here.
   */
  it('has production code reading every one of them', () => {
    const sources = productionSources();
    const inert = NEW_KEYS.filter(
      ({ key, section, leafPattern }) => readersOf(key, section, sources, leafPattern).length === 0,
    ).map(
      ({ key, governs }) => `${key} (should govern ${governs})`,
    );
    expect(
      inert,
      `These settings are rendered as live controls in Preferences but nothing outside the config ` +
        `layer reads them, so changing them does nothing: ${inert.join('; ')}`,
    ).toEqual([]);
  });
});
