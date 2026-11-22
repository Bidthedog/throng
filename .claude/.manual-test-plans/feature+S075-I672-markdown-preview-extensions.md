# Manual test plan: Markdown preview extensions — callouts, maths and printing

Spec: `specs/075-markdown-preview-extensions/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Callouts draw with their type, icon and title | signed off | 0c5219b71c9e | 2026-11-20 | |
| MT-02 | Folding callouts | signed off | 0c5219b71c9e | 2026-11-20 | |
| MT-03 | Callout colours in the Themes editor | signed off | 0c5219b71c9e | 2026-11-20 | |
| MT-04 | Typeset maths | needs retest | | | failed: MT-04-maths-500.md draws 500 equations and the editor lags significantly as they load, render and scroll; print preview is slow to render and to move between pages |
| MT-05 | Print… in a preview's menus and keyboard | signed off | 0c5219b71c9e | 2026-11-20 | |
| MT-06 | Print Preview and printing | needs retest | | | failed: the page view jitters on load and on a page change, as if drawn full screen then fitted to its panel; it should show once loaded, with a spinner if needed; mouse wheel, arrow keys, Home and End should move between pages |
| MT-07 | Printing an editor | not tested | | | |

## MT-01: Callouts draw with their type, icon and title

Covers: FR-001, FR-002, FR-003, FR-004, FR-005, FR-011, FR-012, FR-013, FR-016, FR-019a, FR-024, SC-001, SC-002
Paths: `packages/ui/src/renderer/preview/providers/markdown/callouts.ts`, `packages/ui/src/renderer/preview/providers/markdown/callout-dom.ts`, `packages/ui/src/renderer/preview/providers/markdown/callout-sanitise.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown.css`, `packages/ui/src/renderer/preview/loading-placeholder.ts`, `packages/ui/src/renderer/preview/loading-placeholder.css`, `packages/ui/src/renderer/preview/resize-freeze.ts`, `packages/ui/src/renderer/preview/diagram/diagram-block.tsx`, `packages/core/src/preview/callouts.ts`, `packages/core/src/icons/default-set/callout*.svg`

### Steps
1. Make a file `callouts.md` with one blockquote per type: `> [!note]`, `[!abstract]`, `[!info]`, `[!todo]`, `[!tip]`, `[!success]`, `[!question]`, `[!warning]`, `[!failure]`, `[!danger]`, `[!bug]`, `[!example]`, `[!quote]`, each followed by a line of body text. Open it and press **Open Preview**. Each draws as a tinted box with a coloured left edge, an icon and its type's title (Note, Abstract, …), the body below.
2. Add `> [!warning] Read this first` and a body line. The title reads "Read this first", with the warning icon.
3. Add `> [!caution]` and `> [!hint]`. They draw as Warning and Tip: an alias takes its type's colour, icon and title.
4. Add `> [!nonsense]`. It draws as a Note box titled "Nonsense".
5. Add a callout whose body holds a list, a code block, a link and a second callout nested inside it. All render inside the box; the link opens like any other.
6. Switch theme to Light, then back. The callouts recolour with the theme.

### Negative cases
- A plain `> quote` with no `[!type]` stays an ordinary blockquote.
- A ```` ```ad-note ```` fence stays a code block.
- `> [!note]` written inside a code block or a fenced block stays text.

## MT-02: Folding callouts

Covers: FR-006, FR-007, FR-008, FR-009, FR-010, FR-014, SC-003
Paths: `packages/ui/src/renderer/preview/providers/markdown/callout-dom.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`, `packages/ui/src/renderer/preview/node-reveal.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/copy.ts`

