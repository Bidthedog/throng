[throng](../README.md) › [Docs](README.md) › Theme settings

# Theme settings

Every setting a theme carries, in the areas the **Themes** tab groups them by. Each has a section of its own:
its label, its key (its name in a theme file) and its one-line description as the Themes tab shows
it, then any detail beyond that. The **?** beside a setting in the Themes tab opens its section.

Every bundled theme gives each setting its own value; choosing, cloning and editing themes is in
[Themes and icon sets](preferences.md#themes-and-icon-sets).

## General

### Application Background

**Cog › Themes › General**

`colours.appBg`

The base surface behind the whole window, showing through the gaps between panes and panels.

### Panel Surface

**Cog › Themes › General**

`colours.surface`

The body of a workspace panel, and the card under a dialog, modal or notice.

### Active Surface

**Cog › Themes › General**

`colours.surfaceActive`

Whatever you have chosen, such as the active tab, and the card under a menu or dropdown.

### Field Surface

**Cog › Themes › General**

`colours.inputSurface`

The well of a text box, a search field, or a chooser you can type into.

### Hover Surface

**Cog › Themes › General**

`colours.hoverSurface`

The soft wash under the pointer as it passes over a row or an icon you could click.

### Highlighted Option Text

**Cog › Themes › General**

`colours.accentText`

The text of a menu or dropdown option while you hover over or select it.

### Danger Text

**Cog › Themes › General**

`colours.dangerText`

The text or glyph on a red danger background while hovered, such as the window Close button's cross.

The text or glyph on a red danger background WHILE HOVERED: the window Close button’s ✕ and the “remove” ✕ on a keybinding, readable against the red. It shows only on that hover.

### Primary Text

**Cog › Themes › General**

`colours.text`

The main readable colour for labels, list entries, and body copy across the interface.

### Muted Text

**Cog › Themes › General**

`colours.textMuted`

The dimmed colour for subtitles, hints, placeholder prompts, and inactive labels.

### Primary Accent

**Cog › Themes › General**

`colours.accent`

The default highlight for focused controls, links and selected items, when no project is open.

The default highlight for focused controls, links and selected items. Note: while a project is open the app paints most of these with THAT project’s own colour instead, so this shows through mainly when no project is open.

### Link Underline

**Cog › Themes › General**

`colours.linkUnderline`

The dashed underline marking a link in an editor or terminal. Unset, it follows the accent colour.

### Link Hover Underline

**Cog › Themes › General**

`colours.linkUnderlineHover`

The solid underline a link takes while the pointer is over it. Unset, it follows the link underline.

### Popup Background

**Cog › Themes › General**

`colours.linkHintBackground`

Every tooltip, hover popover and hint. Unset, it follows the raised surface colour.

Every tooltip, hover popover and hint, including the hint a plain click on a link shows. Unset, it follows the raised surface colour.

### Popup Text

**Cog › Themes › General**

`colours.linkHintText`

The text of every tooltip, popover and hint. Unset, it follows the body text colour.

### Popup Border

**Cog › Themes › General**

`colours.linkHintBorder`

The hairline edge of every tooltip, popover and hint. Unset, it follows the border colour.

### Danger Accent

**Cog › Themes › General**

`colours.danger`

The colour of destructive actions, error messages, and warning badges.

### Error Notice Surface

**Cog › Themes › General**

`colours.errorSurface`

The card an error message sits on, so a failure stands out from every other card.

The card an error message sits on. It has its own colour so a failure stands out from every other card in throng. A red edge on the usual background would leave “your save failed” as a thin line in a corner of the screen.

### Error Notice Text

**Cog › Themes › General**

`colours.errorText`

The words on an error card, picked to read against its background.

### Success Accent

**Cog › Themes › General**

`colours.success`

The green cue for a healthy state, such as a project's loaded dot and a success notice's edge.

### Warning Accent

**Cog › Themes › General**

`colours.warning`

The amber cue for something that went ahead but not as asked, such as a warning notice's edge.

The amber cue for something that went ahead differently from how you asked: the edge of a warning notice, such as a panel name that had to be adjusted because it was already taken.

### Attention Marker

**Cog › Themes › General**

`colours.attentionMark`

The circle on a panel, tab, project or category that needs you, and the count on the taskbar icon.

The colour of the circle on a panel, tab, project or category that needs you, and of the count on the taskbar icon. Its number is drawn in black or white, whichever reads on it. Distinct from the brief flash a panel gives when it is brought into view.

### Scrollbar Track

**Cog › Themes › General**

`colours.scrollbarTrack`

The channel a scrollbar slides along, on every scrollable surface in the application.

The channel a scrollbar slides along, on every scrollable surface in throng: panes, lists, editors, dialogs and the terminal.

### Scrollbar Thumb

**Cog › Themes › General**

`colours.scrollbarThumb`

The draggable part of every scrollbar, grabbed to move through a long list or file.

### Interface Border

**Cog › Themes › General**

`colours.border`

The dividing lines and outlines that separate panes, panels, rows, and input fields.

### Status Bar Background

**Cog › Themes › General**

`colours.statusBarBg`

The surface behind the status bar along the bottom edge of the window.

### Unsaved Changes Marker

**Cog › Themes › General**

`colours.unsavedDot`

The dot on a tab, panel or project with unsaved edits, and the editor file and type pills.

### Application Font

**Cog › Themes › General**

`fonts.family`

The typeface used for interface text wherever a section does not override it.

### Base Font Size

**Cog › Themes › General**

`fonts.baseSizePx`

The default text height, in pixels, that unpinned sections scale from.

### Normal Font Weight

**Cog › Themes › General**

`fonts.weights.normal`

The stroke thickness of ordinary, unemphasised interface text.

### Bold Font Weight

**Cog › Themes › General**

`fonts.weights.bold`

The stroke thickness applied to emphasised interface text.

### Icon Size

**Cog › Themes › General**

`sizes.iconPx`

The size of every icon in throng, whatever the font size.

The size of every icon in throng, whatever the font size. Icons used to grow and shrink with the text of the surface they sat on.

### Scrollbar Width

**Cog › Themes › General**

`sizes.scrollbarPx`

How thick a scrollbar is, as a real measurement.

How thick a scrollbar is. The browser engine offers “thin” or “auto” for its own scrollbars; this setting gives you a real measurement instead.

### Menu Highlight

**Cog › Themes › General**

`colours.menuItemHoverSurface`

The band that follows the pointer down a list of entries. Empty takes the open project's colour.

### Title Bar Background

**Cog › Themes › General**

`colours.titleBarSurface`

The bar across the top of every window. Empty sets it a shade apart from the window background.

The bar across the top of every window, under its title and window controls. Leave it empty and the bar is a shade apart from the window background, lighter on a dark theme and darker on a light one.

### Button Font

**Cog › Themes › General**

`typography.button.family`

The typeface for every text button’s label. Empty follows the theme’s base font.

### Button Font Size

**Cog › Themes › General**

`typography.button.sizePx`

Size of every text button’s label in pixels. Unset tracks the theme’s base size.

How large the label on every text button in the application is drawn, in pixels. Leave it unset to track the theme’s base size.

### Button Weight

**Cog › Themes › General**

`typography.button.weight`

Weight of every text button’s label, 100 to 900. Unset tracks the theme’s base weight.

How heavy the label on every text button in the application is drawn, from 100 to 900. Leave it unset to track the theme’s base weight. Most fonts ship only two weights, so nearby values can look identical unless the font is variable.

### Button Casing

**Cog › Themes › General**

`typography.button.case`

Casing of every text button’s label: as written, Title Case, lower case or UPPER CASE.

### Button Italic

**Cog › Themes › General**

`typography.button.italic`

Slant every text button’s label.

### Button Underline

**Cog › Themes › General**

`typography.button.underline`

Rule a line beneath every text button’s label.

### Button Strikethrough

**Cog › Themes › General**

`typography.button.strikethrough`

Rule a line straight through every text button’s label.

### Icon Button Background

**Cog › Themes › General**

`colours.iconButtonSurface`

What an icon button sits on before you point at it. Empty shows its icon alone until then.

What an icon button sits on before you point at it, in every window. Leave it empty and icon buttons show only their icon until the pointer reaches them.

### Confirm Button Background

**Cog › Themes › General**

`colours.confirmButtonBg`

The resting surface of a confirming button (Save, OK, Apply) on a dialog or form.

### Confirm Button Border

**Cog › Themes › General**

`colours.confirmButtonBorder`

The outline around a confirming button at rest.

### Confirm Button Text

**Cog › Themes › General**

`colours.confirmButtonText`

The label colour of a confirming button at rest.

### Confirm Button Hover Background

**Cog › Themes › General**

`colours.confirmButtonHoverBg`

The surface of a confirming button while the pointer hovers over it.

### Confirm Button Hover Border

**Cog › Themes › General**

`colours.confirmButtonHoverBorder`

The outline around a confirming button while the pointer hovers over it.

### Confirm Button Hover Text

**Cog › Themes › General**

`colours.confirmButtonHoverText`

The label colour of a confirming button while the pointer hovers over it.

### Cancel Button Background

**Cog › Themes › General**

`colours.cancelButtonBg`

The resting surface of a dismissing button (Cancel, Close, Clear) on a dialog or form.

### Cancel Button Border

**Cog › Themes › General**

`colours.cancelButtonBorder`

The outline around a dismissing button at rest.

### Cancel Button Text

**Cog › Themes › General**

`colours.cancelButtonText`

The label colour of a dismissing button at rest.

### Cancel Button Hover Background

**Cog › Themes › General**

`colours.cancelButtonHoverBg`

The surface of a dismissing button while the pointer hovers over it.

### Cancel Button Hover Border

**Cog › Themes › General**

`colours.cancelButtonHoverBorder`

The outline around a dismissing button while the pointer hovers over it.

### Cancel Button Hover Text

**Cog › Themes › General**

`colours.cancelButtonHoverText`

The label colour of a dismissing button while the pointer hovers over it.

### Destroy Button Background

**Cog › Themes › General**

`colours.destroyButtonBg`

The resting surface of a destructive button (Delete, Reset, Terminate) on a dialog or form.

### Destroy Button Border

**Cog › Themes › General**

`colours.destroyButtonBorder`

The outline around a destructive button at rest.

### Destroy Button Text

**Cog › Themes › General**

`colours.destroyButtonText`

The label colour of a destructive button at rest.

### Destroy Button Hover Background

**Cog › Themes › General**

`colours.destroyButtonHoverBg`

The surface of a destructive button while the pointer hovers over it.

### Destroy Button Hover Border

**Cog › Themes › General**

`colours.destroyButtonHoverBorder`

The outline around a destructive button while the pointer hovers over it.

### Destroy Button Hover Text

**Cog › Themes › General**

`colours.destroyButtonHoverText`

The label colour of a destructive button while the pointer hovers over it.

## Editor

### Editor Background

**Cog › Themes › Editor**

`colours.editorBg`

The surface behind the text area of the code editor panel.

### Editor Text

**Cog › Themes › Editor**

`colours.editorFg`

The default colour of the characters typed in the code editor panel.

### Editor Cursor

**Cog › Themes › Editor**

`colours.editorCursor`

The caret that marks the insertion point in the code editor.

### Editor Selection

**Cog › Themes › Editor**

`colours.editorSelection`

The highlight behind text the user has selected in the code editor.

### Editor Inactive Selection

**Cog › Themes › Editor**

`colours.editorSelectionInactive`

A quieter highlight that keeps an editor or preview selection visible while another panel is active.

A quieter highlight that keeps a selection visible in an editor or preview after you click into another panel, until you change it.

### Editor Gutter Background

**Cog › Themes › Editor**

`colours.editorGutterBg`

The strip down the left edge of the code editor that carries the line numbers, behind those numbers.

### Editor Gutter Text

**Cog › Themes › Editor**

`colours.editorGutterFg`

The line numbers and fold markers printed in the code editor gutter.

### Panel Status Bar Surface

**Cog › Themes › Editor**

`colours.editorStatusStripBg`

The bar along the bottom of editor and preview panels, not the window's status bar.

### Panel Status Bar Text

**Cog › Themes › Editor**

`colours.editorStatusStripFg`

The text on the panel status bar, which must stay readable on it.

### Panel Status Bar Hover Background

**Cog › Themes › Editor**

`colours.editorStatusStripHover`

Behind a panel status bar control while the pointer is over it, to show you can click it.

### Editor Font

**Cog › Themes › Editor**

`typography.editor.family`

The typeface for the text in an Editor panel. Empty follows the theme’s base font.

### Editor Font Size

**Cog › Themes › Editor**

`typography.editor.sizePx`

Size of the text in an Editor panel in pixels. Unset tracks the theme’s base size.

How large the text you are editing in an Editor panel is drawn, in pixels. Leave it unset to track the theme’s base size.

### Editor Weight

**Cog › Themes › Editor**

`typography.editor.weight`

Weight of the text in an Editor panel, 100 to 900. Unset tracks the theme’s base weight.

How heavy the text you are editing in an Editor panel is drawn, from 100 to 900. Leave it unset to track the theme’s base weight. Most fonts ship only two weights, so nearby values can look identical unless the font is variable.

### Keyword Text

**Cog › Themes › Editor**

`colours.syntaxKeyword`

Words the language itself reserves, such as "if", "return", "class" and "function".

### String Text

**Cog › Themes › Editor**

`colours.syntaxString`

Quoted text in the code, quote marks included.

### Comment Text

**Cog › Themes › Editor**

`colours.syntaxComment`

Notes in the code for the people who read it, often quieter than the code around them.

### Number Text

**Cog › Themes › Editor**

`colours.syntaxNumber`

Numeric values written into the code, alongside true, false and null.

### Type Name Text

**Cog › Themes › Editor**

`colours.syntaxType`

The names of classes, interfaces and other types the code declares or refers to.

### Function Name Text

**Cog › Themes › Editor**

`colours.syntaxFunction`

The names of functions and methods, where code defines them and where it calls them.

### Variable Name Text

**Cog › Themes › Editor**

`colours.syntaxVariable`

The names the code gives to its own values, and the properties it reads from them.

### Operator Text

**Cog › Themes › Editor**

`colours.syntaxOperator`

The symbols that combine values, such as plus, minus, equals and the arrow.

### Punctuation Text

**Cog › Themes › Editor**

`colours.syntaxPunctuation`

The marks that hold code together: brackets, braces, commas and semicolons.

### Invalid Code Text

**Cog › Themes › Editor**

`colours.syntaxInvalid`

Text the language cannot make sense of, marked so a typo is visible at a glance.

## Markdown preview

### Neutral Callout Accent

**Cog › Themes › Markdown preview**

`colours.calloutNeutral`

The border, icon, title and tint of note and quote callouts in a document preview.

### Information Callout Accent

**Cog › Themes › Markdown preview**

`colours.calloutInfo`

The border, icon, title and tint of abstract, info and todo callouts in a document preview.

### Highlight Callout Accent

**Cog › Themes › Markdown preview**

`colours.calloutAccent`

The border, icon, title and tint of tip and example callouts in a document preview.

### Success Callout Accent

**Cog › Themes › Markdown preview**

`colours.calloutSuccess`

The border, icon, title and tint of success callouts in a document preview.

The border, icon and title of success callouts in a document preview (also written check or done), and the tint behind them.

### Question Callout Accent

**Cog › Themes › Markdown preview**

`colours.calloutQuestion`

The border, icon, title and tint of question callouts in a document preview.

The border, icon and title of question callouts in a document preview (also written help or faq), and the tint behind them.

### Warning Callout Accent

**Cog › Themes › Markdown preview**

`colours.calloutWarning`

The border, icon, title and tint of warning callouts in a document preview.

The border, icon and title of warning callouts in a document preview (also written caution, attention or warn), and the tint behind them.

### Danger Callout Accent

**Cog › Themes › Markdown preview**

`colours.calloutDanger`

The border, icon, title and tint of failure, danger and bug callouts in a document preview.

## Main panel / workspace

### Collapsed Rail Background

**Cog › Themes › Main panel / workspace**

`colours.railBg`

The narrow strip a collapsed side pane leaves, carrying its expand toggle.

### Active Pane Highlight

**Cog › Themes › Main panel / workspace**

`colours.activePanelBorder`

The outline marking the pane or panel you are working in, when no project's colour replaces it.

The outline marking the pane or panel you are working in, the File Explorer pane and workspace panels alike. While a project is open, throng paints it in THAT project’s colour, so you see this value when no project is open.

### Inactive Pane Highlight

**Cog › Themes › Main panel / workspace**

`colours.activePanelBorderInactive`

The dimmed active-pane highlight, shown while this window is in the background.

The dimmed active-pane highlight, shown while this window is in the background so the marker stays visible without competing for attention.

### Pane Title Font

**Cog › Themes › Main panel / workspace**

`typography.paneTitle.family`

The typeface for the heading atop each sidebar pane. Empty follows the theme’s base font.

The typeface used for the PROJECTS, TERMINALS and FILE EXPLORER headings that sit atop each sidebar pane. Leave it empty to follow the theme’s base font.

### Pane Title Font Size

**Cog › Themes › Main panel / workspace**

`typography.paneTitle.sizePx`

Size of the heading atop each sidebar pane in pixels. Unset tracks the theme’s base size.

How large the PROJECTS, TERMINALS and FILE EXPLORER headings that sit atop each sidebar pane is drawn, in pixels. Leave it unset to track the theme’s base size.

### Pane Title Weight

**Cog › Themes › Main panel / workspace**

`typography.paneTitle.weight`

Weight of the heading atop each sidebar pane, 100 to 900. Unset tracks the theme’s base weight.

How heavy the PROJECTS, TERMINALS and FILE EXPLORER headings that sit atop each sidebar pane is drawn, from 100 to 900. Leave it unset to track the theme’s base weight. Most fonts ship only two weights, so nearby values can look identical unless the font is variable.

### Pane Title Casing

**Cog › Themes › Main panel / workspace**

`typography.paneTitle.case`

Casing of the heading atop each sidebar pane: as written, Title Case, lower case or UPPER CASE.

Leave the PROJECTS, TERMINALS and FILE EXPLORER headings that sit atop each sidebar pane as written, or force it to Title Case, lower case or UPPER CASE.

### Pane Title Italic

**Cog › Themes › Main panel / workspace**

`typography.paneTitle.italic`

Slant the heading atop each sidebar pane.

### Pane Title Underline

**Cog › Themes › Main panel / workspace**

`typography.paneTitle.underline`

Rule a line beneath the heading atop each sidebar pane.

Rule a line beneath the PROJECTS, TERMINALS and FILE EXPLORER headings that sit atop each sidebar pane.

### Pane Title Strikethrough

**Cog › Themes › Main panel / workspace**

`typography.paneTitle.strikethrough`

Rule a line straight through the heading atop each sidebar pane.

Rule a line straight through the PROJECTS, TERMINALS and FILE EXPLORER headings that sit atop each sidebar pane.

### Tab Font

**Cog › Themes › Main panel / workspace**

`typography.tab.family`

The typeface for the name on each tab. Empty follows the theme’s base font.

### Tab Font Size

**Cog › Themes › Main panel / workspace**

`typography.tab.sizePx`

Size of the name on each tab in pixels. Unset tracks the theme’s base size.

How large the name on each tab in the tab strip is drawn, in pixels. Leave it unset to track the theme’s base size.

### Tab Weight

**Cog › Themes › Main panel / workspace**

`typography.tab.weight`

Weight of the name on each tab, 100 to 900. Unset tracks the theme’s base weight.

How heavy the name on each tab in the tab strip is drawn, from 100 to 900. Leave it unset to track the theme’s base weight. Most fonts ship only two weights, so nearby values can look identical unless the font is variable.

### Tab Casing

**Cog › Themes › Main panel / workspace**

`typography.tab.case`

Casing of the name on each tab: as written, Title Case, lower case or UPPER CASE.

### Tab Italic

**Cog › Themes › Main panel / workspace**

`typography.tab.italic`

Slant the name on each tab.

### Tab Underline

**Cog › Themes › Main panel / workspace**

`typography.tab.underline`

Rule a line beneath the name on each tab.

### Tab Strikethrough

**Cog › Themes › Main panel / workspace**

`typography.tab.strikethrough`

Rule a line straight through the name on each tab.

### Panel Header Font

**Cog › Themes › Main panel / workspace**

`typography.panel.family`

The typeface for the name in a panel’s header bar. Empty follows the theme’s base font.

### Panel Header Font Size

**Cog › Themes › Main panel / workspace**

`typography.panel.sizePx`

Size of the name in a panel’s header bar in pixels. Unset tracks the theme’s base size.

How large the name in a workspace panel’s own header bar is drawn, in pixels. Leave it unset to track the theme’s base size.

### Panel Header Weight

**Cog › Themes › Main panel / workspace**

`typography.panel.weight`

Weight of the name in a panel’s header bar, 100 to 900. Unset tracks the theme’s base weight.

How heavy the name in a workspace panel’s own header bar is drawn, from 100 to 900. Leave it unset to track the theme’s base weight. Most fonts ship only two weights, so nearby values can look identical unless the font is variable.

### Panel Header Casing

**Cog › Themes › Main panel / workspace**

`typography.panel.case`

Casing of the name in a panel’s header bar: as written, Title Case, lower case or UPPER CASE.

### Panel Header Italic

**Cog › Themes › Main panel / workspace**

`typography.panel.italic`

Slant the name in a panel’s header bar.

### Panel Header Underline

**Cog › Themes › Main panel / workspace**

`typography.panel.underline`

Rule a line beneath the name in a panel’s header bar.

### Panel Header Strikethrough

**Cog › Themes › Main panel / workspace**

`typography.panel.strikethrough`

Rule a line straight through the name in a panel’s header bar.

### Pane Text Font

**Cog › Themes › Main panel / workspace**

`typography.paneText.family`

The typeface for the body text of panes and panels. Empty follows the theme’s base font.

The typeface used for the body text of every pane and panel (empty states, hints and list rows, never a header). Leave it empty to follow the theme’s base font.

### Pane Text Font Size

**Cog › Themes › Main panel / workspace**

`typography.paneText.sizePx`

Size of the body text of panes and panels in pixels. Unset tracks the theme’s base size.

How large the body text of every pane and panel (empty states, hints and list rows, never a header) is drawn, in pixels. Leave it unset to track the theme’s base size.

### Pane Text Weight

**Cog › Themes › Main panel / workspace**

`typography.paneText.weight`

Weight of the body text of panes and panels, 100 to 900. Unset tracks the theme’s base weight.

How heavy the body text of every pane and panel (empty states, hints and list rows, never a header) is drawn, from 100 to 900. Leave it unset to track the theme’s base weight. Most fonts ship only two weights, so nearby values can look identical unless the font is variable.

### Pane Text Casing

**Cog › Themes › Main panel / workspace**

`typography.paneText.case`

Casing of the body text of panes and panels: as written, Title Case, lower case or UPPER CASE.

Leave the body text of every pane and panel (empty states, hints and list rows, never a header) as written, or force it to Title Case, lower case or UPPER CASE.

### Pane Text Italic

**Cog › Themes › Main panel / workspace**

`typography.paneText.italic`

Slant the body text of panes and panels.

### Pane Text Underline

**Cog › Themes › Main panel / workspace**

`typography.paneText.underline`

Rule a line beneath the body text of panes and panels.

Rule a line beneath the body text of every pane and panel (empty states, hints and list rows, never a header).

### Pane Text Strikethrough

**Cog › Themes › Main panel / workspace**

`typography.paneText.strikethrough`

Rule a line straight through the body text of panes and panels.

Rule a line straight through the body text of every pane and panel (empty states, hints and list rows, never a header).

### Picture Preview Background

**Cog › Themes › Main panel / workspace**

`colours.pictureCanvas`

The background an Image or SVG preview draws its picture on. Empty derives it from the editor.

The background an Image or SVG preview draws its picture on, filling the panel around it. Leave it empty and it is the editor background a shade toward the text colour, so the picture's edges stand out.

### Picture Transparency Marker

**Cog › Themes › Main panel / workspace**

`colours.pictureHatch`

The hatching behind transparent parts of a picture in a preview. Empty mixes the editor colours.

The colour of the diagonal hatching drawn behind the transparent parts of a picture in a preview. Leave it empty and it is mixed from the editor background and text colour. Turn the hatching off per preview type with its Hatch transparent areas setting.

## Terminal

### Terminal Background

**Cog › Themes › Terminal**

`colours.terminalBg`

The surface behind the output of a terminal panel.

### Terminal Text

**Cog › Themes › Terminal**

`colours.terminalFg`

The default colour of the characters printed in a terminal panel.

### Terminal Cursor

**Cog › Themes › Terminal**

`colours.terminalCursor`

The block that marks the typing position in a terminal.

### Terminal Selection

**Cog › Themes › Terminal**

`colours.terminalSelection`

The highlight behind text the user has selected inside a terminal.

### Terminal Font

**Cog › Themes › Terminal**

`typography.terminal.family`

The typeface for the text in a Terminal panel. Empty follows the theme’s base font.

The typeface used for the output and input in a Terminal panel. Leave it empty to follow the theme’s base font.

### Terminal Font Size

**Cog › Themes › Terminal**

`typography.terminal.sizePx`

Size of the text in a Terminal panel in pixels. Unset tracks the theme’s base size.

How large the output and input in a Terminal panel is drawn, in pixels. Leave it unset to track the theme’s base size.

## File Explorer

### Code File Icons

**Cog › Themes › File Explorer**

`colours.fileIconCode`

Icons for source code, such as TypeScript, Python or C#. Empty takes the Icon Colour.

The colour of the File Explorer and Find in Files icons for source code in a programming language, such as TypeScript, Python or C#. Leave it empty and they take the Icon Colour.

### Markup File Icons

**Cog › Themes › File Explorer**

`colours.fileIconMarkup`

Icons for web pages and their styles: HTML, CSS and Sass. Empty takes the Icon Colour.

The colour of the File Explorer and Find in Files icons for web pages and their styles: HTML, CSS and Sass. Leave it empty and they take the Icon Colour.

### Data File Icons

**Cog › Themes › File Explorer**

`colours.fileIconData`

Icons for data and settings files, spreadsheets, databases and SQL. Empty takes the Icon Colour.

The colour of the File Explorer and Find in Files icons for data and settings files: JSON, YAML and other configuration, spreadsheets, databases and SQL. Leave it empty and they take the Icon Colour.

### Document File Icons

**Cog › Themes › File Explorer**

`colours.fileIconDocument`

Icons for plain text, Markdown and diffs. Empty takes the Icon Colour.

The colour of the File Explorer and Find in Files icons for plain text, Markdown and diffs. Leave it empty and they take the Icon Colour.

### Media File Icons

**Cog › Themes › File Explorer**

`colours.fileIconMedia`

Icons for images, sound, video, fonts and 3D models. Empty takes the Icon Colour.

The colour of the File Explorer and Find in Files icons for images, sound, video, fonts and 3D models. Leave it empty and they take the Icon Colour.

### Archive File Icons

**Cog › Themes › File Explorer**

`colours.fileIconArchive`

Icons for archives and installers. Empty takes the Icon Colour.

The colour of the File Explorer and Find in Files icons for archives and installers. Leave it empty and they take the Icon Colour.

### Script File Icons

**Cog › Themes › File Explorer**

`colours.fileIconScript`

Icons for shell and PowerShell scripts, keys and certificates. Empty takes the Icon Colour.

The colour of the File Explorer and Find in Files icons for shell and PowerShell scripts, keys and certificates. Leave it empty and they take the Icon Colour.

### Other File Icons

**Cog › Themes › File Explorer**

`colours.fileIconOther`

The icon for a file whose kind throng does not recognise. Empty takes the Icon Colour.

The colour of the File Explorer and Find in Files icon for a file whose kind throng does not recognise. Leave it empty and it takes the Icon Colour, like the folders.

### Ignored Entry Opacity

**Cog › Themes › File Explorer**

`sizes.ignoredEntryOpacity`

How strongly the File Explorer draws a file or folder git ignores. Lower fades it further; 1 draws it like any other.

## Projects / sidebar

### Side Panel Background

**Cog › Themes › Projects / sidebar**

`colours.sidebarBg`

The surface behind the projects and sub-workspaces lists, and behind the File Explorer pane.

The surface behind the left side panel that holds the projects and sub-workspaces lists, and behind the File Explorer pane.

### Category Header Background

**Cog › Themes › Projects / sidebar**

`colours.categoryHeaderBackground`

The strip behind a category name in the Projects pane. Unset, it follows the raised surface colour.

### Project Name Font

**Cog › Themes › Projects / sidebar**

`typography.projectName.family`

The typeface for a project’s name in the sidebar. Empty follows the theme’s base font.

### Project Name Font Size

**Cog › Themes › Projects / sidebar**

`typography.projectName.sizePx`

Size of a project’s name in the sidebar in pixels. Unset tracks the theme’s base size.

How large a project’s name in the sidebar list is drawn, in pixels. Leave it unset to track the theme’s base size.

### Project Name Weight

**Cog › Themes › Projects / sidebar**

`typography.projectName.weight`

Weight of a project’s name in the sidebar, 100 to 900. Unset tracks the theme’s base weight.

How heavy a project’s name in the sidebar list is drawn, from 100 to 900. Leave it unset to track the theme’s base weight. Most fonts ship only two weights, so nearby values can look identical unless the font is variable.

### Project Name Casing

**Cog › Themes › Projects / sidebar**

`typography.projectName.case`

Casing of a project’s name in the sidebar: as written, Title Case, lower case or UPPER CASE.

### Project Name Italic

**Cog › Themes › Projects / sidebar**

`typography.projectName.italic`

Slant a project’s name in the sidebar.

### Project Name Underline

**Cog › Themes › Projects / sidebar**

`typography.projectName.underline`

Rule a line beneath a project’s name in the sidebar.

### Project Name Strikethrough

**Cog › Themes › Projects / sidebar**

`typography.projectName.strikethrough`

Rule a line straight through a project’s name in the sidebar.

### Project Path Font

**Cog › Themes › Projects / sidebar**

`typography.projectPath.family`

The typeface for a project’s folder path. Empty follows the theme’s base font.

The typeface used for the folder path shown beneath a project’s name. Leave it empty to follow the theme’s base font.

### Project Path Font Size

**Cog › Themes › Projects / sidebar**

`typography.projectPath.sizePx`

Size of a project’s folder path in pixels. Unset tracks the theme’s base size.

How large the folder path shown beneath a project’s name is drawn, in pixels. Leave it unset to track the theme’s base size.

### Project Path Weight

**Cog › Themes › Projects / sidebar**

`typography.projectPath.weight`

Weight of a project’s folder path, 100 to 900. Unset tracks the theme’s base weight.

How heavy the folder path shown beneath a project’s name is drawn, from 100 to 900. Leave it unset to track the theme’s base weight. Most fonts ship only two weights, so nearby values can look identical unless the font is variable.

### Project Path Casing

**Cog › Themes › Projects / sidebar**

`typography.projectPath.case`

Casing of a project’s folder path: as written, Title Case, lower case or UPPER CASE.

Leave the folder path shown beneath a project’s name as written, or force it to Title Case, lower case or UPPER CASE.

### Project Path Italic

**Cog › Themes › Projects / sidebar**

`typography.projectPath.italic`

Slant a project’s folder path.

### Project Path Underline

**Cog › Themes › Projects / sidebar**

`typography.projectPath.underline`

Rule a line beneath a project’s folder path.

### Project Path Strikethrough

**Cog › Themes › Projects / sidebar**

`typography.projectPath.strikethrough`

Rule a line straight through a project’s folder path.

## Search

### Search Match Highlight

**Cog › Themes › Search**

`colours.searchMatch`

The surface tinting every occurrence of the search term in an editor or a terminal.

The surface tinting every occurrence of the search term in an editor or a terminal, behind text that must stay readable.

### Current Match Highlight

**Cog › Themes › Search**

`colours.searchMatchCurrent`

The stronger surface marking the one match you are on, so it stands out from the others.

### Current Match Border

**Cog › Themes › Search**

`colours.searchMatchCurrentBorder`

The line drawn around the match you are on, keeping it identifiable on a busy surface.

### Search Match Border

**Cog › Themes › Search**

`colours.searchMatchBorder`

The thin line drawn around every other match in an editor or a preview.

### Selection Occurrence Highlight

**Cog › Themes › Search**

`colours.searchMatchOccurrence`

The soft tint on the other places the selected text appears in the editor or preview.

### Inactive Selection Occurrence Highlight

**Cog › Themes › Search**

`colours.searchMatchOccurrenceInactive`

A weaker version of that tint, shown while the panel holding the selection is not active.

## Icons

### Icon Colour

**Cog › Themes › Icons**

`colours.iconColour`

Ink for the artwork. Leave it empty and each glyph takes the colour of whatever holds it.
