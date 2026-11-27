/**
 * The preview panel's BODY menu (044, FR-015b, FR-035, FR-035c, FR-096d; 045 FR-169 – FR-171, S6;
 * contracts/menus-and-controls.md §4).
 *
 * A builder, not a component, for the reason `terminal-content-menu.ts` gives: a menu assembled inside a
 * handler cannot be driven by a test, and `menu-sections.test.ts` asserts every builder's shape.
 *
 * | Section    | Items                                                               | When                                   |
 * |------------|---------------------------------------------------------------------|----------------------------------------|
 * | Content    | Copy · Copy as ▸ (Rich Text · Plain Text) · Select All              | the provider draws selectable text (Select All: a flowing document or a page, FR-085a) |
 * | Navigate   | Open in Editor                                                      | a text provider (never binary, FR-015e) |
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
 * **Content.** Copy uses the `editor.previews.copyFormat` setting; the Copy as submenu's Rich Text and Plain Text
 * each copy in their named format whatever the setting — a default action with its explicit alternatives
 * beside it (the #394 pattern, FR-035c; grouped under one submenu by the v1 review, #732). Copy and Copy as are
 * DISABLED, not absent, while nothing is selected:
 * selecting text is what enables them. Select All is never disabled. Copy and Select All show the native
 * chords the body answers (Ctrl+C is the intercepted copy gesture, Ctrl+A the body's scoped select-all);
 * like the editor's, they are fixed and not on the rebindable command list.
 *
 * **Navigate.** The mirror of an editor's Open Preview, in the section it occupies there (FR-015b).
 */
import type { IconKey, PreviewCopyFormat, PreviewGoToKind, PreviewLink } from '@throng/core';
import type { PageLayout } from './provider-view.js';
import type { MenuAction } from '../workspace/context-menu.js';
import { withSplit, type SplitMenuArgs } from '../workspace/split-menu.js';
import { outliningSubmenu, type OutliningArgs } from '../common/outlining-menu.js';
import { copyPathSubmenu, type PathForms } from '../common/copy-path-menu.js';
import { fixedShortcut } from '../common/fixed-shortcut.js';
import { copyAsSubmenu } from '../common/copy-as-menu.js';

/** The Content section: present when the provider draws selectable text (`PreviewProviderView.textSelection`). */
export interface PreviewContentSection {
  /** What Copy copies as (FR-035b). */
  copyFormat: PreviewCopyFormat;
  /** Copy what was selected when the menu opened, in `format`. */
  copy: (format: PreviewCopyFormat) => void;
  /** Select the body's contents and nothing else. */
  selectAll: () => void;
  /**
   * 074 FR-085a — the body is a PAGE whose text is selectable though it is not a flowing document (an HTML page):
   * Select All is offered as a flowing document offers it. Absent: Select All follows `flowingDocument`.
   */
  pageSelectAll?: boolean;
}

/** The Navigate section's route back to the source: present for a text provider only (FR-015e). */
export interface PreviewEditorRouteItem {
  /** *Open in Editor*: focuses the parent or an editor of the file, else places one (`runPreviewEditorRoute`). */
  run: () => void;
  /** 050 R26 — the file moved to another project: the row is drawn disabled. */
  disabled?: boolean;
}

