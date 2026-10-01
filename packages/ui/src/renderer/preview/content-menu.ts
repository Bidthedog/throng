/**
 * The preview panel's BODY menu (044, FR-015b, FR-035, FR-035c, FR-096d; 045 FR-169 – FR-171, S6;
 * contracts/menus-and-controls.md §4).
 *
 * A builder, not a component, for the reason `terminal-content-menu.ts` gives: a menu assembled inside a
 * handler cannot be driven by a test, and `menu-sections.test.ts` asserts every builder's shape.
 *
 * | Section    | Items                                                               | When                                   |
 * |------------|---------------------------------------------------------------------|----------------------------------------|
 * | Content    | Copy · Copy as Rich Text · Copy as Plain Text · Select All          | the provider draws selectable text     |
 * | Navigate   | Open in Editor / Go to Editor                                       | a text provider (never binary, FR-015e) |
 * | View & state | Synchronise Scrolling *(its chord)*, checked while on             | a text provider, whatever is under the pointer (FR-122b) |
 *
 * ══ THIS MENU NO LONGER CARRIES ANY LINK ROW (045 round four, FR-169 – FR-171) ══
 *
 * 024 and 044 had the link run (Open Link, Copy Link to Clipboard) LEAD this menu whenever the
 * pointer sat on a link. FR-169 supersedes that: a right-click (or `menu.open`) over a link with no
 * selection now opens the ONE Link menu (`preview/preview-link-menu.ts`, built from core's
 * `buildLinkMenu`, the same path a terminal and an editor use) **instead of** this menu entirely —
 * never both, never one leading the other. The call site (`preview-panel.tsx`) decides which menu to
 * open; this builder only ever draws the ordinary one, exactly as `terminal-content-menu.ts` and
 * `editor/content-menu.ts` do.
 *
 * **Content.** Copy uses the `editor.previews.copyFormat` setting; Copy as Rich Text and Copy as Plain Text
 * each copy in their named format whatever the setting — a default action with its explicit alternatives
 * beside it (the #394 pattern, FR-035c). All three are DISABLED, not absent, while nothing is selected:
 * selecting text is what enables them. Select All is never disabled. Copy and Select All show the native
 * chords the body answers (Ctrl+C is the intercepted copy gesture, Ctrl+A the body's scoped select-all);
 * like the editor's, they are fixed and not on the rebindable command list.
 *
 * **Navigate.** The mirror of an editor's Open Preview, in the section it occupies there (FR-015b).
 */
import type { PreviewCopyFormat, PreviewLink } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import { withSplit, type SplitMenuArgs } from '../workspace/split-menu.js';

/** The Content section: present when the provider draws selectable text (`PreviewProviderView.textSelection`). */
export interface PreviewContentSection {
  /** What Copy copies as (FR-035b). */
  copyFormat: PreviewCopyFormat;
  /** Copy what was selected when the menu opened, in `format`. */
  copy: (format: PreviewCopyFormat) => void;
  /** Select the body's contents and nothing else. */
  selectAll: () => void;
}

/** The Navigate section's route back to the source: present for a text provider only (FR-015e). */
export interface PreviewEditorRouteItem {
  /** Parented → *Go to Editor*; standalone → *Open in Editor*. */
  parented: boolean;
  run: () => void;
}

export interface PreviewContentMenuArgs {
  /** 048 FR-015 — the panel this menu belongs to and the live chords; draws the shared Split submenu. */
  split?: SplitMenuArgs;
  /** Whether the body's selection was collapsed when the menu was asked for. */
  selectionEmpty: boolean;
  /** Omitted or `null`: no Content section (a provider without selectable text). */
  content?: PreviewContentSection | null;
  /** Omitted or `null`: no Navigate section (a binary provider). */
  editorRoute?: PreviewEditorRouteItem | null;
  /**
   * 044 FR-122b — the View & state section's Synchronise Scrolling: the setting's value, the toggle and its
   * chord. Omitted or `null`: no such section (a binary provider, FR-122a).
   */
  syncScroll?: { on: boolean; toggle: () => void; chord?: string } | null;
  /**
   * 047 US1 (FR-007, contracts/menus-commands-controls.md "Preview body menu") — always present,
   * whatever the provider or what is under the pointer: every preview offers `search.find` from its
   * own menu, the way a click-only reader reaches it.
   */
  find: { run: () => void; chord?: string };
  /**
   * 047 US4 (contract "Preview body menu") — always present, even with no headings at all (the
   * pop-down itself says "No headings" then, rather than this row disappearing).
   */
  goToHeading: { run: () => void; chord?: string };
  /**
   * 047 US3 (FR-036, contract "Preview body menu") — the fold rows, present only for a Markdown
   * document; omitted or `null` draws none of them. Mirrors the editor's own `markdownFold` arg
   * (`editor/content-menu.ts`) exactly: `section` is the innermost section containing the point the
   * menu was opened at, `null` before the first heading — that is when the This-Section row is
   * ABSENT (FR-036), not disabled. Collapse All / Expand All are always present but DISABLED when
   * the document has no headings at all.
   */
  fold?: {
    section: { level: number; collapsed: boolean } | null;
    hasSections: boolean;
    collapseSection: () => void;
    expandSection: () => void;
    collapseAll: () => void;
    expandAll: () => void;
    chords?: {
      collapseSection?: string;
      expandSection?: string;
      collapseAll?: string;
      expandAll?: string;
    };
  } | null;
}