### Steps
1. Write `> [!tip]- Folded` with a body line containing the word `zebra`, and `> [!tip]+ Open` with a body line. The first shows only its title with an expand chevron; the second shows its body with a collapse chevron. A callout with no sign has no chevron.
2. Click the first callout's title. It opens. Click again. It closes.
3. Press Tab until the first callout's title has the focus outline. Press Enter, then Space. It opens, then closes. Hover the chevron: "Expand callout" or "Collapse callout".
4. Open it, then type a character elsewhere in the editor. The preview re-renders and the callout stays open.
5. Close it. Press **Ctrl+F** in the preview and search `zebra`. The callout opens to show the match.
6. Use the preview menu's **Outlining › Collapse All**, then **Expand All**. Sections fold; the callouts keep their own state.
7. Select the whole preview (**Ctrl+A**) and **Copy**. Paste into an editor: no chevron or icon glyph is in the text.

### Negative cases
- Changing `[!tip]-` to `[!tip]+` in the editor makes that callout start open, whatever it was before.
- Closing and reopening the preview starts every callout from its sign.

## MT-03: Callout colours in the Themes editor

Covers: FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, SC-004
Paths: `packages/core/src/config/callout-colours.ts`, `packages/core/src/config/theme-metadata.ts`, `packages/core/src/config/theme-copy.ts`, `packages/core/src/config/default-themes/index.ts`, `packages/core/src/config/shipped-defaults.ts`

### Steps
1. Open **Themes**. A **Markdown preview › Callouts** area follows Editor, with seven colours (Neutral, Info, Accent, Success, Question, Warning, Danger Callout Accent).
2. Change **Warning Callout Accent** to a bright red. Warning and caution callouts in an open preview turn red at once; other types do not change.
3. Restore that colour to the theme's default. The preview returns to the shipped warning colour.
4. With an install that had a theme file from before this build, start the app. Its callouts show that theme's shipped colours, not blanks.

### Negative cases
- No callout's title, body or icon is unreadable against its box, in any shipped theme.

## MT-04: Typeset maths

Covers: FR-040, FR-041, FR-042, FR-043, FR-043a, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-093a, SC-005, SC-006, SC-007
Paths: `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/preview.css`, `packages/ui/src/renderer/preview/providers/markdown/math.ts`, `packages/ui/src/renderer/preview/providers/markdown/math-typeset.ts`, `packages/ui/src/renderer/preview/providers/markdown/math-dom.ts`, `packages/ui/src/renderer/preview/math-host.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`, `packages/ui/src/renderer/preview/providers/markdown/markdown.css`, `packages/ui/src/renderer/preview/preview-search-model.ts`, `packages/ui/src/renderer/preview/copy.ts`, `packages/core/src/preview/math-delimiters.ts`, `packages/core/src/preview/providers/markdown.ts`

