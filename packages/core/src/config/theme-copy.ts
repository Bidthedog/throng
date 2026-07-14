/**
 * Hand-written editor copy for every theme token (feature 009, FR-006/007/008).
 *
 * Replaces the mechanically generated "App bg" / `The "App bg" colour token.`
 * labels with human copy that names the concrete surfaces and elements each token
 * paints. Rules, asserted by theme-copy.test.ts:
 *  - words spelled in full — no abbreviation from BANNED_ABBREVIATIONS;
 *  - the description names what the token paints, never restates its identifier;
 *  - every editable token has exactly one entry (completeness).
 * Pure data. No OS/DOM.
 */

/** Abbreviations forbidden in any label or description (matched on word boundaries). */
export const BANNED_ABBREVIATIONS: readonly string[] = [
  'bg',
  'fg',
  'bkg',
  'fore',
  'min',
  'max',
  'cfg',
  'config',
  'id',
  'num',
  'btn',
  'sel',
];

const ABBREV_RE = new RegExp(`\\b(${BANNED_ABBREVIATIONS.join('|')})\\b`, 'i');

/** True if the text contains a banned abbreviation as a whole word (case-insensitive). */
export function containsAbbreviation(text: string): boolean {
  return ABBREV_RE.test(text);
}

export interface TokenCopy {
  label: string;
  description: string;
}

