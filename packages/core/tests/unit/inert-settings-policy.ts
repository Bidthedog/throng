/**
 * 071 — the inert-settings guard's policy: what counts as the configuration layer, and which settings may go
 * unread. Both lists live here, in one file, so that growing either one is a reviewed diff (FR-007, FR-011).
 */

/**
 * FR-007: code that handles settings GENERICALLY — by key or by path, not acting on any one value. A mention of a
 * setting in one of these files proves the setting exists, never that anything acts on it (019 C16).
 *
 * Code that loads, stores or watches the settings file AND acts on one value is that value's reader, so it is
 * not here: `ui/src/main/config-watcher.ts` loads the active theme file named by `appearance.theme`, and that is
 * the setting taking effect (research R5). Neither are `core/src/config/preview-settings.ts` and
 * `starting-folder.ts`, which interpret one setting for the code that uses it.
 *
 * Paths are repository-relative prefixes with `/` separators.
 */
export const CONFIGURATION_LAYER: readonly { prefix: string; why: string }[] = [
  { prefix: 'packages/core/src/config/app-settings.ts', why: 'declares, parses and defaults every key' },
  { prefix: 'packages/core/src/config/settings-metadata.ts', why: 'the Settings descriptor registry' },
  { prefix: 'packages/core/src/config/metadata.ts', why: 'the descriptor types and helpers every registry shares' },
  { prefix: 'packages/core/src/config/shipped-defaults.ts', why: 'the shipped-defaults generator walks every key' },
  { prefix: 'packages/core/src/config/settings-read.ts', why: 'the guarded parse applied to every settings read' },
  { prefix: 'packages/core/src/config/bounds-guard.ts', why: 'clamps every declared bound by path' },
  { prefix: 'packages/core/src/config/settings-validity.ts', why: 'validates every descriptor by path' },
  { prefix: 'packages/core/src/config/settings-search.ts', why: 'searches every descriptor for the Preferences filter' },
  { prefix: 'packages/core/src/config/overridden.ts', why: 'compares every key against its default' },
  { prefix: 'packages/core/src/config/config-patch.ts', why: 'writes any key by path' },
  {
    prefix: 'packages/ui/src/renderer/preferences/',
    why:
      'the Preferences window renders a control for every descriptor; excluding the whole window can only make a ' +
      'setting look unread, never hide one (research R5)',
  },
];

/**
 * FR-008: a file that may hold a reader — package source, not a declaration file, and not a test helper. The
 * `src/testing/` folders are test helpers shipped for other packages' tests (`@throng/core/testing`): fakes and
 * contract suites that read settings to exercise them, which proves nothing about the app.
 */
export function isProductionSource(rel: string): boolean {
  return /^packages\/[^/]+\/src\//.test(rel) && !/^packages\/[^/]+\/src\/testing\//.test(rel) && !rel.endsWith('.d.ts');
}

/**
 * FR-011: settings meant to be read only by the configuration layer, each with the reason. Ships empty: the first
 * full run found no unread setting (spec, First-run findings).
 */
export const INERT_ALLOWLIST: readonly { key: string; reason: string }[] = [];

/** Shorter than this, a reason cannot say why a setting governs nothing outside the configuration layer. */
const MIN_REASON_LENGTH = 20;
const PLACEHOLDER = /^(todo|tbd|-+|n\/?a|none|\?+)$/i;

/** FR-011: what is wrong with an allowlist, against a scan's report. Empty when clean. */
export function allowlistProblems(
  allowlist: readonly { key: string; reason: string }[],
  report: readonly { key: string; readers: readonly string[] }[],
): string[] {
  const byKey = new Map(report.map((r) => [r.key, r.readers]));
  const problems: string[] = [];
  for (const { key, reason } of allowlist) {
    const readers = byKey.get(key);
    const trimmed = reason.trim();
    if (readers === undefined) {
      problems.push(`${key} is allowlisted but is no longer a Settings descriptor; remove the entry.`);
    } else if (readers.length > 0) {
      problems.push(`${key} is allowlisted but is now read by ${readers.join(', ')}; remove the entry.`);
    } else if (trimmed.length < MIN_REASON_LENGTH || PLACEHOLDER.test(trimmed)) {
      problems.push(`${key} is allowlisted without a reason; say why only the configuration layer reads it.`);
    }
  }
  return problems;
}
