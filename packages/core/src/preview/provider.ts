/**
 * The core half of a preview provider (044, FR-070 – FR-073, data-model §1–§2).
 *
 * A provider has two halves because Principle II keeps the DOM out of core — the split the language
 * registry already makes (`editor/languages.ts` declares WHAT a language is, the renderer's loaders
 * declare HOW it is highlighted). This half is pure data that settings, menus, persistence and main
 * can all read without a DOM; the renderer's `PreviewProviderView` is the other half.
 *
 * The registry INTERFACE lives here rather than beside its implementation so that settings and every
 * surface can import the type without pulling in the shipped providers.
 *
 * Types only. No OS, no DOM.
 */
import type { IconKey } from '../icons/icon-keys.js';
import type { DefaultOpenAction } from './settings-types.js';

/**
 * `text` providers are handed text snapshots and can be parented to an editor; `binary` providers
 * are always standalone and read their source through the confined protocol (FR-073).
 */
export type PreviewProviderKind = 'text' | 'binary';

/** One setting a provider declares of its own (FR-071), rendered beside its enabled toggle. */
export interface ProviderSettingDeclaration {
  /** Leaf name under `editor.previews.providers.<id>`. Never `enabled` or `defaultOpenAction`. */
  leaf: string;
  label: string;
  description: string;
  /** `list` (074 FR-072a): an editable list of text entries, stored whole; an explicit empty list is kept. */
  control: 'toggle' | 'select' | 'number' | 'list';
  default: boolean | string | number | readonly string[];
  /** `list` only (074 FR-072c): the rule one entry must satisfy — see {@link FieldDescriptor.validateItem}. */
  validateItem?: (item: string) => string | null;
  allowedValues?: readonly string[];
  optionLabels?: Readonly<Record<string, string>>;
  min?: number;
  max?: number;
  step?: number;
}

export interface PreviewProviderDescriptor {
  /** Stable; appears in settings keys. Never renamed once shipped. `/^[a-z][a-zA-Z0-9]*$/`. */
  id: string;
  displayName: string;
  /** Dot-prefixed, lower-case, e.g. `['.md', '.markdown']`. Matched case-insensitively. */
  extensions: readonly string[];
  kind: PreviewProviderKind;
  settings?: readonly ProviderSettingDeclaration[];
  /** Names one of `settings` (a toggle) that permits https images. Read by main's request filter. */
  remoteImagesSetting?: string;
  /** Binary providers only: the MIME types the source route may serve. */
  sourceMimeTypes?: readonly string[];
  /**
   * The SHIPPED "Open <files> in" value (074 FR-016). Absent ships `'editor'` for a text provider (044 FR-050)
   * and `'preview'` for a binary one, which offers no editor. The user's stored choice always wins over it;
   * this is only what a fresh or unset config reads.
   */
  defaultOpenAction?: DefaultOpenAction;
  /**
   * 074 FR-017 — the plural the "Open <files> in" label names: `images`, `PDFs`. Absent reads
   * `"<displayName> files"`.
   */
  filesNoun?: string;
  /**
   * 074 FR-016 — the label of the `preview` option, where the preview is more than a viewer (spec 073's CSV:
   * "Throng Preview Editor"). Absent reads "Throng Preview".
   */
  previewOptionLabel?: string;
  /**
   * 074 FR-012 — names one of `settings` (a number, in bytes) that caps what this provider's preview reads: a file
   * over it is not read, and the notice names its size and the limit. Absent: `editor.maxOpenFileBytes` caps it.
   */
  maxFileBytesSetting?: string;
  /**
   * 074 FR-072 — MIME types the asset route may serve to THIS provider's runs beyond the image allowlist (an HTML
   * page's stylesheets). No other provider's runs see them.
   */
  assetMimeTypes?: readonly string[];
  /**
   * 074 FR-084 — whether the preview can reveal a Find in Files match. Absent reads `true`. `false` (an HTML page in
   * an isolated frame) makes a result open an editor at the match whatever Open <files> in says.
   */
  revealsMatches?: boolean;
  /**
   * Wording for the generated enabled toggle, when `"<displayName>: Enabled"` and its generic description
   * would mislead — e.g. Mermaid's, which governs standalone files only, not diagrams inside Markdown.
   * The label is still prefixed with `displayName`.
   */
  enabledLabel?: string;
  enabledDescription?: string;
  /**
   * Text providers only: whether the preview is a FLOWING DOCUMENT a reader scrolls through. Absent reads
   * `true`. A provider that draws one picture (Mermaid) sets `false`, and then Select All, Go to Heading and
   * Synchronise Scrolling are absent from its previews and its source's editors — there is nothing to select
   * as text, no heading to go to, and no scroll position to keep in step (manual test change request,
   * 2026-10-12). Opening the preview and going to the editor are unaffected.
   */
  flowingDocument?: boolean;
  /**
   * 074 FR-062b (2026-11-19) — what the preview's Go to command (`preview.goToHeading`, Ctrl+G) goes to: `'page'` for
   * a paged document (PDF), whose body offers Go to Page. Absent: a flowing document's headings, where it has any.
   */
  goTo?: 'page';
  /**
   * 074 FR-103 — the themeable icon that names this type's preview: its panel header, its row in a tab's list
   * of panels, the editor's status-bar preview button and every menu row that opens one. Absent draws the
   * generic `preview` icon ({@link previewIconOf}).
   */
  previewIcon?: IconKey;
}

/** 074 FR-103 — the icon a preview of `provider` is drawn with: its own, else the generic `preview`. */
export function previewIconOf(provider: Pick<PreviewProviderDescriptor, 'previewIcon'> | undefined): IconKey {
  return provider?.previewIcon ?? 'preview';
}

/** Whether `provider` previews a flowing document (`flowingDocument`, absent = `true`); `false` for none. */
export function isFlowingDocument(provider: PreviewProviderDescriptor | undefined): boolean {
  return provider !== undefined && provider.kind === 'text' && provider.flowingDocument !== false;
}

/**
 * 074 FR-062b — what a preview's Go to command does: `'page'` (Go to Page…), `'heading'` (Go to Heading…), or `null`
 * where there is nothing to go to (a single picture). Every menu and the chord read this one answer.
 */
export function previewGoToKind(provider: PreviewProviderDescriptor | undefined): 'page' | 'heading' | null {
  if (provider?.goTo === 'page') return 'page';
  return isFlowingDocument(provider) ? 'heading' : null;
}

/** Every registered provider, looked up by id or by a file's extension. */
export interface PreviewProviderRegistry {
  list(): readonly PreviewProviderDescriptor[];
  get(id: string): PreviewProviderDescriptor | undefined;
  /** By extension only — a language override does not make a file previewable (spec Assumptions). */
  forPath(path: string): PreviewProviderDescriptor | undefined;
}
