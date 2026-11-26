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
  paneTitle: 'the heading atop each sidebar pane',
  tab: 'the name on each tab',
  panel: 'the name in a panel’s header bar',
  paneText: 'the body text of panes and panels',
  projectName: 'a project’s name in the sidebar',
  projectPath: 'a project’s folder path',
  editor: 'the text in an Editor panel',
  terminal: 'the text in a Terminal panel',
  button: 'every text button’s label',
};

/** field → (property suffix for the label, description template built from the role surface). */
const FIELD_COPY: Record<string, { property: string; describe: (surface: string) => string }> = {
  family: {
    property: 'Font',
    describe: (s) => `The typeface for ${s}. Empty follows the theme’s base font.`,
  },
  sizePx: {
    property: 'Font Size',
    describe: (s) => `Size of ${s} in pixels. Unset tracks the theme’s base size.`,
  },
  weight: {
    // 080 FR-013 — the note that most fonts ship only two weights lives in the theme settings reference.
    property: 'Weight',
    describe: (s) => `Weight of ${s}, 100 to 900. Unset tracks the theme’s base weight.`,
  },
  case: {
    property: 'Casing',
    describe: (s) => `Casing of ${s}: as written, Title Case, lower case or UPPER CASE.`,
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
      'The surface behind the projects and sub-workspaces lists, and behind the File Explorer pane.',
  },
  'colours.surface': {
    label: 'Panel Surface',
    description:
      'The body of a workspace panel, and the card under a dialog, modal or notice.',
  },
  'colours.surfaceActive': {
    label: 'Active Surface',
    description:
      'Whatever you have chosen, such as the active tab, and the card under a menu or dropdown.',
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
      'The band that follows the pointer down a list of entries. Empty takes the open project\'s colour.',
  },
  'colours.linkUnderline': {
    label: 'Link Underline',
    description:
      'The dashed underline marking a link in an editor or terminal. Unset, it follows the accent colour.',
  },
  'colours.linkUnderlineHover': {
    label: 'Link Hover Underline',
    description:
      'The solid underline a link takes while the pointer is over it. Unset, it follows the link underline.',
  },
  // The link hint's three tokens (045 FR-165g), widened to every popup by constitution v6.7.0. The keys keep their
  // names so theme files written since 045 still apply.
  'colours.linkHintBackground': {
    label: 'Popup Background',
    description:
      'Every tooltip, hover popover and hint. Unset, it follows the raised surface colour.',
  },
  'colours.linkHintText': {
    label: 'Popup Text',
    description: 'The text of every tooltip, popover and hint. Unset, it follows the body text colour.',
  },
  'colours.linkHintBorder': {
    label: 'Popup Border',
    description: 'The hairline edge of every tooltip, popover and hint. Unset, it follows the border colour.',
  },
  'colours.accentText': {
    label: 'Highlighted Option Text',
    description: 'The text of a menu or dropdown option while you hover over or select it.',
  },
  'colours.dangerText': {
    label: 'Danger Text',
    description:
      'The text or glyph on a red danger background while hovered, such as the window Close button\'s cross.',
  },
  // These name the EDITOR's scrollbar, and say so. A setting that claims to colour every scrollbar in
  // the application, while the only classic bar the application actually draws is the editor's, is a
  // setting that lies to you every time you change it and see nothing happen.
  'colours.scrollbarTrack': {
    label: 'Scrollbar Track',
    description:
      'The channel a scrollbar slides along, on every scrollable surface in the application.',
  },
  'colours.scrollbarThumb': {
    label: 'Scrollbar Thumb',
    description:
      'The draggable part of every scrollbar, grabbed to move through a long list or file.',
  },
  'colours.fileIconCode': {
    label: 'Code File Icons',
    description:
      'Icons for source code, such as TypeScript, Python or C#. Empty takes the Icon Colour.',
  },
  'colours.fileIconMarkup': {
    label: 'Markup File Icons',
    description:
      'Icons for web pages and their styles: HTML, CSS and Sass. Empty takes the Icon Colour.',
  },
  'colours.fileIconData': {
    label: 'Data File Icons',
    description:
      'Icons for data and settings files, spreadsheets, databases and SQL. Empty takes the Icon Colour.',
  },
  'colours.fileIconDocument': {
    label: 'Document File Icons',
    description:
      'Icons for plain text, Markdown and diffs. Empty takes the Icon Colour.',
  },
  'colours.fileIconMedia': {
    label: 'Media File Icons',
    description:
      'Icons for images, sound, video, fonts and 3D models. Empty takes the Icon Colour.',
  },
  'colours.fileIconArchive': {
    label: 'Archive File Icons',
    description:
      'Icons for archives and installers. Empty takes the Icon Colour.',
  },
  'colours.fileIconScript': {
    label: 'Script File Icons',
    description:
      'Icons for shell and PowerShell scripts, keys and certificates. Empty takes the Icon Colour.',
  },
  'colours.fileIconOther': {
    label: 'Other File Icons',
    description:
      'The icon for a file whose kind throng does not recognise. Empty takes the Icon Colour.',
  },
  'colours.pictureCanvas': {
    label: 'Picture Preview Background',
    description:
      'The background an Image or SVG preview draws its picture on. Empty derives it from the editor.',
  },
  'colours.pictureHatch': {
    label: 'Picture Transparency Marker',
    description:
      'The hatching behind transparent parts of a picture in a preview. Empty mixes the editor colours.',
  },
  // 075 FR-021 — the seven callout colour roles. Each names the callout types it colours (registry, FR-019).
  'colours.calloutNeutral': {
    label: 'Neutral Callout Accent',
    description:
      'The border, icon, title and tint of note and quote callouts in a document preview.',
  },
  'colours.calloutInfo': {
    label: 'Information Callout Accent',
    description:
      'The border, icon, title and tint of abstract, info and todo callouts in a document preview.',
  },
  'colours.calloutAccent': {
    label: 'Highlight Callout Accent',
    description:
      'The border, icon, title and tint of tip and example callouts in a document preview.',
  },
  'colours.calloutSuccess': {
    label: 'Success Callout Accent',
    description:
      'The border, icon, title and tint of success callouts in a document preview.',
  },
  'colours.calloutQuestion': {
    label: 'Question Callout Accent',
    description:
      'The border, icon, title and tint of question callouts in a document preview.',
  },
  'colours.calloutWarning': {
    label: 'Warning Callout Accent',
    description:
      'The border, icon, title and tint of warning callouts in a document preview.',
  },
  'colours.calloutDanger': {
    label: 'Danger Callout Accent',
    description:
      'The border, icon, title and tint of failure, danger and bug callouts in a document preview.',
  },
  'colours.titleBarSurface': {
    label: 'Title Bar Background',
    description:
      'The bar across the top of every window. Empty sets it a shade apart from the window background.',
  },
  'colours.iconButtonSurface': {
    label: 'Icon Button Background',
    description:
      'What an icon button sits on before you point at it. Empty shows its icon alone until then.',
  },
  'colours.iconColour': {
    label: 'Icon Colour',
    description: 'Ink for the artwork. Leave it empty and each glyph takes the colour of whatever holds it.',
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
      'The default highlight for focused controls, links and selected items, when no project is open.',
  },
  'colours.danger': {
    label: 'Danger Accent',
    description: 'The colour of destructive actions, error messages, and warning badges.',
  },
  'colours.success': {
    label: 'Success Accent',
    description:
      'The green cue for a healthy state, such as a project\'s loaded dot and a success notice\'s edge.',
  },
  'colours.warning': {
    label: 'Warning Accent',
    description:
      'The amber cue for something that went ahead but not as asked, such as a warning notice\'s edge.',
  },
  'colours.attentionMark': {
    label: 'Attention Marker',
    description:
      'The circle on a panel, tab, project or category that needs you, and the count on the taskbar icon.',
  },
  'colours.railBg': {
    label: 'Collapsed Rail Background',
    description: 'The narrow strip a collapsed side pane leaves, carrying its expand toggle.',
  },
  'colours.categoryHeaderBackground': {
    label: 'Category Header Background',
    description:
      'The strip behind a category name in the Projects pane. Unset, it follows the raised surface colour.',
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
  'colours.editorSelectionInactive': {
    label: 'Editor Inactive Selection',
    description:
      'A quieter highlight that keeps an editor or preview selection visible while another panel is active.',
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
      'The dot on a tab, panel or project with unsaved edits, and the editor file and type pills.',
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
    description: 'Quoted text in the code, quote marks included.',
  },
  'colours.syntaxComment': {
    label: 'Comment Text',
    description:
      'Notes in the code for the people who read it, often quieter than the code around them.',
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
    description: 'The names of functions and methods, where code defines them and where it calls them.',
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
      'The marks that hold code together: brackets, braces, commas and semicolons.',
  },
  'colours.syntaxInvalid': {
    label: 'Invalid Code Text',
    description: 'Text the language cannot make sense of, marked so a typo is visible at a glance.',
  },
  // The panel status bar (016, the editor's; 044 FR-118a, the preview's too) — distinct from the application
  // status bar along the very bottom of the window, which has its own token. Labelled in Settings' vocabulary
  // (040 FR-034a, #320): "status bar", and the PANEL status bar since 044 FR-118f. The keys keep their names.
  'colours.editorStatusStripBg': {
    label: 'Panel Status Bar Surface',
    description:
      'The bar along the bottom of editor and preview panels, not the window\'s status bar.',
  },
  'colours.editorStatusStripFg': {
    label: 'Panel Status Bar Text',
    description: 'The text on the panel status bar, which must stay readable on it.',
  },
  'colours.editorStatusStripHover': {
    label: 'Panel Status Bar Hover Background',
    description: 'Behind a panel status bar control while the pointer is over it, to show you can click it.',
  },
  'colours.searchMatch': {
    label: 'Search Match Highlight',
    description:
      'The surface tinting every occurrence of the search term in an editor or a terminal.',
  },
  'colours.searchMatchCurrent': {
    label: 'Current Match Highlight',
    description:
      'The stronger surface marking the one match you are on, so it stands out from the others.',
  },
  'colours.searchMatchCurrentBorder': {
    label: 'Current Match Border',
    description:
      'The line drawn around the match you are on, keeping it identifiable on a busy surface.',
  },
  'colours.searchMatchBorder': {
    label: 'Search Match Border',
    description:
      'The thin line drawn around every other match in an editor or a preview.',
  },
  'colours.searchMatchOccurrence': {
    label: 'Selection Occurrence Highlight',
    description:
      'The soft tint on the other places the selected text appears in the editor or preview.',
  },
  'colours.searchMatchOccurrenceInactive': {
    label: 'Inactive Selection Occurrence Highlight',
    description:
      'A weaker version of that tint, shown while the panel holding the selection is not active.',
  },
  'colours.activePanelBorder': {
    label: 'Active Pane Highlight',
    description:
      'The outline marking the pane or panel you are working in, when no project\'s colour replaces it.',
  },
  'colours.activePanelBorderInactive': {
    label: 'Inactive Pane Highlight',
    description:
      'The dimmed active-pane highlight, shown while this window is in the background.',
  },
  // — Buttons (021, US7). Three types, six tokens each — replacing the single legacy button pair. —
  'colours.confirmButtonBg': {
    label: 'Confirm Button Background',
    description: 'The resting surface of a confirming button (Save, OK, Apply) on a dialog or form.',
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
    description: 'The resting surface of a dismissing button (Cancel, Close, Clear) on a dialog or form.',
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
    description: 'The resting surface of a destructive button (Delete, Reset, Terminate) on a dialog or form.',
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
  // ── Sizes ─────────────────────────────────────────────────────────────────────────────────────
  'sizes.iconPx': {
    label: 'Icon Size',
    description:
      'The size of every icon in throng, whatever the font size.',
  },
  'sizes.scrollbarPx': {
    label: 'Scrollbar Width',
    description:
      'How thick a scrollbar is, as a real measurement.',
  },
  'sizes.ignoredEntryOpacity': {
    label: 'Ignored Entry Opacity',
    description:
      'How strongly the File Explorer draws a file or folder git ignores. Lower fades it further; 1 draws it like any other.',
  },
  'colours.errorSurface': {
    label: 'Error Notice Surface',
    description:
      'The card an error message sits on, so a failure stands out from every other card.',
  },
  'colours.errorText': {
    label: 'Error Notice Text',
    description: 'The words on an error card, picked to read against its background.',
  },
};
