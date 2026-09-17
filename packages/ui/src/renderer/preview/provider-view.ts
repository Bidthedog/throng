/**
 * The RENDERER half of a preview provider (044, FR-070, data-model §13,
 * contracts/preview-provider-seam.md §1).
 *
 * The core half (`PreviewProviderDescriptor`) says what a provider IS — its id, extensions, kind and
 * settings. This half says how its content is DRAWN, which needs React and a DOM and therefore cannot
 * live in core (Principle II). The two meet by `id`: `preview/providers/index.ts` registers one view per
 * shipped descriptor, and `provider-views.test.ts` holds the two key sets equal.
 *
 * The panel chrome — header, status bar, notices, menus, Back/Forward, zoom, copy routing, keyboard
 * scope — belongs to `preview-panel.tsx` and is identical for every provider. A body reaches nothing
 * but its props (FR-074): it is handed content, never a path to read, and it asks the chrome to follow
 * a link or raise a notice rather than doing either itself.
 */
import type { ComponentType } from 'react';
import type { PreviewContent, PreviewLink, PreviewNotice, ProviderSettings } from '@throng/core';

export interface PreviewBodyProps {
  panelId: string;
  content: PreviewContent;
  filePath: string;
  projectRoot: string;
  providerSettings: ProviderSettings;
  /**
   * FR-107 — from the last `PreviewUpdate.viewState` (attach, history navigate); `undefined` otherwise. On a
   * history step it is always present, and `null` names an entry with no saved place (044 FR-121e).
   */
  initialViewState: unknown;
  /**
   * 044 T177 (FR-024 with FR-013c) — main's count of this run's NAVIGATIONS, from `PreviewUpdate`. A
   * `filePath` that changes while this number stands still is a re-point — the same document under a new
   * path, after an in-app rename or move or a Save As — and the body MUST keep the reader's place, as it
   * does for any other update. A changed number is a link followed or a history step: the new file is
   * shown from its top. `undefined` (no update has carried one) reads as "every file change is a
   * navigation", which is what a body did before the count existed.
   */
  navigationSeq?: number;
  /**
   * FR-113 — the parent editor's top visible source line (0-based, the numbering `data-source-line` uses)
   * while scroll sync applies: the setting is on, the preview is parented, its provider is `text`, and a view
   * of that editor is mounted in this window. `null` or `undefined` otherwise. Optional: a body that ignores
   * it still conforms (FR-070) — it simply does not follow.
   *
   * A body that honours it brings the source line to the top when the value CHANGES, or once its file is
   * drawn if the value came first — and only then. A live update keeps the reader's captured place (FR-024),
   * which is wherever the last sync or the reader's own later scroll left it, so a reader who scrolls the
   * preview by hand is not snapped back on the next keystroke. Nothing in a preview writes this value back.
   *
   * 044 FR-121g — a body that honours it skips a line that falls in the block already at its top: the two
   * mappings are block-granular, and a line inside the shown block is already there.
   */
  syncLine?: number | null;
  /**
   * 044 FR-121c, FR-121g — `syncLine` is an ECHO: the place the editor went to follow this preview (or as
   * far as it could get). The body records it as where the editor is, and never scrolls to it. Optional:
   * absent reads as `false`.
   */
  syncEcho?: boolean;
  /**
   * 044 FR-121f — the source line of the block now at the top, for any scroll this body did NOT make to
   * follow `syncLine`: the reader's wheel, scrollbar or keyboard, a heading jump, a live update's kept place,
   * a history place restored, a navigation's start position. Reported at most once a frame, and only when
   * that block differs from the block `syncLine` falls in (FR-121g). The chrome decides whether an editor is
   * driven by it (FR-121a). Optional: a body that never calls it still conforms, and drives no editor.
   *
   * An answer of `false` means the chrome could not act on it yet — the body compared its block with an
   * editor line that is no longer the latest — and the body reports again once `syncLine` next changes.
   */
  onTopLineChange?(line: number): boolean | void;
  /**
   * 044 FR-121h — the body hands the chrome a way to read the source line of the block at its top now, for
   * placing a newly adopted editor where the preview already is. The reader answers `null` before anything
   * is drawn. Optional, like `onTopLineChange`.
   */
  onTopLineRead?(read: () => number | null): void;
  /**
   * 044 FR-121e, FR-121h (data-model §15.2) — how the body treats `initialViewState`:
   *
   * - `restore` (absent): FR-107 as shipped — a saved place is restored.
   * - `editorLineIfTop`: the place is a HISTORY step's (`null` = an entry with no saved place). A step across
   *   files onto the top lands on `syncLine`; any other step onto the top lands at the top; any other place is
   *   restored (`placeOnStep`).
   * - `editorLine`: the place is an opening's or a restore's (the attach answer). With `syncLine` known, the
   *   editor's line wins over it and the place is not restored; without, it is restored.
   */
  placePolicy?: 'restore' | 'editorLineIfTop' | 'editorLine';
  /** The body hands the panel a way to read its view state when the panel leaves an entry (FR-107). */
  onViewStateCapture(capture: () => unknown): void;
  /** FR-090, FR-091 — the chrome decides what following means. */
  onFollow(link: PreviewLink): void;
  /** FR-090e/f — a notice only the renderer can know about (a heading the rendered body lacks). */
  onNotice(notice: PreviewNotice): void;
  /**
   * FR-095, FR-096d — the reader asked for a link's menu (right-click, Shift+F10 or the menu key on a
   * focused link) with nothing selected. The chrome builds and opens the menu; `point` is where, in
   * client coordinates. Optional: a body that draws no links never calls it.
   */
  onLinkMenu?(link: PreviewLink, point: { x: number; y: number }): void;
  /**
   * FR-118 — the followable link under the pointer (`'hover'`) or holding keyboard focus (`'focus'`) now names
   * `target`, its display target as the link's tooltip names it; `null` when the pointer or focus has left
   * every link. The two are reported separately, and the chrome resolves them — the hovered link wins, the
   * focused one is the fallback — into its status bar readout. Optional: a body that draws no links never
   * calls it.
   */
  onLinkTarget?(source: 'hover' | 'focus', target: string | null): void;
  /**
   * The body has put `filePath`'s content on screen. REQUIRED to call (data-model §13, amended in the US3
   * review): after EVERY draw a body calls exactly one of `onDrawn` or `onBodyFailure` — including a body
   * with no headings and no links.
   *
   * Three things wait on it. The chrome scrolls to a followed link's fragment only once the file is drawn,
   * because before then there is no heading to find (FR-090b); a focus that names a fragment does the same;
   * and the failure banner's Try again after `onBodyFailure` remounts the body and resolves from what the
   * remounted body reports. A body that reported neither would leave that Try again waiting forever.
   */
  onDrawn(filePath: string): void;
  /**
   * The body could not draw — its renderer or a chunk it loads failed (044 u8 review). The chrome shows
   * the shared failure banner and, on Try again, remounts the body, so a body must not cache a failed
   * load across mounts.
   */
  onBodyFailure(error: unknown): void;
}

export type PreviewBody = ComponentType<PreviewBodyProps>;

export interface PreviewProviderView {
  /** The id of the core descriptor this view draws. */
  id: string;
  /** Loaded on first use (R21), so no provider's body — or its libraries — rides in the eager bundle. */
  load(): Promise<PreviewBody>;
  /** The body menu offers Copy and Select All only when true (FR-035). */
  textSelection: boolean;
  /**
   * FR-035a — the HTML a RICH copy puts on the clipboard, from a clone of the selected part of this
   * provider's body: the provider's own export profile, since only the provider knows what its DOM carries
   * that must not travel. Loaded on first use, like the body. A provider without one copies rich text as
   * its plain text alone.
   */
  exportHtml?(selection: DocumentFragment): Promise<string>;
}
