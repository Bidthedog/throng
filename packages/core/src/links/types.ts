/**
 * The vocabulary of a file link (045, FR-003 – FR-006, FR-020 – FR-026, FR-039a).
 *
 * Everything here is data. The rules that produce it — detection, resolution, membership, the link
 * targets, the default action and the menu — are the sibling modules in this folder, and every one
 * of them is a pure function. Nothing under `core/src/links/` may name an operating system, an
 * extension or a drive mapping (FR-026, FR-039a); `links-no-os-names.test.ts` fails the build on
 * one. The OS facts arrive through `IPathForms` and `IExecutableExtensions`.
 */

/** A half-open range of offsets into the line or document text that was scanned. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** FR-004. 1-based, as every position form writes it. `column` is absent for `path:line`. */
export interface LinkPosition {
  readonly line: number;
  readonly column?: number;
}

/** A span of text that LOOKS like a path. It is not a link until it resolves (FR-006). */
export interface LinkCandidate {
  /** The path as written, with position and trailing punctuation already stripped (FR-004, FR-005). */
  readonly text: string;
  /** Offsets into the scanned line; what gets underlined. Always `text`'s own extent. */
  readonly start: number;
  readonly end: number;
  /** FR-004. Absent when the span carried none. The position is never part of `text`. */
  readonly position?: LinkPosition;
  /** How the position was written, verbatim — FR-032 copies it back in this form. */
  readonly positionText?: string;
}

/** Everything main needs to resolve a candidate, and nothing it should take on trust (FR-037). */
export interface LinkResolutionRequest {
  /** FR-003's text, or a `file:` URI from an OSC 8 target (FR-011). */
  readonly text: string;
  readonly kind: 'detectedPath' | 'fileHyperlink';
  /** FR-022 / FR-023: the editor's own folder, or the terminal's live cwd. Absent when unknown. */
  readonly baseDirectory?: string;
  /** The panel the link was seen in. Identifies the asker; carries no authority of its own. */
  readonly panelId: string;
  /**
   * FR-021 / I2. The project the panel belongs to (`Panel.originProjectId`), as an **ID**.
   *
   * The renderer names the id and **main derives the ROOT from it** — the `authoritative()`
   * precedent (`ui/src/main/editor-ipc.ts:71-83`), where a renderer's `ownerProjectId` is accepted
   * and its `ownerRoot` is replaced by main's own. The distinction is the whole confinement: an id
   * is a claim main can check against its project cache, while a root would be a claim main could
   * only take on trust, and a renderer that could name a root could name `C:\`.
   *
   * Absent for a panel with no owning project, which judges every target outside one (M3).
   */
  readonly originProjectId?: string;
  /**
   * FR-151 / I7. Set by a terminal whose flavour the platform identifies as WSL, so main skips Git
   * Bash's mount table and the platform reading. It can only NARROW what a text resolves to, never
   * widen it, which is why main takes it without verification (unlike a root, I2).
   */
  readonly wslFlavour?: true;
}

export interface ResolvedLink {
  /** FR-020: exactly one absolute location. */
  readonly path: string;
  readonly kind: 'file' | 'folder';
  /** FR-021, decided against the panel's owning project root. */
  readonly inProject: boolean;
  /** FR-039a, from `IExecutableExtensions`. A folder is never executable. */
  readonly executable: boolean;
  /** FR-030: whether an enabled preview provider accepts this file's type, and whether it is off. */
  readonly preview: 'none' | 'enabled' | 'disabled';
}

/**
 * FR-006 / FR-013: a candidate that resolves to nothing. Not a failure — a non-link.
 *
 * FR-120: `reason: 'unreachable'` when the existence check did not answer within the timeout (an
 * offline share). Still a non-link (P3); absent means "does not exist".
 */
export type LinkResolution =
  | { readonly ok: true; readonly link: ResolvedLink }
  | { readonly ok: false; readonly reason?: 'unreachable' };

/** The outcome of an action main performed on a re-resolved link (FR-037, FR-124). */
export type LinkActionOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'gone' | 'refused' | 'unreachable'; readonly path: string };