/**
 * What Copy Link to Clipboard copies (FR-116, contracts/menus-and-controls.md §4): a web or `mailto:` link's URL; a
 * project file's absolute path, then `#fragment` when the link names one; a same-document heading as
 * `docPath` — the file the panel shows — then `#fragment`, never a bare `#fragment`, which names nothing
 * outside this panel; an outside link's target as written.
 */
export function linkAddress(link: PreviewLink, docPath: string): string {
  switch (link.kind) {
    case 'external':
      return link.url;
    case 'file':
      return link.fragment !== undefined ? `${link.absPath}#${link.fragment}` : link.absPath;
    case 'heading':
      return `${docPath}#${link.fragment}`;
    case 'outside':
      return link.target;
    default:
      return '';
  }
}

export function previewContentMenu(args: PreviewContentMenuArgs): MenuAction[] {
  const { selectionEmpty, content, editorRoute, syncScroll, find, goToHeading, fold } = args;
  const items: MenuAction[] = [];

  items.push({
    label: 'Find…',
    icon: 'search',
    section: 'navigate',
    ...(find.chord !== undefined ? { shortcut: find.chord } : {}),
    onClick: () => find.run(),
  });
  items.push({
    // No icon token, matching the editor's Go To Line… precedent (`editor/content-menu.ts`) — a
    // "move you somewhere in the document" row draws its shortcut, not a glyph, when it has none apt.
    label: 'Go to Heading…',
    section: 'navigate',
    ...(goToHeading.chord !== undefined ? { shortcut: goToHeading.chord } : {}),
    onClick: () => goToHeading.run(),
  });

  if (content) {
    items.push({
      label: 'Copy',
      icon: 'copy',
      section: 'content',
      shortcut: 'Ctrl+C',
      disabled: selectionEmpty,
      onClick: () => content.copy(content.copyFormat),
    });
    items.push({
      label: 'Copy as Rich Text',
      icon: 'copy',
      section: 'content',
      disabled: selectionEmpty,
      onClick: () => content.copy('rich'),
    });
    items.push({
      label: 'Copy as Plain Text',
      icon: 'copy',
      section: 'content',
      disabled: selectionEmpty,
      onClick: () => content.copy('plain'),
    });
    items.push({
      label: 'Select All',
      icon: 'selectAll',
      section: 'content',
      shortcut: 'Ctrl+A',
      onClick: () => content.selectAll(),
    });
  }

  if (editorRoute) {
    items.push({
      label: editorRoute.parented ? 'Go to Editor' : 'Open in Editor',
      icon: 'editorPanel',
      section: 'navigate',
      onClick: () => editorRoute.run(),
    });
  }

  if (syncScroll) {
    items.push({
      label: syncScroll.on ? 'Synchronise Scrolling ✓' : 'Synchronise Scrolling',
      testId: 'menu-item-Synchronise Scrolling',
      icon: 'syncScroll',
      section: 'viewState',
      ...(syncScroll.chord !== undefined ? { shortcut: syncScroll.chord } : {}),
      onClick: () => syncScroll.toggle(),
    });
  }

  /*
   * 047 US3 (FR-036, contracts "Preview body menu") — the fold rows, Markdown documents only. Exactly
   * one of Collapse/Expand This Section is drawn (never both — `section.collapsed` decides which),
   * absent entirely before the first heading; Collapse All / Expand All are always drawn but disabled
   * with no headings to act on. Mirrors the editor's own `editor/content-menu.ts` exactly.
   */
  if (fold) {
    if (fold.section) {
      items.push(
        fold.section.collapsed
          ? {
              label: `Expand This H${fold.section.level}`,
              section: 'viewState',
              ...(fold.chords?.expandSection !== undefined ? { shortcut: fold.chords.expandSection } : {}),
              onClick: () => fold.expandSection(),
            }
          : {
              label: `Collapse This H${fold.section.level}`,
              section: 'viewState',
              ...(fold.chords?.collapseSection !== undefined ? { shortcut: fold.chords.collapseSection } : {}),
              onClick: () => fold.collapseSection(),
            },
      );
    }
    items.push({
      label: 'Collapse All',
      section: 'viewState',
      disabled: !fold.hasSections,
      ...(fold.chords?.collapseAll !== undefined ? { shortcut: fold.chords.collapseAll } : {}),
      onClick: () => fold.collapseAll(),
    });
    items.push({
      label: 'Expand All',
      section: 'viewState',
      disabled: !fold.hasSections,
      ...(fold.chords?.expandAll !== undefined ? { shortcut: fold.chords.expandAll } : {}),
      onClick: () => fold.expandAll(),
    });
  }

  return withSplit(items, args.split);
}
