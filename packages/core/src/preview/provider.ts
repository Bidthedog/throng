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
  control: 'toggle' | 'select' | 'number';
  default: boolean | string | number;
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
}

/** Every registered provider, looked up by id or by a file's extension. */
export interface PreviewProviderRegistry {
  list(): readonly PreviewProviderDescriptor[];
  get(id: string): PreviewProviderDescriptor | undefined;
  /** By extension only — a language override does not make a file previewable (spec Assumptions). */
  forPath(path: string): PreviewProviderDescriptor | undefined;
}