export interface PreviewContentMenuArgs {
  /** 048 FR-015 — the panel this menu belongs to and the live chords; draws the shared Split submenu. */
  split?: SplitMenuArgs;
  /**
   * 074 FR-028, FR-068a — the previewed file's path in the File Explorer's four forms: Copy Path is offered. Omitted or
   * `null` (a file outside the project): no Copy Path.
   */
  copyPath?: PathForms | null;
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
  find: {
    run: () => void;
    chord?: string;
    /** 074 FR-086a — the body has no text at all (a picture): no Find row. */
    absent?: boolean;
  };
  /**
   * 047 US4 (contract "Preview body menu") — always present, even with no headings at all (the
   * pop-down itself says "No headings" then, rather than this row disappearing).
   */
  /**
   * The preview's Go to command (`preview.goToHeading`). 074 FR-062b — `kind` says where it goes: `'page'` (a PDF,
   * "Go to Page…"), `'heading'` (absent too: "Go to Heading…"), `null` (nothing to go to: no row).
   */
  goToHeading: { run: () => void; chord?: string; kind?: PreviewGoToKind };
  /**
   * 075 FR-062, FR-063 — Print…, always drawn. `unavailable` is the hover of a provider that cannot print, whose
   * row is drawn disabled. Omitted: no row (a builder caller predating 075).
   */
  print?: { run: () => void; chord?: string; unavailable?: string };
  /**
   * 047 US3 (FR-036, contract "Preview body menu") — the fold rows, present only for a Markdown
   * document; omitted or `null` draws none of them. Mirrors the editor's own `markdownFold` arg
   * (`editor/content-menu.ts`) exactly: `section` is the innermost section containing the point the
   * menu was opened at, `null` before the first heading — that is when the This-Section row is
   * ABSENT (FR-036), not disabled. Collapse All / Expand All are always present but DISABLED when
   * the document has no headings at all.
   */
  fold?: OutliningArgs | null;
  /**
   * 054 FR-074 — an inline diagram of this panel is maximised over it: the document is covered, so Find,
   * Go to Heading, Copy, Select All, Synchronise Scrolling and Outlining are drawn disabled (Principle VI).
   */
  focusLocked?: boolean;
  /**
   * 054 — `false` for a provider that draws one picture (Mermaid): Go to Heading and Select All are absent,
   * not disabled — there is never anything for them to act on. Absent reads `true`.
   */
  flowingDocument?: boolean;
  /**
   * 054 (manual test change request, 2026-10-12) — the diagram under the pointer, when there is one: Copy
   * Diagram as Image and Enter / Exit Focus Mode lead the menu, in its Contextual section.
   */
  diagram?: { inFocus: boolean; copyImage: () => void; toggleFocus: () => void; focusChord?: string; picture?: boolean } | null;
  /** 074 FR-062c — a paged body's layout: one checked row per layout. Omitted or `null` draws none. */
  pageLayout?: { value: PageLayout; set: (layout: PageLayout) => void } | null;
}

/** 074 FR-062c — the layout rows, in the order the PDF toolbar draws them. */
export const PAGE_LAYOUT_ROWS: readonly { layout: PageLayout; label: string; icon: IconKey }[] = [
  { layout: 'single', label: 'Single Page', icon: 'pageLayoutSingle' },
  { layout: 'two', label: 'Two Pages', icon: 'pageLayoutTwo' },
  { layout: 'wrap', label: 'Pages Side by Side', icon: 'pageLayoutWrap' },
];

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
    case 'editor':
      return link.text;
    default:
      return '';
  }
}