### Steps
1. Write `Area is $\pi r^2$.`, a block `$$` / `\frac{a}{b}` / `$$`, a code-span form `` $`x_1`$ `` and a ```` ```math ```` fence holding `E = mc^2`. The preview typesets all four; the block and fence are centred on their own lines.
2. Write `It costs $5 and $10.` It stays prose, with both dollar signs.
3. Write `$\frac{a$`. It shows that source in the error colour; hovering it reads "Maths error: …"; the rest of the line renders.
4. Search **Ctrl+F** for `pi`. Nothing inside the typeset equation matches.
5. Select the paragraph holding `$\pi r^2$` and **Copy as Plain Text**; paste into an editor. It reads `Area is $\pi r^2$.` **Copy as Rich Text** into a word processor shows the equation.
6. In Settings, turn off **Markdown: Typeset math**. Every expression shows as its source text; the `math` fence is a code block. Turn it back on.
7. Open `MT-04-maths-500.md` (500 inline expressions) with its preview beside it. The equations appear together within about a second, and the editor keeps up with typing and scrolling while they load.
8. Scroll the preview from top to bottom with the mouse wheel. It moves smoothly, with no stutter.
9. Type a few characters at the end of the file. The preview redraws without the equations flickering or the editor stalling.
10. Reopen `MT-04-maths-500.md`'s preview. Until they are typeset, each inline equation shows a small turning spinner in its place and each displayed one a "Typesetting equation…" line, the same spinner a Mermaid block shows beside "Drawing diagram…".
11. In a document with an image from a slow or large file, the image's place shows the same spinner until it appears.
12. Drag the splitter between the editor and the `MT-04-maths-500.md` preview back and forth. The drag keeps up with the mouse as it does beside a plain-text preview; the preview's scrollbar hides while you drag and the text reflows to the new width a moment after you stop.
13. With `MT-04-maths-500.md`'s preview open from the editor's preview button, open another `.md` file in the same editor and press its preview button. The same preview panel now shows the second file; no second preview opens. Press it again on `MT-04-maths-500.md`: still one preview.

### Negative cases
- `$\href{javascript:alert(1)}{x}$` and `$\url{https://example.com}$` show as errors or text; nothing is clickable and nothing is requested.
- A document with no maths loads no maths fonts (DevTools › Network shows no KaTeX request).
- `\$5` stays a literal dollar sign.

## MT-05: Print… in a preview's menus and keyboard

Covers: FR-061, FR-062, FR-063, FR-064, SC-011, SC-012
Paths: `packages/ui/src/renderer/preview/print/print-command.ts`, `packages/ui/src/renderer/preview/preview-commands.tsx`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/core/src/config/keybindings.ts`, `packages/core/src/preview/provider.ts`

### Steps
1. Open a Markdown preview. Its header menu and its right-click menu both have **Print…** with the printer icon and **Ctrl+P**.
2. Click either. Print Preview opens; nothing is sent to a printer.
3. Close it. Focus the preview and press **Ctrl+P**. Print Preview opens.
4. Open a `.mmd` preview. **Print…** is enabled there too.
5. In **Key Bindings**, find **Print…** under Navigate; rebind it to another chord. The menus show the new chord, and it works.

### Negative cases
- **Ctrl+P** in a terminal does not open Print Preview; the shell receives it. (In an editor it prints the editor: MT-07.)
- A preview whose provider cannot print shows **Print…** greyed, with the hover "This preview type cannot be printed."

## MT-06: Print Preview and printing

Covers: FR-066, FR-067, FR-068, FR-068a, FR-068b, FR-068c, FR-068d, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, SC-008, SC-012, SC-013
Paths: `packages/ui/src/renderer/print-preview/**`, `packages/ui/src/renderer/preview/print/**`, `packages/ui/src/main/print-*.ts`, `packages/ui/src/main/electron-print-engine.ts`, `packages/core/src/preview/print.ts`, `packages/core/src/preview/print-palette.ts`

### Steps
1. With a dark theme active, open Print Preview on a long Markdown preview holding headings, a code block with a very long line, a table, an image, a folded section, a folded callout, a Mermaid diagram and display maths. The window is modal: the main window cannot be clicked until it closes. The pages show dark text on white, the folded section and callout open, the long code line wrapping, the diagram as wide as the text, no fold chevrons or diagram buttons. One page shows at a time, whole, with "Page 1 of N" above it between a greyed **Back** and an enabled **Forward**. Until that page is ready a spinner shows; the page then appears once, at its final size, with no jump.
1a. Press **Forward** until the last page. Each press shows the next page alone and counts up; on the last page **Forward** greys. Press **Back** once: the page before shows and **Forward** is enabled again. No page change jitters: the old page stays until the new one replaces it at the same size.
1b. Over the page, roll the mouse wheel down one notch, then up one notch. Each notch moves one page.
1c. Press **Right**, **Down** and **Page Down**: each shows the next page. Press **Left**, **Up** and **Page Up**: each shows the page before. **End** shows the last page and **Home** the first.
1d. Click into **Copies** and press **Up**: the number changes and the page does not. Click into the page range box and press **End**: the caret moves and the page does not.
1e. Open Print Preview on `MT-04-maths-500.md`. The first page appears within a couple of seconds, and each page change is immediate.
1f. Resize the Print Preview window. The page refits to the new size.
1g. Click another application's window. Print Preview stays in front of it.
1h. Set Margins to Custom, untick Fit to page width, set Scale to Custom and Pages to a range, then shrink the window as small as it goes. Every setting stays visible and the settings pane shows no scrollbar in either direction.
1i. In a dark theme, open Print Preview. The page is white edge to edge, with a dashed outline where the margins are.
1j. Set Margins to Custom. The four margin boxes sit round a small white page, one at each edge, each followed by "mm". Change one; the dashed outline moves to match.
1k. Untick Fit to page width. Scale offers 25 % to 200 % and Custom; choose 150 % and the page relays out; choose Custom and type 137 into the box that appears.
1l. Type "abc" into Copies and wait a moment. The box is outlined red and Print is disabled; type 2 and both clear.
1m. The title bar shows Close only — no maximise or restore.
1n. Add a printer in the OS's printer settings while Print Preview is open. Within a few seconds it appears in the Printer list.
1o. Print `MT-01-callouts.md` with Pages set to 1. One page prints, matching the preview exactly; print all pages and compare each sheet with its preview page — same breaks, nothing lost between pages.
2. Change paper to Letter, orientation to Landscape, margins to Minimum. Within two seconds of each change the pages lay out again, with "Laying out pages…" meanwhile.
3. Untick **Fit to page width**, set Scale to 50. The pages shrink. Set Pages to `1` and confirm only page 1 is shown, as "Page 1 of 1" with **Back** and **Forward** both greyed. Set Pages to `2, 4`: **Forward** steps from document page 2 to document page 4, reading "Page 2 of 2".
4. Choose a real printer, Copies 2, and press **Print**. The window closes and two copies of page 1 print, landscape, Letter, with no OS print dialog.
5. Open Print Preview again. Printer, paper, orientation, margins, scale and copies are as last set; Pages is back to All.
6. Quit and relaunch throng; open Print Preview. The same settings are still there.
7. Press **Ctrl+P** again in the main window while Print Preview is open. No second window opens; the open one comes to the front.
8. Open Print Preview on a `.mmd` file. The diagram fills one page.
9. Press Escape. The window closes and nothing prints.
10. Type an unsaved line into the editor of a parented preview, then open Print Preview. The pages include the unsaved line.
11. Tear a preview off into a sub-workspace window and open Print Preview from there. It opens modal to that window and lays out the pages.

### Negative cases
- With no printer installed, Print Preview reads "No printer is available." and **Print** is greyed; the pages still show.
- With the printer turned off or unplugged, **Print** shows one inline "Printing failed: …" notice and the window stays open; **Print** again retries.
- A page break never splits a heading from its first paragraph, a code block, a table row, a callout, the diagram, an image or a display equation.
- A remote image the preview showed prints; one blocked by **Load remote images** off prints as its alt text, and nothing new is requested.
- On page 3 of a document, change orientation so it lays out to fewer than 3 pages: the last page shows, and the count matches.
- Pages typed as `3-1` show a hint and do not lay out; **Print** stays greyed.

## MT-07: Printing an editor

Covers: FR-064a
Paths: `packages/ui/src/renderer/print/text-printable.ts`, `packages/ui/src/renderer/editor/editor-print.ts`, `packages/ui/src/renderer/editor/editor-chrome.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/core/src/config/keybindings.ts`, `packages/core/src/config/keybindings-metadata.ts`

### Steps
1. Open a `.ts` file in an editor and type a line without saving. Its header menu has **Print…** with the printer icon and **Ctrl+P**.
2. Click it. Print Preview opens with the whole file, your unsaved line included, in the editor's font, coloured as code on white paper, long lines wrapped.
3. Close it. Focus the editor and press **Ctrl+P**. Print Preview opens again.
4. Open a `.txt` file and print it. It shows as plain text, whitespace kept.
5. Print a page range and compare the paper with the preview, as MT-06 step 1o.

### Negative cases
- A terminal's header menu has no **Print…**, and **Ctrl+P** in a terminal reaches the shell.
