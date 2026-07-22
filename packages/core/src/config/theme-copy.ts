/**
 * Hand-written editor copy for every theme token (feature 009, FR-006/007/008; 021, US5).
 *
 * Replaces the mechanically generated "App bg" / `The "App bg" colour token.`
 * labels with human copy that names the concrete surfaces and elements each token
 * paints. Rules, asserted by theme-copy.test.ts:
 *  - words spelled in full — no abbreviation from BANNED_ABBREVIATIONS;
 *  - the description names what the token paints, never restates its identifier;
 *  - every editable token has exactly one entry (completeness);
 *  - (021, US5) every label is `"<Context> <Property>"` with `<Property>` drawn from
 *    THEME_PROPERTY_VOCABULARY — enforced by `assertNamingConvention`.
 * Pure data. No OS/DOM.
 */
import { TYPOGRAPHY_ROLES, fieldsForRole, type TypographyRole } from './theme.js';

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

/**
 * Typography copy is GENERATED, not hand-listed (ten roles × up to seven fields = seventy entries).
 * Each label is `"<Role Context> <Property>"` per the US5 convention, and each description wraps the
 * role's own surface phrase in the field's present-tense template — so the copy names the element it
 * paints without seventy chances to disagree with itself. The terminal carries only the two fields it
 * can honour (family, size), which `fieldsForRole` already encodes.
 */
const ROLE_CONTEXT: Record<TypographyRole, string> = {
  paneTitle: 'Pane Title',
  tab: 'Tab',
  // The workspace PANEL's own header bar — named "Panel Header" so it reads as a header, distinct from
  // "Pane Text" (a panel's body) and "Pane Title" (the sidebar pane headings).
  panel: 'Panel Header',
  paneText: 'Pane Text',
  projectName: 'Project Name',
  projectPath: 'Project Path',
  editor: 'Editor',
  terminal: 'Terminal',
  button: 'Button',
};

/** The concrete surface each role paints, woven into every field description. */
const ROLE_SURFACE: Record<TypographyRole, string> = {
  paneTitle: 'the PROJECTS, TERMINALS and FILES & FOLDERS headings that sit atop each sidebar pane',
  tab: 'the name on each tab in the tab strip',
  panel: 'the name in a workspace panel’s own header bar',
  paneText: 'the body text of every pane and panel — empty states, hints and list rows (never a header)',
  projectName: 'a project’s name in the sidebar list',
  projectPath: 'the folder path shown beneath a project’s name',
  editor: 'the text you are editing in an Editor panel',
  terminal: 'the output and input in a Terminal panel',
  button: 'the label on every text button in the application',
};

/** field → (property suffix for the label, description template built from the role surface). */
const FIELD_COPY: Record<string, { property: string; describe: (surface: string) => string }> = {
  family: {
    property: 'Font',
    describe: (s) => `The typeface used for ${s}. Leave it empty to follow the theme’s base font.`,
  },
  sizePx: {
    property: 'Font Size',
    describe: (s) => `How large ${s} is drawn, in pixels. Leave it unset to track the theme’s base size.`,
  },
  weight: {
    property: 'Weight',
    describe: (s) =>
      `How heavy ${s} is drawn, from 100 to 900. Leave it unset to track the theme’s base weight. Most fonts ship only two weights, so nearby values can look identical unless the font is variable.`,
  },
  case: {
    property: 'Casing',
    describe: (s) => `Leave ${s} as written, or force it to Title Case, lower case or UPPER CASE.`,
  },
  italic: { property: 'Italic', describe: (s) => `Slant ${s}.` },
  underline: { property: 'Underline', describe: (s) => `Rule a line beneath ${s}.` },
  strikethrough: { property: 'Strikethrough', describe: (s) => `Rule a line straight through ${s}.` },
};

