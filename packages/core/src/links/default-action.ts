import { linkTargetStates, type LinkTarget } from './targets.js';
import type { ResolvedLink } from './types.js';

/**
 * 045 FR-039, FR-050 – FR-055 — what Ctrl+click, the Open Link chord and the plain Open Link item
 * do for THIS link (`data-model.md` §4). One function, so all three cannot disagree (FR-054).
 *
 * ══ THE ORDER OF THE CLAUSES IS THE REQUIREMENT ══
 *
 * 1. **FR-039, first, overriding everything.** An executable goes to the file manager, whatever the
 *    setting says and wherever the fallback would otherwise land. It is first rather than folded
 *    into the fallback because the setting can NAME `osDefaultProgram`, and a clause that only
 *    edited the fallback order would let that name through — which is a click on a downloaded
 *    `setup.exe` running it. SC-010 iterates every extension the platform calls executable and
 *    asserts none of them runs by any of the three routes.
 * 2. `'throng'` means "whatever throng would do with this file", which is the preview only when the
 *    file's own default open action is Preview (FR-051) AND the link carries no position (FR-052) —
 *    a preview cannot reveal a line and column, which is the same reason 044 FR-054 gives for
 *    sending Find in Files results to an editor.
 * 3. A named value performs itself, when the link offers that target.
 * 4. Otherwise FR-053's fallback, in ITS order: preview, editor, OS default program, OS file
 *    manager. A `disabled` preview counts as not offered — it is drawn so the user can see the way
 *    to enable it, not so a click can silently land on it.
 *
 * `previewIsDefault` is `defaultOpenActionFor(...) === 'preview'`, computed by the caller. That
 * keeps this file free of the preview registry, which is 044's own guard against the renderer
 * importing a provider.
 */
export type DefaultLinkAction = 'throng' | 'editor' | 'preview' | 'osExplorer' | 'osDefaultProgram';

/** FR-050's values, in FR-050's order. The shipped value is the first. */
export const DEFAULT_LINK_ACTIONS: readonly DefaultLinkAction[] = [
  'throng',
  'editor',
  'preview',
  'osExplorer',
  'osDefaultProgram',
];

/** FR-053's order, which is deliberately NOT FR-030's — it runs from the most specific outwards. */
const FALLBACK_ORDER: readonly LinkTarget[] = ['preview', 'editor', 'osDefaultProgram', 'osExplorer'];

export function resolveDefaultLinkAction(args: {
  readonly setting: DefaultLinkAction;
  readonly link: ResolvedLink;
  readonly hasPosition: boolean;
  readonly previewIsDefault: boolean;
}): LinkTarget {
  const { setting, link, hasPosition, previewIsDefault } = args;

  // 1 — FR-039. Before anything reads the setting.
  if (link.executable) return 'osExplorer';

  const states = linkTargetStates(link);

  // 2 — FR-051 / FR-052. `'throng'` names one of throng's own two destinations; whether the link
  // actually offers it is clause 3's question, so an out-of-project file falls through to 4.
  const named: LinkTarget =
    setting === 'throng'
      ? previewIsDefault && !hasPosition && states.preview === 'offered'
        ? 'preview'
        : 'editor'
      : setting;

  // 3
  if (states[named] === 'offered') return named;

  // 4 — FR-053. `osExplorer` is always offered, so this always answers.
  return FALLBACK_ORDER.find((t) => states[t] === 'offered') ?? 'osExplorer';
}