export function previewContentMenu(args: PreviewContentMenuArgs): MenuAction[] {
  const { selectionEmpty, content, editorRoute, syncScroll, find, goToHeading, fold } = args;
  const locked = args.focusLocked === true;
  const flowing = args.flowingDocument !== false;
  const lockedOut = locked ? { disabled: true } : {};
  const items: MenuAction[] = [];

  if (args.diagram) {
    const diagram = args.diagram;
    items.push({
      // 074 FR-033 — a picture is already an image: Copy Image, as its own preview names it.
      label: diagram.picture === true ? 'Copy Image' : 'Copy Diagram as Image',
      icon: 'copy',
      section: 'contextual',
      onClick: () => diagram.copyImage(),
    });
    items.push({
      label: diagram.inFocus ? 'Exit Focus Mode' : 'Enter Focus Mode',
      icon: diagram.inFocus ? 'panelRestore' : 'diagramFullPane',
      section: 'contextual',
      ...(diagram.focusChord !== undefined ? { shortcut: diagram.focusChord } : {}),
      onClick: () => diagram.toggleFocus(),
    });
  }

  if (find.absent !== true) items.push({
    label: 'Find…',
    icon: 'search',
    section: 'navigate',
    ...(find.chord !== undefined ? { shortcut: find.chord } : {}),
    ...lockedOut,
    onClick: () => find.run(),
  });
  const goToPage = goToHeading.kind === 'page';
  if (goToPage || (flowing && goToHeading.kind !== null)) items.push({
    // No icon token, matching the editor's Go To Line… precedent (`editor/content-menu.ts`) — a
    // "move you somewhere in the document" row draws its shortcut, not a glyph, when it has none apt.
    label: goToPage ? 'Go to Page…' : 'Go to Heading…',
    section: 'navigate',
    ...(goToHeading.chord !== undefined ? { shortcut: goToHeading.chord } : {}),
    ...lockedOut,
    onClick: () => goToHeading.run(),
  });

  if (content) {
    items.push({
      label: 'Copy',
      icon: 'copy',
      section: 'content',
      group: 'clipboard',
      shortcut: fixedShortcut('copy'),
      disabled: locked || selectionEmpty,
      onClick: () => content.copy(content.copyFormat),
    });
    items.push(copyAsSubmenu({ section: 'content', group: 'clipboard', disabled: locked || selectionEmpty, copy: content.copy }));
    if (flowing || content.pageSelectAll === true) items.push({
      label: 'Select All',
      icon: 'selectAll',
      section: 'content',
      group: 'clipboard',
      shortcut: fixedShortcut('selectAll'),
      ...lockedOut,
      onClick: () => content.selectAll(),
    });
  }

  if (args.copyPath) items.push(copyPathSubmenu(args.copyPath, 'navigate'));

  if (editorRoute) {
    items.push({
      label: 'Open in Editor',
      icon: 'editorPanel',
      section: 'navigate',
      disabled: editorRoute.disabled === true,
      onClick: () => editorRoute.run(),
    });
  }

  if (args.pageLayout) {
    const pageLayout = args.pageLayout;
    for (const row of PAGE_LAYOUT_ROWS) {
      items.push({
        label: row.label,
        icon: row.icon,
        checked: pageLayout.value === row.layout,
        section: 'viewState',
        onClick: () => pageLayout.set(row.layout),
      });
    }
  }

  if (syncScroll) {
    items.push({
      label: 'Synchronise Scrolling',
      checked: syncScroll.on,
      testId: 'menu-item-Synchronise Scrolling',
      icon: 'syncScroll',
      section: 'viewState',
      ...(syncScroll.chord !== undefined ? { shortcut: syncScroll.chord } : {}),
      ...lockedOut,
      onClick: () => syncScroll.toggle(),
    });
  }

  /*
   * 047 US3 (FR-036, contracts "Preview body menu") — the fold rows, Markdown documents only. Exactly
   * one of Collapse/Expand This Section is drawn (never both — `section.collapsed` decides which),
   * absent entirely before the first heading; Collapse All / Expand All are always drawn but disabled
   * with no headings to act on. Mirrors the editor's own `editor/content-menu.ts` exactly.
   */
  // 054 FR-010 supersedes the placement above: the rows are ONE Outlining submenu, built by the builder the
  // editor's menu uses too, so the two menus cannot drift (R3).
  if (fold) items.push({ ...outliningSubmenu(fold), ...lockedOut });

  // 075 FR-063 — Print…, with the other ways out of the panel's document.
  if (args.print) {
    const print = args.print;
    items.push({
      label: 'Print…',
      icon: 'print',
      section: 'navigate',
      group: 'print',
      ...(print.chord !== undefined ? { shortcut: print.chord } : {}),
      ...(print.unavailable !== undefined ? { disabled: true, title: print.unavailable } : locked ? { disabled: true } : {}),
      onClick: () => print.run(),
    });
  }

  return withSplit(items, args.split);
}
