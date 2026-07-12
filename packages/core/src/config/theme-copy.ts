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
    description: 'The raised surface of panels, list rows, and cards that sit above the application background.',
  },
  'colours.surfaceActive': {
    label: 'Active surface',
    description: 'The surface of the selected row, the hovered panel, or a pressed control.',
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
  'typography.paneTitle.family': {
    label: 'Pane heading font family',
    description: 'The typeface of the uppercase pane headings such as PROJECTS and TERMINALS.',
  },
  'typography.paneTitle.sizePx': {
    label: 'Pane heading font size',
    description: 'The text height of the uppercase pane headings.',
  },
  'typography.paneTitle.weight': {
    label: 'Pane heading font weight',
    description: 'The stroke thickness of the uppercase pane headings.',
  },
  'typography.paneTitle.case': {
    label: 'Pane heading letter casing',
    description: 'Whether the pane headings render in original, capitalised, lower, or upper letters.',
  },
  'typography.tab.family': {
    label: 'Tab label font family',
    description: 'The typeface of the name shown on each workspace tab.',
  },
  'typography.tab.weight': {
    label: 'Tab label font weight',
    description: 'The stroke thickness of the name shown on each workspace tab.',
  },
  'typography.panel.family': {
    label: 'Panel heading font family',
    description: 'The typeface of the title shown at the top of each panel.',
  },
  'typography.panel.weight': {
    label: 'Panel heading font weight',
    description: 'The stroke thickness of the title shown at the top of each panel.',
  },
  'typography.projectName.family': {
    label: 'Project name font family',
    description: "The typeface of a project's name in the projects list.",
  },
  'typography.projectName.weight': {
    label: 'Project name font weight',
    description: "The stroke thickness of a project's name in the projects list.",
  },
  'typography.projectPath.family': {
    label: 'Project path font family',
    description: "The typeface of the folder path shown beneath a project's name.",
  },
  'typography.projectPath.sizePx': {
    label: 'Project path font size',
    description: "The text height of the folder path shown beneath a project's name.",
  },
  'typography.button.family': {
    label: 'Button font family',
    description: 'The typeface of push button labels.',
  },
  'typography.button.weight': {
    label: 'Button font weight',
    description: 'The stroke thickness of push button labels.',
  },
  'typography.editor.family': {
    label: 'Editor font family',
    description: 'The typeface of text inside the code editor, a monospace face by default.',
  },
  'typography.editor.sizePx': {
    label: 'Editor font size',
    description: 'The text height inside the code editor.',
  },
  'typography.terminal.family': {
    label: 'Terminal font family',
    description: 'The typeface of text inside terminals, a monospace face by default.',
  },
  'typography.terminal.sizePx': {
    label: 'Terminal font size',
    description: 'The text height inside terminals.',
  },
  'typography.paneText.family': {
    label: 'Pane body font family',
    description: 'The typeface of inner pane and panel text such as empty-state messages.',
  },

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
};
