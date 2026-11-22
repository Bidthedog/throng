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
import type { DisplayUnit, StoredUnit } from '../config/metadata.js';

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
  /** 077 — as on {@link FieldDescriptor}: the enforced bounds, the stored unit and the unit it is shown in. */
  hardMin?: number;
  hardMax?: number;
  storedUnit?: StoredUnit;
  display?: DisplayUnit;
  unitLabel?: string;
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
   * 074 FR-012, 073 FR-061, 077 FR-018 — names one of `settings` (a number, in bytes) that caps what this provider's
   * preview reads: a file over it is not read, and the notice names its size and the limit. Absent:
   * `editor.maxOpenFileBytes` caps it. The one size-cap field every provider uses.
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
   * 073 FR-033c — text providers only: whether the preview scrolls in step with its linked text editor (the Synchronise
   * Scrolling toggle and menu rows). Absent reads `isFlowingDocument`, as before: Markdown and the other flowing
   * documents do, a one-picture provider does not. A provider sets it `true` to take part in scroll sync WITHOUT being a
   * flowing document — the CSV grid has rows, not headings or a text selection, so Go to Heading stays absent and Select
   * All stays the grid's own — or `false` to opt out.
   */
  scrollSync?: boolean;
  /** 073 FR-036b — the provider's editable grid has a cell dialog, with a per-panel toggle on its status bar. */
  cellDialog?: boolean;
  /** 073 FR-013 — the provider's grid can wrap its cells, with a per-panel toggle on its status bar and in its panel menu. */
  wrapToggle?: boolean;
  /** 073 FR-039a — the provider's grid can lock its first row and column, with per-panel toggles on its status bar and in its panel menu. */
  lockToggles?: boolean;
  /** 073 FR-050a — the provider's grid is read-only (a workbook): its status bar carries a permanent Read-only marker. */
  readOnly?: boolean;
  /**
   * 073 FR-030 — text providers only: the preview EDITS its document (the CSV Preview Editor). Main shows
   * its edits at once rather than after the update delay, the chrome lets its body own paste, cut and
   * drop, and its run may open the file as a document of its own on the first edit (research R1).
   * Supersedes 044 FR-020/FR-025 for such a provider only.
   */
  editable?: boolean;
  /**
   * 074 FR-062b (2026-11-19) — what the preview's Go to command (`preview.goToHeading`, Ctrl+G) goes to: `'page'` for
   * a paged document (PDF), whose body offers Go to Page; `'row'` for a grid (CSV, Spreadsheet — 073 FR-043a), whose
   * body offers Go to Row. Absent: a flowing document's headings, where it has any.
   */
  goTo?: 'page' | 'row';
  /**
   * 074 FR-103 — the themeable icon that names this type's preview: its panel header, its row in a tab's list
   * of panels, the editor's status-bar preview button and every menu row that opens one. Absent draws the
   * generic `preview` icon ({@link previewIconOf}).
   */
  previewIcon?: IconKey;
  /**
   * 075 FR-060 – FR-062 — whether, and how, this provider's previews print. Absent: they cannot, and Print… is
   * shown disabled with the reason. `document`: the view hands over a flowing document throng paginates.
   * `pages`: the view hands over ready-made PDF pages. Declaring it obliges the renderer view to supply
   * `printable` (`provider-views.test.ts`).
   */
  print?: PrintCapability;
}

/** 074 FR-103 — the icon a preview of `provider` is drawn with: its own, else the generic `preview`. */
export function previewIconOf(provider: Pick<PreviewProviderDescriptor, 'previewIcon'> | undefined): IconKey {
  return provider?.previewIcon ?? 'preview';
}

/** 075 FR-060 — how a provider's previews print. */
export type PrintCapability = 'document' | 'pages';

/** Whether `provider`'s previews can print (075 FR-062). */
export function canPrint(provider: PreviewProviderDescriptor | undefined): boolean {
  return provider?.print !== undefined;
}

/** Whether `provider` previews a flowing document (`flowingDocument`, absent = `true`); `false` for none. */
export function isFlowingDocument(provider: PreviewProviderDescriptor | undefined): boolean {
  return provider !== undefined && provider.kind === 'text' && provider.flowingDocument !== false;
}

/**
 * Whether `provider`'s preview scrolls in step with its linked editor (`scrollSync`, absent = `isFlowingDocument`).
 * Decides where Synchronise Scrolling is drawn; a provider that does not draw text has none.
 */
export function supportsScrollSync(provider: PreviewProviderDescriptor | undefined): boolean {
  if (provider === undefined || provider.kind !== 'text') return false;
  return provider.scrollSync ?? isFlowingDocument(provider);
}

/**
 * 074 FR-062b — what a preview's Go to command does: `'page'` (Go to Page…), `'row'` (Go to Row…, 073 FR-043a),
 * `'heading'` (Go to Heading…), or `null` where there is nothing to go to (a single picture). Every menu and the
 * chord read this one answer.
 */
/** Where a preview's Go to command goes (`previewGoToKind`). */
export type PreviewGoToKind = 'page' | 'row' | 'heading' | null;

export function previewGoToKind(provider: PreviewProviderDescriptor | undefined): PreviewGoToKind {
  if (provider?.goTo !== undefined) return provider.goTo;
  return isFlowingDocument(provider) ? 'heading' : null;
}

/** Every registered provider, looked up by id or by a file's extension. */
export interface PreviewProviderRegistry {
  list(): readonly PreviewProviderDescriptor[];
  get(id: string): PreviewProviderDescriptor | undefined;
  /** By extension only — a language override does not make a file previewable (spec Assumptions). */
  forPath(path: string): PreviewProviderDescriptor | undefined;
}