function typographyCopy(): Record<string, TokenCopy> {
  const out: Record<string, TokenCopy> = {};
  for (const role of TYPOGRAPHY_ROLES) {
    for (const field of fieldsForRole(role)) {
      const spec = FIELD_COPY[field];
      if (!spec) continue;
      out[`typography.${role}.${field}`] = {
        label: `${ROLE_CONTEXT[role]} ${spec.property}`,
        description: spec.describe(ROLE_SURFACE[role]),
      };
    }
  }
  return out;
}

/** Hand-written label + description keyed by editable token path. */
export const THEME_TOKEN_COPY: Record<string, TokenCopy> = {
  // — Colours —
  'colours.appBg': {
    label: 'Application Background',
    description:
      'The base surface behind the whole window, showing through the gaps between panes and panels.',
  },
  'colours.sidebarBg': {
    label: 'Side Panel Background',
    description:
      'The surface behind the left side panel that holds the projects and sub-workspaces lists, and behind the Files and Folders pane.',
  },
  'colours.surface': {
    label: 'Panel Surface',
    description:
      'The body of a workspace panel, and the card a dialog, modal or notice is drawn on — lifted clear of the page beneath it.',
  },
  'colours.surfaceActive': {
    label: 'Active Surface',
    description:
      'Whatever is currently chosen — the open project, the active tab, a highlighted row — and the card a menu or dropdown floats on.',
  },
  'colours.inputSurface': {
    label: 'Field Surface',
    description: 'The well of a text box, a search field, or a chooser you can type into.',
  },
  'colours.hoverSurface': {
    label: 'Hover Surface',
    description: 'The soft wash under the pointer as it passes over a row or an icon you could click.',
  },
  'colours.menuItemHoverSurface': {
    label: 'Menu Highlight',
    description:
      'The band that follows the pointer down a list of entries. Leave it empty and it takes the open project’s own colour.',
  },
  'colours.accentText': {
    label: 'Highlighted Option Text',
    description: 'The text of a menu or dropdown option while it is hovered or selected.',
  },
  'colours.dangerText': {
    label: 'Danger Text',
    description:
      'The text or glyph on a red danger background WHILE HOVERED — the window Close button’s ✕ and the “remove” ✕ on a keybinding — kept readable against the red. It shows only on that hover.',
  },
  // These name the EDITOR's scrollbar, and say so. A setting that claims to colour every scrollbar in
  // the application, while the only classic bar the application actually draws is the editor's, is a
  // setting that lies to you every time you change it and see nothing happen.
  'colours.scrollbarTrack': {
    label: 'Scrollbar Track',
    description:
      'The channel a scrollbar slides along, on every scrollable surface in the application — panes, lists, editors, dialogs and the terminal.',
  },
  'colours.scrollbarThumb': {
    label: 'Scrollbar Thumb',
    description:
      'The draggable part you grab to move through a long list or file — on every scrollbar in the application.',
  },
  'colours.iconColour': {
    label: 'Icon Colour',
    description: 'Ink for the artwork. Leave it empty and every glyph simply takes the colour of whatever holds it.',
  },
  'colours.text': {
    label: 'Primary Text',
    description: 'The main readable colour for labels, list entries, and body copy across the interface.',
  },
  'colours.textMuted': {
    label: 'Muted Text',
    description: 'The dimmed colour for subtitles, hints, placeholder prompts, and inactive labels.',
  },
  'colours.accent': {
    label: 'Primary Accent',
    description:
      'The default highlight for focused controls, links and selected items. Note: while a project is open the app paints most of these with THAT project’s own colour instead, so this shows through mainly when no project is open.',
  },
  'colours.danger': {
    label: 'Danger Accent',
    description: 'The colour of destructive actions, error messages, and warning badges.',
  },
  'colours.success': {
    label: 'Success Accent',
    description:
      'The green cue for a healthy state: the small “loaded this session” dot on a project or sub-workspace row, and the edge of a success notice.',
  },
  'colours.railBg': {
    label: 'Collapsed Rail Background',
    description: 'The narrow strip shown when a side pane is collapsed, carrying its expand toggle.',
  },
  'colours.border': {
    label: 'Interface Border',
    description: 'The dividing lines and outlines that separate panes, panels, rows, and input fields.',
  },
  'colours.statusBarBg': {
    label: 'Status Bar Background',
    description: 'The surface behind the status bar along the bottom edge of the window.',
  },
  'colours.terminalBg': {
    label: 'Terminal Background',
    description: 'The surface behind the output of a terminal panel.',
  },
  'colours.terminalFg': {
    label: 'Terminal Text',
    description: 'The default colour of the characters printed in a terminal panel.',
  },
  'colours.terminalCursor': {
    label: 'Terminal Cursor',
    description: 'The block that marks the typing position in a terminal.',
  },
  'colours.terminalSelection': {
    label: 'Terminal Selection',
    description: 'The highlight behind text the user has selected inside a terminal.',
  },
  'colours.editorBg': {
    label: 'Editor Background',
    description: 'The surface behind the text area of the code editor panel.',
  },
  'colours.editorFg': {
    label: 'Editor Text',
    description: 'The default colour of the characters typed in the code editor panel.',
  },
  'colours.editorCursor': {
    label: 'Editor Cursor',
    description: 'The caret that marks the insertion point in the code editor.',
  },
  'colours.editorSelection': {
    label: 'Editor Selection',
    description: 'The highlight behind text the user has selected in the code editor.',
  },
  'colours.editorGutterBg': {
    label: 'Editor Gutter Background',
    description: 'The strip down the left edge of the code editor that carries the line numbers, behind those numbers.',
  },
  'colours.editorGutterFg': {
    label: 'Editor Gutter Text',
    description: 'The line numbers and fold markers printed in the code editor gutter.',
  },
  'colours.unsavedDot': {
    label: 'Unsaved Changes Marker',
    description:
      'The dot on a tab, panel, or project that has edits not yet written to disk, and the editor file and type pills.',
  },
  // Syntax highlighting (016). Each names what the colour paints in real code, so a theme author
  // can picture the result without knowing a single grammar's node names.
  'colours.syntaxKeyword': {
    label: 'Keyword Text',
    description:
      'Words the language itself reserves, such as "if", "return", "class" and "function".',
  },
  'colours.syntaxString': {
    label: 'String Text',
    description: 'Quoted text written directly into the code, including its quote marks.',
  },
  'colours.syntaxComment': {
    label: 'Comment Text',
    description:
      'Notes written for people rather than the machine — usually quieter than the code around them.',
  },
  'colours.syntaxNumber': {
    label: 'Number Text',
    description: 'Numeric values written into the code, alongside true, false and null.',
  },
  'colours.syntaxType': {
    label: 'Type Name Text',
    description: 'The names of classes, interfaces and other types the code declares or refers to.',
  },
  'colours.syntaxFunction': {
    label: 'Function Name Text',
    description: 'The names of functions and methods, both where they are defined and where they are called.',
  },
  'colours.syntaxVariable': {
    label: 'Variable Name Text',
    description: 'The names the code gives to its own values, and the properties it reads from them.',
  },
  'colours.syntaxOperator': {
    label: 'Operator Text',
    description: 'The symbols that combine values, such as plus, minus, equals and the arrow.',
  },
  'colours.syntaxPunctuation': {
    label: 'Punctuation Text',
    description:
      'The structural marks that hold code together — brackets, braces, commas and semicolons.',
  },
  'colours.syntaxInvalid': {
    label: 'Invalid Code Text',
    description: 'Text the language cannot make sense of, marked so a typo is visible at a glance.',
  },
  // The editor's own status strip (016) — distinct from the application status bar along the very
  // bottom of the window, which has its own token.
  'colours.editorStatusStripBg': {
    label: 'Editor Status Strip Surface',
    description:
      'The narrow band along the bottom of an editor panel that shows the file language — not the application status bar at the foot of the window.',
  },
  'colours.editorStatusStripFg': {
    label: 'Editor Status Strip Text',
    description:
      'The language name printed in the band along the bottom of an editor panel, which must stay readable on it.',
  },
  'colours.editorStatusStripHover': {
    label: 'Editor Status Strip Hover Background',
    description:
      'The surface that appears behind the language name when the pointer is over it, showing it can be clicked to change the language.',
  },
  'colours.searchMatch': {
    label: 'Search Match Highlight',
    description:
      'The surface tinting every occurrence of the search term in an editor or a terminal, behind text that must stay readable.',
  },
  'colours.searchMatchCurrent': {
    label: 'Current Match Highlight',
    description:
      'The stronger surface marking the one match you are presently sitting on, so it stands out from the others.',
  },
  'colours.searchMatchCurrentBorder': {
    label: 'Current Match Border',
    description:
      'The line drawn around the match you are presently on, keeping it identifiable even on a busy surface.',
  },
  'colours.activePanelBorder': {
    label: 'Active Pane Highlight',
    description:
      'The outline marking the pane or panel you are working in — the Files and Folders pane and workspace panels alike. While a project is open it is painted with THAT project’s colour, so this value shows mainly when no project is open.',
  },
  'colours.activePanelBorderInactive': {
    label: 'Inactive Pane Highlight',
    description:
      'The dimmed active-pane highlight, shown while this window is in the background so the marker stays visible without competing for attention.',
  },
  // — Buttons (021, US7). Three types, six tokens each — replacing the single legacy button pair. —
  'colours.confirmButtonBg': {
    label: 'Confirm Button Background',
    description: 'The resting surface of a confirming button — Save, OK, Apply — on a dialog or form.',
  },
  'colours.confirmButtonHoverBg': {
    label: 'Confirm Button Hover Background',
    description: 'The surface of a confirming button while the pointer hovers over it.',
  },
  'colours.confirmButtonBorder': {
    label: 'Confirm Button Border',
    description: 'The outline around a confirming button at rest.',
  },
  'colours.confirmButtonHoverBorder': {
    label: 'Confirm Button Hover Border',
    description: 'The outline around a confirming button while the pointer hovers over it.',
  },
  'colours.confirmButtonText': {
    label: 'Confirm Button Text',
    description: 'The label colour of a confirming button at rest.',
  },
  'colours.confirmButtonHoverText': {
    label: 'Confirm Button Hover Text',
    description: 'The label colour of a confirming button while the pointer hovers over it.',
  },
  'colours.cancelButtonBg': {
    label: 'Cancel Button Background',
    description: 'The resting surface of a dismissing button — Cancel, Close, Clear — on a dialog or form.',
  },
  'colours.cancelButtonHoverBg': {
    label: 'Cancel Button Hover Background',
    description: 'The surface of a dismissing button while the pointer hovers over it.',
  },
  'colours.cancelButtonBorder': {
    label: 'Cancel Button Border',
    description: 'The outline around a dismissing button at rest.',
  },
  'colours.cancelButtonHoverBorder': {
    label: 'Cancel Button Hover Border',
    description: 'The outline around a dismissing button while the pointer hovers over it.',
  },
  'colours.cancelButtonText': {
    label: 'Cancel Button Text',
    description: 'The label colour of a dismissing button at rest.',
  },
  'colours.cancelButtonHoverText': {
    label: 'Cancel Button Hover Text',
    description: 'The label colour of a dismissing button while the pointer hovers over it.',
  },
  'colours.destroyButtonBg': {
    label: 'Destroy Button Background',
    description: 'The resting surface of a destructive button — Delete, Reset, Terminate — on a dialog or form.',
  },
  'colours.destroyButtonHoverBg': {
    label: 'Destroy Button Hover Background',
    description: 'The surface of a destructive button while the pointer hovers over it.',
  },
  'colours.destroyButtonBorder': {
    label: 'Destroy Button Border',
    description: 'The outline around a destructive button at rest.',
  },
  'colours.destroyButtonHoverBorder': {
    label: 'Destroy Button Hover Border',
    description: 'The outline around a destructive button while the pointer hovers over it.',
  },
  'colours.destroyButtonText': {
    label: 'Destroy Button Text',
    description: 'The label colour of a destructive button at rest.',
  },
  'colours.destroyButtonHoverText': {
    label: 'Destroy Button Hover Text',
    description: 'The label colour of a destructive button while the pointer hovers over it.',
  },

  // — Fonts —
  'fonts.family': {
    label: 'Application Font',
    description: 'The typeface used for interface text wherever a section does not override it.',
  },
  'fonts.baseSizePx': {
    label: 'Base Font Size',
    description: 'The default text height, in pixels, that unpinned sections scale from.',
  },
  'fonts.weights.normal': {
    label: 'Normal Font Weight',
    description: 'The stroke thickness of ordinary, unemphasised interface text.',
  },
  'fonts.weights.bold': {
    label: 'Bold Font Weight',
    description: 'The stroke thickness applied to emphasised interface text.',
  },

  // — Typography roles — generated below (spread in) to the US5 convention.
  ...typographyCopy(),

  // — Icons — (named nouns; exempt from the property suffix, so labels read as the thing they mark) —
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
  'icons.cut': {
    label: 'Cut icon',
    description:
      'The glyph on the menu row that lifts the selected text or files onto the clipboard and removes them from where they were.',
  },
  'icons.copy': {
    label: 'Copy icon',
    description:
      'The glyph on the menu row that places the selected text or files onto the clipboard, leaving the originals in place.',
  },
  'icons.paste': {
    label: 'Paste icon',
    description:
      'The glyph on the menu row that drops whatever the clipboard holds in at the cursor or the chosen folder.',
  },
  'icons.selectAll': {
    label: 'Select all icon',
    description: 'The glyph on the menu row that highlights the whole document at once, ready to act on together.',
  },
  'icons.undo': {
    label: 'Undo icon',
    description: 'The glyph on the editor menu row that steps the last change back out of the document.',
  },
  'icons.redo': {
    label: 'Redo icon',
    description: 'The glyph on the editor menu row that reapplies a change you had just stepped back out.',
  },
  'icons.language': {
    label: 'Set language icon',
    description: 'The glyph on the editor menu row that opens the picker for which language colours and folds the file.',
  },
  'icons.keybindings': {
    label: 'Key bindings icon',
    description: 'The glyph on the title-bar menu row that opens the editor for the keyboard shortcuts you can rebind.',
  },
  'icons.themes': {
    label: 'Themes icon',
    description: 'The glyph on the title-bar menu row that opens the editor for the colours, fonts, and glyphs the app wears.',
  },
  'icons.about': {
    label: 'About icon',
    description: 'The glyph on the title-bar menu row that opens the window naming the release and its build details.',
  },
  'icons.hide': {
    label: 'Hide entry icon',
    description: 'The glyph on the tree menu row that drops a file or folder out of view for this project only.',
  },
  'icons.resetName': {
    label: 'Reset name icon',
    description: 'The glyph on the menu row that returns a renamed tab or project to the name it started with.',
  },
  // ── Sizes ─────────────────────────────────────────────────────────────────────────────────────
  'sizes.iconPx': {
    label: 'Icon Size',
    description:
      'How large every icon in the application is drawn. Independent of any font size — icons used to grow and shrink with the text of whatever surface they happened to sit on.',
  },
  'sizes.scrollbarPx': {
    label: 'Scrollbar Width',
    description:
      'How thick a scrollbar is. The browser engine offers only “thin” or “auto” for its own scrollbars, so this is a real measurement rather than a choice between two.',
  },
  'colours.errorSurface': {
    label: 'Error Notice Surface',
    description:
      'The card an error message sits on. It has its own colour so a failure stands out from every other card in the application — a red edge on the usual background is a thin line in the corner of the screen, which is not where “your save failed” belongs.',
  },
  'colours.errorText': {
    label: 'Error Notice Text',
    description: 'The words on an error card, chosen to read clearly against its background.',
  },
};