/** Hand-written label + description keyed by editable token path. */
export const THEME_TOKEN_COPY: Record<string, TokenCopy> = {
  // — Colours —
  'colours.appBg': {
    label: 'Application background',
    description:
      'The base surface behind the whole window, showing through the gaps between panes and panels.',
  },
  'colours.sidebarBg': {
    label: 'Sidebar background',
    description: 'The surface behind the left sidebar that holds the projects and sub-workspaces lists.',
  },
  'colours.surface': {
    label: 'Panel surface',
    description: 'The body of a pane or panel — the Files and Folders tree, the workspace panels, the project list.',
  },
  'colours.surfaceActive': {
    label: 'Active surface',
    description: 'Whatever is currently chosen: the open project, the active tab, the highlighted row in a tree.',
  },
  'colours.menuSurface': {
    label: 'Menu surface',
    description: 'The card a drop-down or right-click menu floats on, above whatever it covers.',
  },
  'colours.inputSurface': {
    label: 'Field surface',
    description: 'The well of a text box, a search field, or a chooser you can type into.',
  },
  'colours.hoverSurface': {
    label: 'Hover surface',
    description: 'The soft wash under the pointer as it passes over a row or an icon you could click.',
  },
  'colours.dialogSurface': {
    label: 'Dialogue surface',
    description: 'The card a dialogue or a floating bar is drawn on, lifted clear of the page beneath it.',
  },
  'colours.menuItemHoverSurface': {
    label: 'Menu highlight',
    description:
      'The band that follows the pointer down a list of entries. Leave it empty and it takes the open project’s own colour.',
  },
  'colours.accentText': {
    label: 'Text on highlight',
    description: 'Lettering that has to stay legible while sitting directly on the highlight colour.',
  },
  'colours.dangerText': {
    label: 'Text on a warning',
    description: 'Wording carried on a red control — the button that deletes, the one you must be able to read.',
  },
  // These name the EDITOR's scrollbar, and say so. A setting that claims to colour every scrollbar in
  // the application, while the only classic bar the application actually draws is the editor's, is a
  // setting that lies to you every time you change it and see nothing happen. The thumb-hover token was
  // REMOVED outright: the standard `scrollbar-color` property is the only one we can use without
  // forcing a layout-shifting classic bar on every surface, and it has no hover state at all — so that
  // token could never have painted anything, anywhere.
  'colours.scrollbarTrack': {
    label: 'Editor scrollbar trough',
    description:
      'The channel the editor’s scrollbar slides along. Other surfaces use the thin overlay scrollbars the operating system draws, which take no colour.',
  },
  'colours.scrollbarThumb': {
    label: 'Editor scrollbar handle',
    description:
      'The draggable part you grab to move through a long file. Other surfaces use the thin overlay scrollbars the operating system draws, which take no colour.',
  },
  'colours.iconColour': {
    label: 'Icon colour',
    description: 'Ink for the artwork. Leave it empty and every glyph simply takes the colour of whatever holds it.',
  },
  'colours.text': {
    label: 'Primary text',
    description: 'The main readable colour for labels, list entries, and body copy across the interface.',
  },
  'colours.textMuted': {
    label: 'Muted text',
    description: 'The dimmed colour for subtitles, hints, placeholder prompts, and inactive labels.',
  },
  'colours.accent': {
    label: 'Accent',
    description: 'The dominant highlight for focused controls, links, the selected tab, and the active pane marker.',
  },
  'colours.danger': {
    label: 'Danger',
    description: 'The colour of destructive actions, error messages, and warning badges.',
  },
  'colours.success': {
    label: 'Success',
    description: 'The colour of confirmations, healthy status indicators, and completed states.',
  },
  'colours.railBg': {
    label: 'Collapsed rail background',
    description: 'The narrow strip shown when a side pane is collapsed, carrying its expand toggle.',
  },
  'colours.border': {
    label: 'Border',
    description: 'The dividing lines and outlines that separate panes, panels, rows, and input fields.',
  },
  'colours.statusBarBg': {
    label: 'Status bar background',
    description: 'The surface behind the status bar along the bottom edge of the window.',
  },
  'colours.terminalBg': {
    label: 'Terminal background',
    description: 'The surface behind the output of a terminal panel.',
  },
  'colours.terminalFg': {
    label: 'Terminal text',
    description: 'The default colour of the characters printed in a terminal panel.',
  },
  'colours.terminalCursor': {
    label: 'Terminal cursor',
    description: 'The block that marks the typing position in a terminal.',
  },
  'colours.terminalSelection': {
    label: 'Terminal selection',
    description: 'The highlight behind text the user has selected inside a terminal.',
  },
  'colours.editorBg': {
    label: 'Editor background',
    description: 'The surface behind the text area of the code editor panel.',
  },
  'colours.editorFg': {
    label: 'Editor text',
    description: 'The default colour of the characters typed in the code editor panel.',
  },
  'colours.editorCursor': {
    label: 'Editor cursor',
    description: 'The caret that marks the insertion point in the code editor.',
  },
  'colours.editorSelection': {
    label: 'Editor selection',
    description: 'The highlight behind text the user has selected in the code editor.',
  },
  'colours.editorGutterBg': {
    label: 'Editor gutter background',
    description: 'The strip down the left edge of the code editor that carries the line numbers, behind those numbers.',
  },
  'colours.editorGutterFg': {
    label: 'Editor gutter text',
    description: 'The line numbers and fold markers printed in the code editor gutter.',
  },
  'colours.unsavedDot': {
    label: 'Unsaved changes marker',
    description:
      'The dot on a tab, panel, or project that has edits not yet written to disk, and the editor file and type pills.',
  },
  // Syntax highlighting (016). Each names what the colour paints in real code, so a theme author
  // can picture the result without knowing a single grammar's node names.
  'colours.syntaxKeyword': {
    label: 'Keywords',
    description:
      'Words the language itself reserves, such as "if", "return", "class" and "function".',
  },
  'colours.syntaxString': {
    label: 'Text literals',
    description: 'Quoted text written directly into the code, including its quote marks.',
  },
  'colours.syntaxComment': {
    label: 'Comments',
    description:
      'Notes written for people rather than the machine — usually quieter than the code around them.',
  },
  'colours.syntaxNumber': {
    label: 'Numbers and constants',
    description: 'Numeric values written into the code, alongside true, false and null.',
  },
  'colours.syntaxType': {
    label: 'Type names',
    description: 'The names of classes, interfaces and other types the code declares or refers to.',
  },
  'colours.syntaxFunction': {
    label: 'Function names',
    description: 'The names of functions and methods, both where they are defined and where they are called.',
  },
  'colours.syntaxVariable': {
    label: 'Variable names',
    description: 'The names the code gives to its own values, and the properties it reads from them.',
  },
  'colours.syntaxOperator': {
    label: 'Operators',
    description: 'The symbols that combine values, such as plus, minus, equals and the arrow.',
  },
  'colours.syntaxPunctuation': {
    label: 'Brackets and punctuation',
    description:
      'The structural marks that hold code together — brackets, braces, commas and semicolons.',
  },
  'colours.syntaxInvalid': {
    label: 'Broken code',
    description: 'Text the language cannot make sense of, marked so a typo is visible at a glance.',
  },
  // The editor's own status strip (016) — distinct from the application status bar along the very
  // bottom of the window, which has its own token. The copy has to say so, or a theme author will
  // paint one and wonder why the other did not change.
  'colours.editorStatusStripBg': {
    label: 'Editor status strip surface',
    description:
      'The narrow band along the bottom of an editor panel that shows the file language — not the application status bar at the foot of the window.',
  },
  'colours.editorStatusStripFg': {
    label: 'Editor status strip text',
    description:
      'The language name printed in the band along the bottom of an editor panel, which must stay readable on it.',
  },
  'colours.editorStatusStripHover': {
    label: 'Editor status strip hover surface',
    description:
      'The surface that appears behind the language name when the pointer is over it, showing it can be clicked to change the language.',
  },
  'colours.searchMatch': {
    label: 'Search match',
    description:
      'The surface tinting every occurrence of the search term in an editor or a terminal, behind text that must stay readable.',
  },
  'colours.searchMatchCurrent': {
    label: 'Current search match',
    description:
      'The stronger surface marking the one match you are presently sitting on, so it stands out from the others.',
  },
  'colours.searchMatchCurrentBorder': {
    label: 'Current match outline',
    description:
      'The line drawn around the match you are presently on, keeping it identifiable even on a busy surface.',
  },
  'colours.activePaneHighlight': {
    label: 'Active pane highlight',
    description: 'The emphasis marking the focused entry in the files and folders pane.',
  },
  'colours.activePanelBorder': {
    label: 'Active panel border',
    description:
      'The outline around the panel that currently receives keyboard input, while its window is in the foreground.',
  },
  'colours.activePanelBorderInactive': {
    label: 'Active panel border, window in background',
    description:
      'The dimmed outline marking the panel that will receive input once its window returns to the foreground.',
  },
  'colours.buttonBg': {
    label: 'Button background',
    description: 'The resting surface of push buttons.',
  },
  'colours.buttonText': {
    label: 'Button text',
    description: 'The label colour of push buttons at rest.',
  },
  'colours.buttonHoverBg': {
    label: 'Button hover background',
    description: 'The surface of a push button while the pointer hovers over it.',
  },
  'colours.buttonHoverText': {
    label: 'Button hover text',
    description: 'The label colour of a push button while the pointer hovers over it.',
  },

  // — Fonts —
  'fonts.family': {
    label: 'Application font family',
    description: 'The typeface used for interface text wherever a section does not override it.',
  },
  'fonts.baseSizePx': {
    label: 'Base font size',
    description: 'The default text height, in pixels, that unpinned sections scale from.',
  },
  'fonts.weights.normal': {
    label: 'Normal font weight',
    description: 'The stroke thickness of ordinary, unemphasised interface text.',
  },
  'fonts.weights.bold': {
    label: 'Bold font weight',
    description: 'The stroke thickness applied to emphasised interface text.',
  },

  // — Typography roles —

  // — Icons —
  'icons.destroy': {
    label: 'Destroy control icon',
    description: 'The glyph on the control that permanently closes and discards a terminal, panel, or project.',
  },
  'icons.dismiss': {
    label: 'Dismiss message icon',
    description:
      'The glyph on the control that clears a transient message such as an error bar or notice, without destroying anything.',
  },
  'icons.retry': {
    label: 'Retry action icon',
    description:
      'The glyph on the control that re-runs a failed or interrupted action, such as reconnecting a dropped terminal session.',
  },
  'icons.restoreAll': {
    label: 'Restore all defaults icon',
    description:
      'The glyph on the control that returns every built-in theme to the values it was shipped with, leaving your own themes untouched.',
  },
  'icons.revert': {
    label: 'Revert item icon',
    description:
      'The glyph on the control that undoes your changes to a single preference, putting it back to the value it had when you opened this window — which is not necessarily the value Throng ships with.',
  },
  'icons.editJson': {
    label: 'Edit as JSON icon',
    description:
      'The glyph on the preferences toggle that swaps the visual editor for the raw configuration text, so you can type the underlying values by hand.',
  },
  'icons.editVisual': {
    label: 'Edit visually icon',
    description:
      'The glyph on the preferences toggle that swaps the raw configuration text back for the visual editor, with its labelled rows and controls.',
  },
  'icons.moveUp': {
    label: 'Move up icon',
    description:
      'The glyph on the control that moves an entry one place earlier in a list you are editing, such as a folder-exclusion rule.',
  },
  'icons.moveDown': {
    label: 'Move down icon',
    description:
      'The glyph on the control that moves an entry one place later in a list you are editing, such as a folder-exclusion rule.',
  },
  'icons.zoomIn': {
    label: 'Zoom in icon',
    description: 'The glyph on the panel menu control that enlarges that panel’s text.',
  },
  'icons.zoomOut': {
    label: 'Zoom out icon',
    description: 'The glyph on the panel menu control that shrinks that panel’s text.',
  },
  'icons.zoomReset': {
    label: 'Reset zoom icon',
    description: 'The glyph on the panel menu control that returns that panel’s text to its default size.',
  },
  'icons.collapse': {
    label: 'Collapse icon',
    description: 'The glyph on the control that folds a pane or section closed.',
  },
  'icons.expand': {
    label: 'Expand icon',
    description: 'The glyph on the control that opens a collapsed pane or section.',
  },
  'icons.rename': {
    label: 'Rename icon',
    description: 'The glyph on the control that starts editing the name of a project, tab, or panel.',
  },
  'icons.send': {
    label: 'Send icon',
    description: 'The glyph on the control that submits the typed input to its target.',
  },
  'icons.tab': {
    label: 'Tab icon',
    description: 'The glyph that marks a workspace tab.',
  },
  'icons.add': {
    label: 'Add icon',
    description: 'The glyph on the control that creates a new tab, terminal, or entry.',
  },
  'icons.detach': {
    label: 'Detach icon',
    description: 'The glyph on the control that tears a tab or panel out into its own window.',
  },
  'icons.folder': {
    label: 'Folder icon',
    description: 'The glyph shown beside a closed folder in the files and folders tree.',
  },
  'icons.folderOpen': {
    label: 'Open folder icon',
    description: 'The glyph shown beside an expanded folder in the files and folders tree.',
  },
  'icons.chevron': {
    label: 'Tree chevron icon',
    description: "The small arrow that twists to reveal or hide a folder's children in the tree.",
  },
  'icons.file': {
    label: 'File icon',
    description: 'The glyph shown beside an ordinary file in the tree.',
  },
  'icons.fileCode': {
    label: 'Code file icon',
    description: 'The glyph shown beside a source-code file in the tree.',
  },
  'icons.fileJson': {
    label: 'Data file icon',
    description: 'The glyph shown beside a structured-data file in the tree.',
  },
  'icons.fileMarkdown': {
    label: 'Markdown file icon',
    description: 'The glyph shown beside a Markdown document in the tree.',
  },
  'icons.fileImage': {
    label: 'Image file icon',
    description: 'The glyph shown beside an image file in the tree.',
  },
  'icons.fileText': {
    label: 'Text file icon',
    description: 'The glyph shown beside a plain-text file in the tree.',
  },
  'icons.symlink': {
    label: 'Symbolic link icon',
    description: 'The badge marking a tree entry that points to another location.',
  },
  'icons.editorPanel': {
    label: 'Editor panel type icon',
    description: 'The glyph at the head of an editor panel’s title marking it as a text editor.',
  },
  'icons.expandAll': {
    label: 'Expand all icon',
    description: 'The glyph on the toolbar control that opens every folder in the tree.',
  },
  'icons.collapseAll': {
    label: 'Collapse all icon',
    description: 'The glyph on the toolbar control that folds every folder in the tree closed.',
  },
  'icons.newFolder': {
    label: 'New folder icon',
    description: 'The glyph on the toolbar control that creates a folder in the tree.',
  },
  'icons.terminal': {
    label: 'Terminal icon',
    description: 'The glyph that marks a terminal panel or a new-terminal control.',
  },
  'icons.search': {
    label: 'Find icon',
    description: 'The glyph on the control that opens the find bar over the active panel.',
  },
  'icons.findNext': {
    label: 'Find next icon',
    description: 'The glyph on the control that steps forward to the following match.',
  },
  'icons.findPrevious': {
    label: 'Find previous icon',
    description: 'The glyph on the control that steps back to the preceding match.',
  },
  'icons.matchCase': {
    label: 'Match case toggle icon',
    description:
      'The glyph on the toggle that makes the search distinguish capital letters from small ones.',
  },
  'icons.wholeWord': {
    label: 'Whole word toggle icon',
    description:
      'The glyph on the toggle that restricts the search to complete words rather than fragments.',
  },
  'icons.replace': {
    label: 'Replace match icon',
    description: 'The glyph on the control that swaps the current match for the replacement text.',
  },
  'icons.replaceAll': {
    label: 'Replace all icon',
    description: 'The glyph on the control that swaps every match for the replacement text at once.',
  },
  'icons.settings': {
    label: 'Settings icon',
    description: 'The gear that opens preferences from the title bar, and a project’s own options from its pane.',
  },
  'icons.windowMinimise': {
    label: 'Minimise window icon',
    description: 'The mark on the control that drops a window out of sight without closing it.',
  },
  'icons.windowMaximise': {
    label: 'Maximise window icon',
    description: 'The mark on the control that grows a window to fill the whole display.',
  },
  'icons.windowRestore': {
    label: 'Restore window icon',
    description: 'The mark on the control that brings a filled window back to the size it was before.',
  },
  'icons.windowClose': {
    label: 'Close window icon',
    description: 'The mark on the control that shuts a window for good.',
  },
  // ── Typography ────────────────────────────────────────────────────────────────────────────────
  //
  // Ten roles, seven attributes each. Every role now carries the FULL set, because a role that exposed
  // only the attributes its author happened to pin was a role you could not italicise, however much you
  // wanted to. Each description names the surface it paints, so choosing between "tab" and "panel" does
  // not require you to already know the difference.
  'typography.paneTitle.family': {
    label: 'Font',
    description:
      'The typeface used for the PROJECTS, TERMINALS and FILES & FOLDERS headings that sit atop each pane. Leave it empty to follow the theme’s base font.',
  },
  'typography.paneTitle.sizePx': {
    label: 'Size',
    description:
      'How large the PROJECTS, TERMINALS and FILES & FOLDERS headings that sit atop each pane is drawn, in pixels. Leave it unset to track the theme’s base size.',
  },
  'typography.paneTitle.bold': {
    label: 'Bold',
    description:
      'Draw the PROJECTS, TERMINALS and FILES & FOLDERS headings that sit atop each pane in the theme’s bold weight rather than its regular one. Most fonts ship only those two, which is why this is a switch and not a dial.',
  },
  'typography.paneTitle.case': {
    label: 'Casing',
    description:
      'Leave the PROJECTS, TERMINALS and FILES & FOLDERS headings that sit atop each pane as written, or force it to Title Case, lower case or UPPER CASE.',
  },
  'typography.paneTitle.italic': {
    label: 'Italic',
    description:
      'Slant the PROJECTS, TERMINALS and FILES & FOLDERS headings that sit atop each pane.',
  },
  'typography.paneTitle.underline': {
    label: 'Underline',
    description:
      'Rule a line beneath the PROJECTS, TERMINALS and FILES & FOLDERS headings that sit atop each pane.',
  },
  'typography.paneTitle.strikethrough': {
    label: 'Strikethrough',
    description:
      'Rule a line straight through the PROJECTS, TERMINALS and FILES & FOLDERS headings that sit atop each pane.',
  },
  'typography.tab.family': {
    label: 'Font',
    description:
      'The typeface used for the name on each tab in the tab strip. Leave it empty to follow the theme’s base font.',
  },
  'typography.tab.sizePx': {
    label: 'Size',
    description:
      'How large the name on each tab in the tab strip is drawn, in pixels. Leave it unset to track the theme’s base size.',
  },
  'typography.tab.bold': {
    label: 'Bold',
    description:
      'Draw the name on each tab in the tab strip in the theme’s bold weight rather than its regular one. Most fonts ship only those two, which is why this is a switch and not a dial.',
  },
  'typography.tab.case': {
    label: 'Casing',
    description:
      'Leave the name on each tab in the tab strip as written, or force it to Title Case, lower case or UPPER CASE.',
  },
  'typography.tab.italic': {
    label: 'Italic',
    description:
      'Slant the name on each tab in the tab strip.',
  },
  'typography.tab.underline': {
    label: 'Underline',
    description:
      'Rule a line beneath the name on each tab in the tab strip.',
  },
  'typography.tab.strikethrough': {
    label: 'Strikethrough',
    description:
      'Rule a line straight through the name on each tab in the tab strip.',
  },
  'typography.panel.family': {
    label: 'Font',
    description:
      'The typeface used for the name in a panel’s own header bar. Leave it empty to follow the theme’s base font.',
  },
  'typography.panel.sizePx': {
    label: 'Size',
    description:
      'How large the name in a panel’s own header bar is drawn, in pixels. Leave it unset to track the theme’s base size.',
  },
  'typography.panel.bold': {
    label: 'Bold',
    description:
      'Draw the name in a panel’s own header bar in the theme’s bold weight rather than its regular one. Most fonts ship only those two, which is why this is a switch and not a dial.',
  },
  'typography.panel.case': {
    label: 'Casing',
    description:
      'Leave the name in a panel’s own header bar as written, or force it to Title Case, lower case or UPPER CASE.',
  },
  'typography.panel.italic': {
    label: 'Italic',
    description:
      'Slant the name in a panel’s own header bar.',
  },
  'typography.panel.underline': {
    label: 'Underline',
    description:
      'Rule a line beneath the name in a panel’s own header bar.',
  },
  'typography.panel.strikethrough': {
    label: 'Strikethrough',
    description:
      'Rule a line straight through the name in a panel’s own header bar.',
  },
  'typography.paneText.family': {
    label: 'Font',
    description:
      'The typeface used for the ordinary text inside a pane — empty states, hints, list rows. Leave it empty to follow the theme’s base font.',
  },
  'typography.paneText.sizePx': {
    label: 'Size',
    description:
      'How large the ordinary text inside a pane — empty states, hints, list rows is drawn, in pixels. Leave it unset to track the theme’s base size.',
  },
  'typography.paneText.bold': {
    label: 'Bold',
    description:
      'Draw the ordinary text inside a pane — empty states, hints, list rows in the theme’s bold weight rather than its regular one. Most fonts ship only those two, which is why this is a switch and not a dial.',
  },
  'typography.paneText.case': {
    label: 'Casing',
    description:
      'Leave the ordinary text inside a pane — empty states, hints, list rows as written, or force it to Title Case, lower case or UPPER CASE.',
  },
  'typography.paneText.italic': {
    label: 'Italic',
    description:
      'Slant the ordinary text inside a pane — empty states, hints, list rows.',
  },
  'typography.paneText.underline': {
    label: 'Underline',
    description:
      'Rule a line beneath the ordinary text inside a pane — empty states, hints, list rows.',
  },
  'typography.paneText.strikethrough': {
    label: 'Strikethrough',
    description:
      'Rule a line straight through the ordinary text inside a pane — empty states, hints, list rows.',
  },
  'typography.projectName.family': {
    label: 'Font',
    description:
      'The typeface used for a project’s name in the sidebar list. Leave it empty to follow the theme’s base font.',
  },
  'typography.projectName.sizePx': {
    label: 'Size',
    description:
      'How large a project’s name in the sidebar list is drawn, in pixels. Leave it unset to track the theme’s base size.',
  },
  'typography.projectName.bold': {
    label: 'Bold',
    description:
      'Draw a project’s name in the sidebar list in the theme’s bold weight rather than its regular one. Most fonts ship only those two, which is why this is a switch and not a dial.',
  },
  'typography.projectName.case': {
    label: 'Casing',
    description:
      'Leave a project’s name in the sidebar list as written, or force it to Title Case, lower case or UPPER CASE.',
  },
  'typography.projectName.italic': {
    label: 'Italic',
    description:
      'Slant a project’s name in the sidebar list.',
  },
  'typography.projectName.underline': {
    label: 'Underline',
    description:
      'Rule a line beneath a project’s name in the sidebar list.',
  },
  'typography.projectName.strikethrough': {
    label: 'Strikethrough',
    description:
      'Rule a line straight through a project’s name in the sidebar list.',
  },
  'typography.projectPath.family': {
    label: 'Font',
    description:
      'The typeface used for the folder path shown beneath a project’s name. Leave it empty to follow the theme’s base font.',
  },
  'typography.projectPath.sizePx': {
    label: 'Size',
    description:
      'How large the folder path shown beneath a project’s name is drawn, in pixels. Leave it unset to track the theme’s base size.',
  },
  'typography.projectPath.bold': {
    label: 'Bold',
    description:
      'Draw the folder path shown beneath a project’s name in the theme’s bold weight rather than its regular one. Most fonts ship only those two, which is why this is a switch and not a dial.',
  },
  'typography.projectPath.case': {
    label: 'Casing',
    description:
      'Leave the folder path shown beneath a project’s name as written, or force it to Title Case, lower case or UPPER CASE.',
  },
  'typography.projectPath.italic': {
    label: 'Italic',
    description:
      'Slant the folder path shown beneath a project’s name.',
  },
  'typography.projectPath.underline': {
    label: 'Underline',
    description:
      'Rule a line beneath the folder path shown beneath a project’s name.',
  },
  'typography.projectPath.strikethrough': {
    label: 'Strikethrough',
    description:
      'Rule a line straight through the folder path shown beneath a project’s name.',
  },
  'typography.editor.family': {
    label: 'Font',
    description:
      'The typeface used for the text you are editing in an Editor panel. Leave it empty to follow the theme’s base font.',
  },
  'typography.editor.sizePx': {
    label: 'Size',
    description:
      'How large the text you are editing in an Editor panel is drawn, in pixels. Leave it unset to track the theme’s base size.',
  },
  'typography.editor.bold': {
    label: 'Bold',
    description:
      'Draw the text you are editing in an Editor panel in the theme’s bold weight rather than its regular one. Most fonts ship only those two, which is why this is a switch and not a dial.',
  },
  'typography.editor.case': {
    label: 'Casing',
    description:
      'Leave the text you are editing in an Editor panel as written, or force it to Title Case, lower case or UPPER CASE.',
  },
  'typography.editor.italic': {
    label: 'Italic',
    description:
      'Slant the text you are editing in an Editor panel.',
  },
  'typography.editor.underline': {
    label: 'Underline',
    description:
      'Rule a line beneath the text you are editing in an Editor panel.',
  },
  'typography.editor.strikethrough': {
    label: 'Strikethrough',
    description:
      'Rule a line straight through the text you are editing in an Editor panel.',
  },
  'typography.terminal.family': {
    label: 'Font',
    description:
      'The typeface used for the output and input in a Terminal panel. Leave it empty to follow the theme’s base font.',
  },
  'typography.terminal.sizePx': {
    label: 'Size',
    description:
      'How large the output and input in a Terminal panel is drawn, in pixels. Leave it unset to track the theme’s base size.',
  },
  'typography.button.family': {
    label: 'Font',
    description:
      'The typeface used for the label on every button in the application. Leave it empty to follow the theme’s base font.',
  },
  'typography.button.sizePx': {
    label: 'Size',
    description:
      'How large the label on every button in the application is drawn, in pixels. Leave it unset to track the theme’s base size.',
  },
  'typography.button.bold': {
    label: 'Bold',
    description:
      'Draw the label on every button in the application in the theme’s bold weight rather than its regular one. Most fonts ship only those two, which is why this is a switch and not a dial.',
  },
  'typography.button.case': {
    label: 'Casing',
    description:
      'Leave the label on every button in the application as written, or force it to Title Case, lower case or UPPER CASE.',
  },
  'typography.button.italic': {
    label: 'Italic',
    description:
      'Slant the label on every button in the application.',
  },
  'typography.button.underline': {
    label: 'Underline',
    description:
      'Rule a line beneath the label on every button in the application.',
  },
  'typography.button.strikethrough': {
    label: 'Strikethrough',
    description:
      'Rule a line straight through the label on every button in the application.',
  },
  'typography.dialog.family': {
    label: 'Font',
    description:
      'The typeface used for dialogs, prompts and the whole Preferences window. Leave it empty to follow the theme’s base font.',
  },
  'typography.dialog.sizePx': {
    label: 'Size',
    description:
      'How large dialogs, prompts and the whole Preferences window is drawn, in pixels. Leave it unset to track the theme’s base size.',
  },
  'typography.dialog.bold': {
    label: 'Bold',
    description:
      'Draw dialogs, prompts and the whole Preferences window in the theme’s bold weight rather than its regular one. Most fonts ship only those two, which is why this is a switch and not a dial.',
  },
  'typography.dialog.case': {
    label: 'Casing',
    description:
      'Leave dialogs, prompts and the whole Preferences window as written, or force it to Title Case, lower case or UPPER CASE.',
  },
  'typography.dialog.italic': {
    label: 'Italic',
    description:
      'Slant dialogs, prompts and the whole Preferences window.',
  },
  'typography.dialog.underline': {
    label: 'Underline',
    description:
      'Rule a line beneath dialogs, prompts and the whole Preferences window.',
  },
  'typography.dialog.strikethrough': {
    label: 'Strikethrough',
    description:
      'Rule a line straight through dialogs, prompts and the whole Preferences window.',
  },
  // ── Sizes ─────────────────────────────────────────────────────────────────────────────────────
  'sizes.iconPx': {
    label: 'Icon size',
    description:
      'How large every icon in the application is drawn. Independent of any font size — icons used to grow and shrink with the text of whatever surface they happened to sit on.',
  },
  'sizes.scrollbarPx': {
    label: 'Scrollbar width',
    description:
      'How thick a scrollbar is. The browser engine offers only “thin” or “auto” for its own scrollbars, so this is a real measurement rather than a choice between two.',
  },
  'colours.errorSurface': {
    label: 'Error notice background',
    description:
      'The card an error message sits on. It has its own colour so a failure stands out from every other card in the application — a red edge on the usual background is a thin line in the corner of the screen, which is not where “your save failed” belongs.',
  },
  'colours.errorText': {
    label: 'Error notice text',
    description: 'The words on an error card, chosen to read clearly against its background.',
  },
};
