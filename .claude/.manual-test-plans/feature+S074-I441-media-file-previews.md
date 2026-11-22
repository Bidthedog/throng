# Manual test plan: 074 media file previews

Spec: `specs/074-media-file-previews/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Open … in, for every preview type | needs retest | 289e629185d8 | 2026-11-20 | f6f2bab5 touched packages/core/src/config/preview-settings.ts |
| MT-02 | Image Preview | needs retest | 289e629185d8 | 2026-11-20 | bb1d78a7 touched packages/core/src/preview/providers/image.ts |
| MT-03 | SVG Preview beside its editor | needs retest | 289e629185d8 | 2026-11-20 | bb1d78a7 touched packages/core/src/preview/providers/svg.ts |
| MT-04 | SVG and images in a Markdown preview | needs retest | 289e629185d8 | 2026-11-20 | failed: Fix FR-055 here. They should be consistent. They should use the same code / component, surely? |
| MT-05 | PDF Preview | needs retest | 289e629185d8 | 2026-11-20 | bb1d78a7 touched packages/core/src/preview/providers/pdf.ts |
| MT-06 | HTML Preview | untested | | | steps rewritten 2026-11-20: Find on HTML now works (FR-086b) |
| MT-07 | Hostile files | needs retest | 289e629185d8 | 2026-11-20 | 75fab0e1 touched packages/core/src/preview/request-policy.ts |
| MT-08 | Size limits and provider settings | needs retest | 289e629185d8 | 2026-11-20 | failed: Do FR-012 here. |
| MT-09 | HTML Preview updates in place | untested | | | |
| MT-10 | Find in HTML and PDF previews | untested | | | |
| MT-11 | HTML page right-click menu | untested | | | |
| MT-12 | Safe HTML preview sources | untested | | | |
| MT-13 | Preview type icons and titles | untested | | | |

## MT-01: Open … in, for every preview type

Covers: FR-016, FR-017, FR-018, FR-019, SC-008
Paths: `packages/core/src/config/preview-settings.ts`, `packages/ui/src/renderer/editor/open-router.ts`, `packages/ui/src/renderer/editor/editor-open.tsx`, `packages/ui/src/renderer/navigate/quick-open.tsx`, `packages/ui/src/renderer/links/use-open-in-os.ts`, `packages/ui/src/main/preview-service.ts`

### Steps
1. Open Preferences → Editor → Previews. Each of Markdown, Mermaid, Image, SVG, PDF and HTML has a row named **Open Markdown files in**, **Open Mermaid files in**, **Open images in**, **Open SVG files in**, **Open PDFs in**, **Open HTML files in**.
2. Open the list on **Open Markdown files in**. It offers Throng Editor, Throng Preview and Default OS Program. **Open images in** and **Open PDFs in** offer only Throng Preview and Default OS Program.
3. Set **Open PDFs in** to Default OS Program. Click a `.pdf` in Files & Folders. The system's PDF reader opens it; no throng panel opens.
4. Press Ctrl+P, type the PDF's name, press Enter. The system's PDF reader opens it again.
5. In a Markdown preview, Ctrl+click a link to that PDF. The system's PDF reader opens it.
6. Set **Open Markdown files in** to Default OS Program. Run Find in Files for a word in a `.md` file and open the result. An editor opens at the match.
7. Right-click the PDF in Files & Folders → Open In → Preview. A PDF Preview opens.

### Negative cases
- With **PDF: Enabled** off and Open PDFs in at Default OS Program, click a `.pdf`: it does not go to the OS program; it opens as throng opens a file no preview claims.

## MT-02: Image Preview

Covers: FR-020, FR-022, FR-023, FR-024, FR-026, FR-027, FR-028, FR-030, FR-031, FR-034
Paths: `packages/core/src/preview/providers/image.ts`, `packages/ui/src/renderer/preview/providers/image/**`, `packages/ui/src/renderer/preview/blocks/picture.ts`, `packages/ui/src/renderer/preview/diagram/**`, `packages/ui/src/renderer/preview/preview-status-bar.tsx`

### Steps
1. Click a `.png` in Files & Folders. An Image Preview titled `<name>.png - Image Preview` shows it fitted to the panel. The status bar shows its size in pixels and bytes.
2. Use Fit, Zoom In, Zoom 100%, Zoom Out; middle-drag to pan; Ctrl+wheel over a detail; Ctrl+middle-click. Each behaves as on a Mermaid preview, with the fading zoom percentage.
3. Zoom past 100% on a small icon. The pixels show as squares, not blurred.
4. Open a PNG with transparency. A checkerboard shows behind the transparent parts, in a dark and a light theme.
5. Right-click the picture → Copy Image. Paste into an image editor: the picture pastes.
6. Overwrite the file on disk with another image. The preview shows the new picture without reopening.
7. Open an animated GIF: it plays. Turn on the OS "reduce motion" setting and reopen it: it shows its first frame only.
8. Set **Image: Default fit** to Actual size and open an image larger than the panel. It opens at 100%.

### Negative cases
- A `.png` that is really a text file shows one notice saying it is not an image throng can show; never a blank panel or a broken-image icon.
- The body menu offers no text Copy or Select All.

## MT-03: SVG Preview beside its editor

Covers: FR-040, FR-041, FR-042, FR-045, FR-046, FR-047, FR-048
Paths: `packages/core/src/preview/providers/svg.ts`, `packages/ui/src/renderer/preview/providers/svg/**`, `packages/ui/src/renderer/preview/blocks/picture.ts`, `packages/ui/src/renderer/preview/diagram/**`

### Steps
1. Click a `.svg` in Files & Folders. An SVG Preview draws it, fitted, with the Mermaid view controls.
2. Open the same file in an editor and press the status-bar preview button. Change a `fill` colour without saving. The preview redraws within the update delay.
3. Type a stray `<` into the source. A notice says the SVG could not be drawn; the last good drawing stays dimmed beneath it. Remove the `<`: the notice clears.
4. Run Find in Files for a word inside the SVG and open the result. The SVG Preview opens alone, focused.
5. Right-click the picture → Copy Image, and paste into an image editor.

### Negative cases
- The SVG Preview and its editor offer no Synchronise Scrolling, in menus or the status bar.

## MT-04: SVG and images in a Markdown preview

Covers: FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-035, SC-007
Paths: `packages/ui/src/renderer/preview/providers/markdown/framed-images.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`, `packages/ui/src/renderer/preview/blocks/**`, `packages/ui/src/renderer/preview/providers/markdown/embeds.ts`

### Steps
1. Preview a Markdown file holding `![Logo](img/logo.svg)` alone on a line. The SVG draws in a frame with Fit, Zoom, Maximise and the right-click menu, as an inline Mermaid diagram has.
2. Add `![Shot](img/shot.png)` alone on a line. It is framed the same way; Copy Image from its right-click menu pastes the picture.
3. Add a fenced block with the info string `svg` holding a small `<svg>` drawing. It draws as a picture in a frame.
4. Add `![[logo.svg]]`. It draws as an embedded image.

### Negative cases
- A badge image in the middle of a sentence stays inline with its text, unframed.
- Raw `<svg>…</svg>` markup written straight into the `.md` file shows nothing.

## MT-05: PDF Preview

Covers: FR-060, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068
Paths: `packages/core/src/preview/providers/pdf.ts`, `packages/ui/src/renderer/preview/providers/pdf/**`

### Steps
1. Click a multi-page `.pdf`. A PDF Preview shows its pages one after another. The status bar reads `Page 1 of <n>`.
2. Scroll with the wheel, the scrollbar, Page Up / Page Down and Home / End. The page number follows.
3. Zoom the panel in and out. The pages redraw sharp at the new size.
4. Ctrl+click an internal link (a table of contents entry). The preview scrolls to its page. Ctrl+click a web link: the browser opens it.
5. Regenerate the PDF on disk while reading page 3. The preview reloads and stays at page 3.
6. Open a several-hundred-page PDF. The first page shows within about two seconds and scrolling never stalls the window.

### Negative cases
- A plain click on any link follows nothing.
- An encrypted or a truncated PDF shows one notice saying it cannot be displayed and why; no password prompt.
- The body menu offers no Copy or Select All.

## MT-06: HTML Preview

Covers: FR-070, FR-071, FR-072, FR-073, FR-079, FR-081, FR-082, FR-083, FR-084, FR-086, FR-087
Paths: `packages/core/src/preview/providers/html.ts`, `packages/ui/src/renderer/preview/providers/html/**`, `packages/ui/src/main/window-open-guard.ts`, `packages/ui/src/renderer/index.html`, `packages/ui/src/main/preview-protocol.ts`, `packages/ui/src/renderer/preview/providers/html/frame-input.ts`

### Steps
1. Click an `.html` file with a stylesheet and an image beside it. An HTML Preview shows the page styled, with its image.
2. Open it in an editor beside its preview and type. The preview follows the unsaved text within the update delay.
3. Ctrl+click an `https:` link in the page: the browser opens it. Ctrl+click a relative link to another project file: it opens as a link from a Markdown preview would. Click a `#section` link: the page scrolls to it.
4. Zoom the panel. The page scales.
5. Select text in the page and press Ctrl+C. Paste elsewhere: the plain text pastes.
6. Run Find in Files for a word in the HTML file and open the result. An editor opens at the match.

### Negative cases
- A plain click on a link follows nothing and the page stays.
- A page with a `<script>` shows "Scripts in this page do not run in the preview" once; dismissing it keeps it gone.
- A stylesheet referenced as `../../outside.css` from outside the project does not apply.

## MT-07: Hostile files

Covers: FR-044, FR-066, FR-074, FR-075, FR-076, FR-077, FR-078, FR-090, FR-093, SC-002
Paths: `packages/ui/src/renderer/preview/blocks/picture.ts`, `packages/ui/src/renderer/preview/providers/html/**`, `packages/ui/src/renderer/preview/providers/pdf/**`, `packages/ui/src/main/renderer-request-filter.ts`, `packages/core/src/preview/request-policy.ts`

### Steps
1. Copy `hostile.svg`, `hostile.html`, `hostile-style.css`, `hostile.pdf` and `polyglot.png` from `packages/ui/tests/fixtures/preview/` into a project. Open each from Files & Folders.
2. The SVG draws its two shapes. The HTML shows its static text. The PDF shows its page. The PNG shows a small coloured picture.

### Negative cases
- No dialog, alert, new window or navigation happens for any of them.
- With a network monitor (a dev build's devtools Network tab), nothing is requested from `hostile.invalid` or any web address.
- Keyboard focus never jumps into the HTML page on its own.

## MT-08: Size limits and provider settings

Covers: FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, SC-005
Paths: `packages/core/src/preview/providers/media-settings.ts`, `packages/core/src/config/preview-settings.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/preview/preview-notice.tsx`

### Steps
1. In Preferences → Editor → Previews → Image, set **Image: Maximum file size** to 5,242,880. Open an image larger than 5 MB. One notice names the file's size and the limit, digit-grouped.
2. Raise the limit and press Refresh. The image shows.
3. Turn **HTML: Enabled** off. Every open HTML Preview closes and `.html` files open in an editor.
4. Turn it back on. Clicking an `.html` file opens its preview again.

### Negative cases
- While a provider is off, its other settings are drawn disabled, not hidden.

## MT-09: HTML Preview updates in place

Covers: FR-071, FR-071b
Paths: `packages/ui/src/renderer/preview/providers/html/**`, `packages/ui/src/renderer/preview/providers/html/html-frame-update.ts`

### Steps
1. Open a long `.html` file in an editor and its preview beside it. Scroll the preview halfway down.
2. Type in the editor, in a paragraph near the top. The preview shows the change and stays where it was scrolled.
3. Save the file from another program (or let an agent edit it). The preview updates and stays at the same place.
4. Scroll sideways in a wide page, then edit. The horizontal position is kept too.

### Negative cases
- At no point does the panel go blank, white or flicker between the old and new page.
- Deleting most of the page while scrolled to its end leaves the preview at the new end, not past it.

## MT-10: Find in HTML and PDF previews

Covers: FR-086b, FR-086c, FR-086a
Paths: `packages/ui/src/renderer/preview/providers/html/**`, `packages/ui/src/renderer/preview/providers/pdf/**`, `packages/ui/src/renderer/preview/preview-search.ts`, `packages/ui/src/renderer/preview/preview-search-model.ts`, `packages/ui/src/renderer/preview/highlight-registry.ts`

### Steps
1. Open an HTML Preview and press the Find chord. Type a word on the page. Every match is highlighted and the count shows.
2. Press Enter / Shift+Enter. Each match scrolls into view in turn.
3. Open a PDF of several pages. Find a word that appears only on a late page you have not scrolled to. It is found and its page scrolls into view.

### Negative cases
- No preview's find bar offers Replace.
- An Image or SVG preview still has no Find.

## MT-11: HTML page right-click menu

Covers: FR-085, FR-085a
Paths: `packages/ui/src/renderer/preview/providers/html/**`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/copy.ts`

### Steps
1. Select some formatted text (bold, a link, a list) in an HTML Preview and right-click it. The menu offers Split, Select All, Copy, Copy as Rich Text and Find.
2. Choose Copy as Rich Text and paste into a rich-text editor (a document, an email). The formatting comes with it.
3. Choose Copy and paste into a plain editor. Plain text pastes.
4. Choose Select All, then Copy. The whole page's text is copied.
5. Choose Find. The find bar opens on the page.

### Negative cases
- A plain click on a link in the page still follows nothing.

## MT-12: Safe HTML preview sources

Covers: FR-072a, FR-093a, FR-075, FR-093
Paths: `packages/ui/src/renderer/preview/providers/html/**`, `packages/core/src/preview/request-policy.ts`, `packages/ui/src/main/renderer-request-filter.ts`, `packages/ui/src/renderer/project-settings/**`, `packages/core/src/preview/providers/html.ts`, `packages/core/src/preview/safe-sources.ts`, `packages/ui/src/main/frame-sources.ts`, `packages/ui/src/renderer/index.html`, `packages/ui/src/renderer/project-settings/project-settings-dialog.tsx`, `packages/ui/src/renderer/preferences/form-controls.tsx`, `packages/core/src/config/metadata.ts`

### Steps
1. Preview a page that links a Google Fonts stylesheet. The font applies with the shipped preferences.
2. Preview a page with a remote image from another site. The image is missing and one notice lists it under its source, with **Allow this source**.
3. Choose **Allow this source**. The image loads, and Project Settings now lists that source for this project.
4. The notice named the global **HTML: Safe preview sources** preference. Add a source there and open the page in another project: it loads there too.
5. Remove the source from Project Settings and reopen the page. It is left out and listed again.

### Negative cases
- A script from a safe source does not run.
- An `http:` source is listed without **Allow this source**.
- An SVG or PDF preview loads nothing remote whatever the list says.
- Several blocked resources raise one notice, not one each.

## MT-13: Preview type icons and titles

Covers: FR-103, FR-104
Paths: `packages/core/src/workspace/panel-title.ts`, `packages/core/src/preview/providers/**`, `packages/core/src/icons/**`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/preview/**`, `packages/ui/src/renderer/workspace/use-panel-display-names.ts`, `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/links/link-menu.ts`, `packages/ui/src/renderer/links/file-link-menu.ts`

### Steps
1. Open a Markdown, a Mermaid, an image, an SVG, a PDF and an HTML file as previews side by side. Each header shows its own preview icon, all recognisably the preview icon, each with its type's mark.
2. Each title names its type: `notes.md - Markdown Preview`, `flow.mmd - Mermaid Preview`, `logo.png - Image Preview`, `drawing.svg - SVG Preview`, `datasheet.pdf - PDF Preview`, `page.html - HTML Preview`.
3. Hover the tab holding them: its popover lists each preview with its type's icon and title.
4. Open an HTML file in an editor: its status-bar preview button shows the HTML preview icon. Right-click the file in Files & Folders → Open In: the Preview row shows it too.
5. Switch theme and icon set. Each icon follows the theme.

### Negative cases
- Narrow a preview panel until its title truncates: the name shortens and ` - <Type> Preview` stays whole.
