# Feature Specification: Media File Previews — Images, SVG, PDF and HTML

**Feature Branch**: `feature/S074-I441-media-file-previews`

**Created**: 2026-11-18

**Status**: Clarified

**Input**: User description: "Media file previews for v1.0.0, covering
[#441](https://github.com/Bidthedog/throng/issues/441) (image preview panel),
[#631](https://github.com/Bidthedog/throng/issues/631) (SVG preview panel, and SVG embeds in Markdown
previews), [#388](https://github.com/Bidthedog/throng/issues/388) (PDF preview provider) and
[#508](https://github.com/Bidthedog/throng/issues/508) (HTML preview provider). Each is a provider on
the preview seam #10 built (spec 044), its own preview panel type (054 FR-005), with the same access
points and rules as a Markdown preview (054 FR-006), its own `editor.previews.providers.<id>.*`
settings including a maximum file size, and an explicit, tested security boundary: a previewed file
runs no script and fetches nothing from the network."

This feature adds four preview providers to the seam spec **044** built and spec **054** made
per-type, and gives **every** preview type one preference, worded the same way, choosing what opening
one of its files does (**Open … in**, FR-016 – FR-019). It changes nothing in how previews are placed,
reused, persisted, maximised or closed; every new type takes those rules as they stand. It **narrows,
extends or supersedes** these existing requirements, each restated where it is replaced:

| Changed | By | What changes |
|---|---|---|
| 044 FR-026 | FR-012 | For the four providers here, "too large" is decided by the provider's own **maximum file size** setting, not the editor's `editor.maxOpenFileBytes` |
| 044 contract *preview-provider-seam* §4 (binary size limit = `editor.maxOpenFileBytes`) | FR-012 | Same change, for the binary providers (Image, PDF) |
| 044 FR-050 | FR-016, FR-017 | The setting is renamed **Open <files> in**; its values gain **Default OS Program** (`os`); its options are named **Throng Editor** / **Throng Preview** |
| 044 FR-051 | FR-016 | **Superseded.** A binary provider now HAS the setting, offering Throng Preview and Default OS Program (no editor), shipping Throng Preview |
| 054 FR-030 – FR-033 | FR-019 | A Find in Files result in a file set to **Default OS Program** opens an editor at the match: the OS program cannot be taken to a match |
| 054 FR-034 | FR-017 | The setting's description and `docs/preferences.md` use the new name and wording |
| 044 FR-122a | FR-046, FR-087 | Synchronise Scrolling is absent for SVG and HTML previews, as 054 FR-046i made it for Mermaid |
| 054 FR-005 | FR-001 | The named preview panel types gain **Image Preview**, **SVG Preview**, **PDF Preview** and **HTML Preview** (extension, not reversal) |
| 044 FR-084, 068 FR-010 | FR-055 | A local image standing as its own paragraph in a Markdown preview is drawn in a diagram frame with a Mermaid diagram's controls (extension) |
| 054 FR-040 – FR-049 | FR-054 | A fenced block with info string `svg` is drawn as a picture, as a ```` ```mermaid ```` fence is (extension) |
| 044 FR-093 / *security-policy* Layer 3 | FR-091, FR-092 | The renderer's content policy may be widened only by the named, narrowest grants this feature needs for PDF and HTML, each recorded in the security-policy contract |
| 074 FR-027 (this spec) | FR-027a, FR-027b | *(2026-11-19)* The checkerboard backdrop is replaced by a solid canvas filling the panel and an optional diagonal hatch behind transparent areas, both theme colours, the hatch switchable per type |
| 074 FR-031 (this spec) "no scrollbar at any zoom" | FR-031a | *(2026-11-19)* An Image or SVG preview scrolls on both axes when the picture outgrows the panel; a Mermaid preview keeps 054's pan-only view |
| 074 FR-068 (this spec) | FR-068a | *(2026-11-19)* A PDF's text is selectable and copyable; the body menu offers Copy and Select All |
| 074 FR-062 (this spec) | FR-062a | *(2026-11-19)* A PDF Preview carries its own view controls, and the panel's zoom gestures drive them |
| 054's Fit "never enlarges past 100%", as FR-031 and FR-062a took it | FR-031b, FR-062a (amended) | *(2026-11-19, second round)* A picture's and a PDF's Fit fill the panel, enlarging; a Mermaid diagram's Fit is unchanged |

Not changed, and this feature must satisfy them: 044 FR-012 (one preview per file), FR-020/FR-021
(read-only; document commands inert), FR-030 – FR-034 (title rules, header menu, per-panel zoom),
FR-062 – FR-067 (disable and persistence), FR-070 – FR-074 (the provider contract and project
confinement), FR-081/FR-082 (the Markdown sanitiser and "nothing runs code"), FR-090 – FR-096 (links);
054 FR-004 – FR-008 (one type per provider, Last Active per type), FR-005a (full file name title, full
path tooltip), FR-046b – FR-046n (diagram view controls), FR-070 – FR-078 (Focus Mode); 067 FR-116 –
FR-118 and FR-131 (`explorer.openUnsupportedInOs`, which still governs files NO provider claims); 068
FR-001 and FR-010 (embeds and their resolution).

**Boundary with spec 075.** Spec 075 (parallel branch) adds callouts, maths and printing to the
Markdown preview pipeline (`packages/ui/src/renderer/preview/providers/markdown/`). This feature's
Markdown changes are confined to **SVG**: the ```` ```svg ```` fence (FR-054), SVG images embedded in a
Markdown preview (FR-050 – FR-053), and drawing a standalone local image in a diagram frame (FR-055).
Each is registered from its own module; it does not touch callouts, maths, printing or any other part
of that pipeline, and printing from the new preview types is #484's, not this feature's.

**Boundary with spec 073.** Spec 073 (parallel branch) adds CSV and spreadsheet providers. It consumes
the **Open … in** mechanism this feature defines (FR-016 – FR-019) and declares only its own two
providers' options and shipped values.

## Clarifications

### Session 2026-11-18

- Q1: Is SVG its own **SVG Preview** type, or a format of **Image Preview**? → A: **Its own type.**
  SVG files are live-edited in text editors, so an SVG preview is a text provider's: it sits beside an
  editor and follows the unsaved buffer, which an Image Preview never does. (FR-001, FR-040 – FR-042)
- Q2: #441 and #388 list *Default open action* for Image and PDF, but 044 FR-051 says a binary provider
  has none. Keep FR-051, or supersede it? → A: **Supersede it, for every type.** Every preview panel
  type (Markdown, Mermaid, Image, SVG, PDF, HTML, and spec 073's CSV and spreadsheet) gets one
  preference, **Open <files> in**, choosing **Throng Editor**, **Throng Preview** or **Default OS
  Program**; a binary type offers only the last two. The existing Markdown and Mermaid **Default open
  action** settings are renamed to the same convention, keeping their keys and values. (FR-016 –
  FR-019)
- Q3: Is an SVG drawn as an isolated image (the browser's image mode) or sanitised inline into the
  panel (the Mermaid SVG profile)? → A: **As an isolated image.** An SVG file may contain scripts and
  links to remote content; throng draws it as a picture, so none of that runs or loads — the "it is
  just an image" behaviour a reader expects. (FR-040, FR-044)
- Q4: Does inline `<svg>` markup in a Markdown file stay stripped, or render through the SVG profile?
  → A: **Raw inline `<svg>` stays stripped** by the sanitiser, as today; **a fenced code block with the
  info string `svg` renders** as a picture, the way a ```` ```mermaid ```` fence does, with the same
  isolation as an SVG Preview. (FR-053, FR-054)
- Q5: What do SVG's and HTML's default open actions ship as? → A: **Throng Preview** for both; each
  also offers Throng Editor and Default OS Program through the same preference. (FR-016)
- Additional requirement (maintainer, same session): an Image Preview and an SVG Preview carry the
  controls a Mermaid (`.mmd`) preview carries — Fit, Zoom In, Zoom 100%, Zoom Out, middle-button pan,
  Ctrl+wheel about the pointer, Ctrl+middle-click to Fit, the fading zoom percentage, Copy Image and the
  right-click menu with Focus Mode — and an image or a ```` ```svg ```` fence inside a Markdown preview
  behaves exactly as an inline Mermaid diagram does there: same controls, Maximise and right-click
  menu. (FR-030 – FR-035, FR-054, FR-055)

### Session 2026-11-19 (maintainer's manual test feedback)

- Image previews open in the centre of the panel on a canvas filling it, with the zoom controls top-left
  however small the picture; a picture larger than the panel, or zoomed in, scrolls both ways. →
  FR-031 (centring, controls), FR-031a (supersedes FR-031's "no scrollbar").
- The picture's edges must be obvious: a solid canvas, transparent areas hatched, the hatch colour and
  whether to hatch at all set in Preferences. → FR-027a, FR-027b (supersede FR-027). The colours are theme
  colours (constitution X: every colour belongs to its theme); the on/off is a per-type setting.
- Add `.jfif`, `.pjpeg`, `.pjp`, `.dib`, `.cur` with matching MIME types for FR-094. → FR-001's table.
- PDF previews get the zoom controls the other previews have, and selectable, copyable text. → FR-062a,
  FR-068a (supersedes FR-068).
- SVG previews: as images. → FR-031, FR-031a, FR-027a, FR-027b.
- An HTML page's CSS did not load. → FR-072 (its linked stylesheets must apply), FR-092 (the grant).
- Opening an encrypted PDF and then, at once, another PDF into the same preview left the second showing
  the first's "cannot be displayed" notice. Defect, not a new requirement: the first move of a freshly
  attached run built the same source URL as the attach (`?rev=` was `revision + 1`, and an attach does not
  advance the revision), so the body never reloaded. Every binary source read now has a URL of its own
  (FR-064's "follows the file" holds for the panel's file, whichever it is).
- Middle-button drag moves PDF previews, and any other preview lacking it. → FR-063a.
- `Ctrl+G` in a PDF preview opens Go to Page. → FR-062b.
- *(Second round.)* A long PDF showed a horizontal scrollbar after zooming or a middle-drag. → FR-062d.
- *(Second round.)* PDF page layouts: Side by Side, Two Pages, and a Fit that fills. → FR-062c, FR-062a.
- *(Second round.)* Fit leaves a small picture at 1:1; it should fill. → FR-031b.
- *(Second round.)* Middle-drag should move a picture smaller than the panel. → FR-031c.
- *(Third round.)* Every preview opens at 100%, or Fit when larger than the panel; no setting. → FR-020a
  (removes Image: Default fit).
- *(Third round.)* The scripts notice stayed over a page without script and showed once per panel. → FR-081a.
- *(Third round.)* An image's right-click menu read Copy Diagram as Image. → FR-033 (Copy Image, as it already said).
- *(Third round.)* Find on an image preview makes no sense. → FR-086a.
- *(Sixth round.)* Hatch lines drew unevenly; the hatch now alternates ten thin lines with ten thicker ones, each
  drawn alike. → FR-027b. A preview's zoom percentage showed only
  briefly after a zoom: it now stays, faded like the view controls until the pointer is over the preview (FR-031g),
  and the status strip names it too (FR-022).
- *(Fifth round.)* Ctrl+Alt+0 fitted a picture smaller than its panel instead of returning it to 100%. → FR-020a.
  Zoomed out from 100%, a picture's scrollbars came and went for good. → FR-031f.
- *(Fourth round.)* SVG panels juddered after a resize or zoom. → FR-031d. Picture panels refitted a moment after a
  resize ended. → FR-031e. Zoom buttons named no chord. → FR-033. A click in an HTML page left its panel dimmed, and
  Ctrl+middle-click there did not reset it. → FR-083a.
- *(Third round.)* An HTML page did not zoom from the keyboard or mouse, a click in it did not activate its panel, and
  its scrollbar sat inside the panel. → FR-083a, FR-083.
- *(Third round.)* hostile.svg's square draws empty and its "link" text shows; hostile.html's images are broken. Both
  by design: the fixtures' remote and missing resources are refused (FR-044, FR-090).
- *(Second round.)* HTML previews rendered blank. Defect: the frame was handed one `srcdoc` and, a moment later,
  a second carrying the theme's colours, and Chromium never painted the sandboxed frame's second document. The
  colours are now read before the first, and each document gets a frame of its own (FR-070, FR-082).
- *(Second round.)* A PDF opened into a panel while its previous PDF was closing stayed on the previous one.
  Defect: every document shared PDF.js's port-cached worker, which a document's destroy tears down; a document
  opened during that refused to start ("the worker is being destroyed"), and closing one PDF broke every other
  open PDF. One worker is now owned by the renderer and handed to each document (FR-064, FR-065).

### Session 2026-11-20 (maintainer's feedback after sign-off; speckit-iterate)

- Q: When an HTML preview blocks remote resources, does the panel show one notice listing every blocked
  resource, or one notice per resource? → A: One in-panel notice listing each blocked resource, grouped by
  source, with **Allow this source** per source. Allowing adds the source to the **project's** list, kept in
  **Project Settings**; the notice also directs the user to the global preference for a source to be trusted
  across projects. → FR-072a, FR-093a.
- A parented HTML preview keeps the reader's place across updates, and an update does not flash: the page is
  updated in place rather than redrawn from blank. → FR-071b (ends FR-071's deferral). *(Maintainer.)*
- Every preview with text has Find; no preview has Replace. → FR-086b (HTML, superseding FR-086's disabled
  Find), FR-086c (PDF). Pictures keep FR-086a: nothing to search. *(Maintainer; the picture exception derived
  from the third round's FR-086a.)*
- An HTML page has a body context menu: Split, Select All, Copy, Copy as Rich Text, Find. → FR-085a
  (superseding FR-085's out-of-scope clause for the menu and rich copy). *(Maintainer.)*
- **Safe HTML preview sources**: a user-editable list of remote sources an HTML preview may load
  stylesheets, fonts and images from, shipped with Google Fonts. → FR-072a (superseding FR-075 and FR-093 for
  HTML only). *(Maintainer.)* Derived: scripts still never run and nothing navigates (FR-074, FR-076, FR-088);
  only `https:` sources; SVG and PDF previews keep FR-093 — the maintainer named HTML.
- Q: May the HTML frame share the app's origin, so throng can patch the page in place, keep its scroll and search
  inside it, with page scripts still blocked by the sanitiser, the sandbox and the content policy? → A: Yes. And
  Find on an HTML Preview only if it is the same Find every other panel has; otherwise none. → FR-074a, FR-086d.
- Every preview type looks the same in its header: one icon, one " - Preview" suffix. Each type gets its own preview
  icon — the preview icon with a mark for its type — including Markdown and Mermaid, which predate this spec; and the
  title says which type it is: `<name> - <Type> Preview` (`notes.md - Markdown Preview`). → FR-103, FR-104
  (superseding 044 FR-031's suffix). *(Maintainer asked for the icons and called out the suffix; the suffix wording
  is derived — the provider's display name, as Preferences already uses for each subsection.)* A provider that
  declares no icon (a later one, such as 073's CSV until it does) keeps the generic preview icon.
- Defects, no spec change: FR-012's limit is not applied to a parented SVG or HTML preview's unsaved text;
  FR-055's `![[x.png]]` / `![[x.svg|200]]` are not framed, and must be framed by the same code as
  `![alt](x.png)`; SC-003 and SC-004 have no test measuring them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Look at an image without leaving throng (Priority: P1)

A user browsing a project in Files & Folders opens `screenshot.png`. Instead of an editor reporting a
binary file, an **Image Preview** panel shows the picture, fitted to the panel. They zoom in on a
detail with Ctrl+wheel, pan with the middle button, press Zoom 100% to see it pixel for pixel, and Fit
to go back. When a build step rewrites the image, the panel shows the new one.

**Why this priority**: Images are the most common non-text file in a project, and today seeing one
means leaving throng. It is also the simplest binary provider, so it proves the seam for PDF.

**Independent Test**: In a project holding a PNG, a JPEG, an animated GIF and a WebP, open each from
Files & Folders; each shows in an Image Preview, fitted; overwrite one on disk and see it update.

**Acceptance Scenarios**:

1. **Given** a `.png` in Files & Folders, **When** the user opens it by the open gesture, Enter, Quick
   Open or Open In → Preview, **Then** an Image Preview panel titled `screenshot.png - Preview` shows
   the image, fitted to the panel, and hovering the title shows its full path. *(FR-001, FR-020,
   FR-022)*
2. **Given** an open Image Preview, **When** the user uses Fit, Zoom In, Zoom 100%, Zoom Out,
   middle-button drag, Ctrl+wheel or Ctrl+middle-click, **Then** each behaves as it does on a Mermaid
   preview, and none of it changes the file or is saved with the layout. *(FR-030 – FR-034)*
3. **Given** an open Image Preview, **When** the file is overwritten on disk, **Then** the preview shows
   the new image without being reopened. *(FR-023)*
4. **Given** a file larger than **Image: Maximum file size**, **When** it is opened, **Then** the panel
   shows one inline notice naming the size and the limit, and nothing is decoded; raising the limit and
   pressing Refresh shows the image. *(FR-011, FR-012)*
5. **Given** a `.png` whose bytes are not a decodable image, **When** it is opened, **Then** the panel
   shows one inline notice saying the image cannot be shown — never a blank panel or a raw error
   string. *(FR-024)*
6. **Given** a second image opened under Last Active, **When** an Image Preview is the most recently
   active one in the visible tab, **Then** the second image replaces the first in that panel, and Back
   returns to the first. *(FR-002)*
7. **Given** **Open images in** set to **Default OS Program**, **When** the user opens a `.png` from
   Files & Folders or Quick Open, **Then** it opens in the operating system's default program and no
   panel opens; Open In → Preview still opens the Image Preview. *(FR-016, FR-018)*

---

### User Story 2 - See an SVG as a picture, not as XML (Priority: P1)

A user opens `logo.svg`. An **SVG Preview** shows it drawn, crisp at any zoom, with the same view
controls as a Mermaid preview. They open the file in an editor beside it, change a fill colour, and the
preview redraws as they type. A colleague's SVG with an embedded `<script>` and a remote `<image href>`
draws without running the script or fetching anything.

**Why this priority**: SVG icons and diagrams are routine in web and documentation projects, and an
SVG is also the security case most likely to be underestimated.

**Independent Test**: Open a benign SVG and a hostile SVG fixture; the first draws and live-updates
from an editor; the second draws its static shapes, and no script runs and no request is made.

**Acceptance Scenarios**:

1. **Given** `logo.svg`, **When** it is opened from Files & Folders (it ships **Open SVG files in:
   Throng Preview**), Open In → Preview, or the editor status-bar preview button, **Then** an SVG
   Preview panel draws it, fitted. *(FR-001, FR-016, FR-040, FR-041)*
2. **Given** an editor and its parented SVG Preview, **When** the user edits the source without saving,
   **Then** the preview redraws within the preview update delay; with no editor open, saving the file
   from outside throng redraws it. *(FR-042)*
3. **Given** an SVG holding `<script>`, an `onload` attribute, `<foreignObject>`, an external
   `<image href>`, a CSS `@import` and a `url(https://…)`, **When** it is previewed, **Then** no script
   runs and no request leaves the machine; a test asserts both. *(FR-044, FR-090)*
4. **Given** a malformed SVG, **When** it is previewed, **Then** the panel shows one inline failure
   notice; if it drew successfully earlier in this preview's life, the last good drawing stays,
   dimmed, under the notice. *(FR-045)*
5. **Given** a Find in Files match inside an `.svg` whose **Open SVG files in** is Throng Preview,
   **When** the result is opened, **Then** the SVG Preview opens alone, as a Mermaid file's does.
   *(FR-047)*

---

### User Story 3 - An SVG in a Markdown note draws (Priority: P2)

A user's README embeds `![Architecture](docs/architecture.svg)`, and a design note carries a small
```` ```svg ```` fence. The Markdown preview draws both in place, each in a frame with the same controls
an inline Mermaid diagram has.

**Why this priority**: Embedding appears to work already; the issue's job is to prove it with a test
and fix any gap. The fence is the maintainer's chosen way to write an SVG inside a note.

**Independent Test**: Preview a Markdown file with a relative `![x](img/diagram.svg)`, an Obsidian
`![[diagram.svg]]` and a ```` ```svg ```` fence; all draw; none runs script from a hostile SVG.

**Acceptance Scenarios**:

1. **Given** `![alt](relative/path.svg)` standing as its own paragraph and the file exists in the
   project, **When** the Markdown preview renders, **Then** the SVG draws in place in a diagram frame,
   with `alt` as its alternative text, covered by a test. *(FR-050, FR-055)*
2. **Given** `![[diagram.svg]]`, **When** the preview renders, **Then** it draws as 068 FR-010 draws an
   embedded image. *(FR-051)*
3. **Given** the embedded SVG carries a script and a remote reference, **When** the preview renders,
   **Then** neither runs nor fetches. *(FR-052)*
4. **Given** inline `<svg>…</svg>` markup written in the `.md` file, **When** the preview renders,
   **Then** it is removed with its content, as today. *(FR-053)*
5. **Given** a ```` ```svg ```` fence, **When** the preview renders, **Then** its source is drawn as a
   picture in a diagram frame with Fit, Zoom, Maximise, Copy Image and the right-click menu, exactly as
   a ```` ```mermaid ```` fence is; a hostile fence runs nothing and fetches nothing. *(FR-054)*

---

### User Story 4 - Read a PDF datasheet beside the code (Priority: P2)

A user opens `docs/datasheet.pdf`. A **PDF Preview** shows its pages one after another, scrollable,
themed chrome around them. They zoom with the panel's Zoom control. When the PDF is regenerated, the
preview shows the new version at about the same page.

**Why this priority**: PDFs are common in hardware, research and specification-driven projects, and
the issue names PDF as the provider that proves the seam is drawn right.

**Independent Test**: Open a multi-page PDF; scroll through it; zoom; regenerate it on disk; open a
hostile PDF (JavaScript, a URI action, a form) and an encrypted one.

**Acceptance Scenarios**:

1. **Given** a `.pdf` in Files & Folders, **When** it is opened by Open In → Preview, the open gesture,
   Enter or Quick Open, **Then** a read-only PDF Preview titled `datasheet.pdf - Preview` shows its
   pages. *(FR-001, FR-060, FR-061)*
2. **Given** an open PDF Preview, **When** the user scrolls and uses the panel's Zoom In / Zoom Out /
   Reset Zoom, **Then** the pages scroll and render at the new scale, sharp rather than stretched.
   *(FR-062, FR-063)*
3. **Given** the file changes on disk, **When** the change settles, **Then** the preview re-renders and
   stays at the same page where that page still exists. *(FR-064)*
4. **Given** a PDF containing JavaScript, an open action, a URI link action and a submit-form action,
   **When** it is previewed, **Then** nothing executes and nothing is fetched; a test asserts it.
   *(FR-066, FR-090)*
5. **Given** an encrypted, password-protected or malformed PDF, **When** it is opened, **Then** the
   panel shows one inline notice saying it cannot be displayed and why. *(FR-067)*

---

### User Story 5 - See the HTML page I am editing, safely (Priority: P2)

A user edits `report-template.html` with a stylesheet and a logo beside it. They open its preview
beside the editor; the page renders with its stylesheet and image, and updates as they type. A
coverage report from a cloned repository, full of scripts and CDN links, previews as its static
markup: no script runs, nothing is fetched, nothing navigates.

**Why this priority**: The edit-and-look loop Markdown already has, for the other document format
people write by hand — with the highest security exposure of any provider, so it lands after the
simpler three.

**Independent Test**: Preview an HTML file with a relative stylesheet and image while editing it; then
preview the hostile HTML fixture and confirm no script, request, navigation or form submission
happens.

**Acceptance Scenarios**:

1. **Given** an `.html` or `.htm` file, **When** it is opened from Files & Folders (it ships **Open
   HTML files in: Throng Preview**), Open In → Preview or the editor status-bar preview button,
   **Then** an HTML Preview titled `page.html - Preview` renders it. *(FR-001, FR-016, FR-070)*
2. **Given** a parented HTML Preview, **When** the user edits the source without saving, **Then** the
   preview follows the unsaved buffer within the update delay. *(FR-071)*
3. **Given** a relative stylesheet, image and font beside the file, **When** it is previewed, **Then**
   each is applied; a relative path that resolves outside the project loads nothing. *(FR-072,
   FR-073)*
4. **Given** a page with an inline `<script>`, an `onload` handler, a remote `<img>`, a remote
   stylesheet, a `<form>`, a `<meta http-equiv="refresh">`, a `<base href>`, a `target="_blank"` link
   and an `<iframe>`, **When** it is previewed, **Then** nothing executes, nothing is fetched, no window
   opens and the panel does not navigate; a test asserts each. *(FR-074 – FR-078, FR-090)*
5. **Given** an `https:` link in the page, **When** the user Ctrl+clicks it, **Then** it opens in the OS
   browser; a plain click follows nothing. **Given** a relative link to another project file, **When**
   Ctrl+clicked, **Then** it opens as a link from a Markdown preview would. *(FR-079, FR-080)*
6. **Given** a parented HTML Preview scrolled down the page, **When** the user (or an agent) edits the
   source, **Then** the preview shows the change with the reader still at the same place in the page, and the
   panel never shows a blank or white frame between the two versions. *(FR-071b)*
7. **Given** an HTML Preview, **When** the user presses the Find chord and types a word on the page,
   **Then** the matches are highlighted, a count shows, and Next / Previous scroll each into view; there is
   no Replace. *(FR-086b)*
8. **Given** a multi-page PDF, **When** the user Finds a word that appears only on a page not yet drawn,
   **Then** the match is found and its page scrolled into view. *(FR-086c)*
9. **Given** an HTML Preview with text selected, **When** the user right-clicks in the page, **Then** a menu
   offers Split, Select All, Copy, Copy as Rich Text and Find; Copy as Rich Text puts the selection on the
   clipboard as HTML and plain text. *(FR-085a)*
10. **Given** a page linking a Google Fonts stylesheet, **When** it is previewed with the shipped
   preferences, **Then** the font applies. **Given** a page with a remote image from a source in no list,
   **When** it is previewed, **Then** the image is absent and one notice lists it under its source with
   **Allow this source**; choosing that adds the source to the project's list (Project Settings), the
   image loads, and the notice names the global preference that trusts a source in every project.
   *(FR-072a, FR-093a)*
11. **Given** a source on the safe list, **When** the page names a script from it, **Then** the script does
   not run. *(FR-072a, FR-074)*

---

### User Story 6 - One "Open … in" preference per preview type (Priority: P2)

A user opens **Preferences → Editor → Previews** and finds an **Image**, **SVG**, **PDF** and **HTML**
subsection beside Markdown and Mermaid. Every subsection starts with **Enabled** and **Open <files>
in** — "Open Markdown files in", "Open images in", "Open PDFs in" — then Open previews in, a maximum
file size and the provider's own settings. Setting **Open PDFs in** to **Default OS Program** makes a
PDF opened from Files & Folders open in the system's PDF reader; turning HTML off closes every open
HTML preview and HTML files open in an editor again.

**Why this priority**: The settings are the user's control over each provider, and the seam's promise
is that each comes from registration alone; the maintainer asked for the same wording on every type.

**Independent Test**: For each provider, set Open … in to each of its values and open a file from
Files & Folders and Quick Open; toggle each provider off and on; change each size limit.

**Acceptance Scenarios**:

1. **Given** the preferences editor, **When** the user opens Editor → Previews, **Then** each provider
   has its own subsection, with labels carrying the provider name, and its **Open <files> in** row
   offers Throng Editor, Throng Preview and Default OS Program for a text type, and Throng Preview and
   Default OS Program for a binary type. *(FR-010, FR-013, FR-016, FR-017)*
2. **Given** **Open <files> in: Default OS Program** for a type, **When** one of its files is opened
   from Files & Folders, Quick Open or a link followed in a preview, **Then** the OS default program
   opens it, no panel opens, and a failure shows the one notice File Explorer's Open in OS Default
   Program shows. *(FR-018)*
3. **Given** a provider is disabled, **When** the change is saved, **Then** every open preview of that
   type closes and every preview affordance for its files is shown disabled (044 FR-062 – FR-064).
   *(FR-014)*
4. **Given** the four providers ship, **When** the seam's test inspects the change, **Then** no surface
   outside each provider's own registration, view and settings entry names a provider — the
   security-policy grants of FR-091/FR-092 excepted and named. *(FR-005)*
5. **Given** a Markdown, a Mermaid, an Image, an SVG, a PDF and an HTML preview open side by side, **When** the user
   looks at their headers, **Then** each shows its own preview icon and a title naming its type —
   `notes.md - Markdown Preview`, `flow.mmd - Mermaid Preview`, `logo.png - Image Preview`,
   `drawing.svg - SVG Preview`, `datasheet.pdf - PDF Preview`, `page.html - HTML Preview`; the editor's
   status-bar preview button and the Open In → Preview row for each file show that type's icon too. *(FR-103,
   FR-104)*

---

### Edge Cases

- **Extension claimed twice.** `.svg` is claimed by the SVG provider only; the Image provider does not
  list it (044 FR-072). An `.svg` image inside a Markdown preview is not a preview open and is
  unaffected.
- **Wrong contents for the extension.** A `.png` that is really a JPEG draws (the image decoder sniffs);
  a `.png` that is really text, or a `.pdf` that is not a PDF, shows FR-024's / FR-067's notice.
- **Huge dimensions, small file.** An image small on disk that decodes to an enormous bitmap (for
  example 30,000 × 30,000 pixels) must not hang or crash the window: FR-025.
- **Animated images.** An animated GIF, WebP or APNG plays; with the OS's reduced-motion preference on,
  it shows its first frame (FR-026).
- **Transparency.** A transparent image is drawn over a themed backdrop that keeps it visible in every
  shipped theme (FR-027).
- **SVG with no size.** An SVG with a `viewBox` but no `width`/`height` fits the panel; one with neither
  draws at a default size of 300 × 150.
- **SVG referencing a local file.** `<image href="photo.png">` inside an SVG Preview: see FR-044 —
  nothing outside the SVG itself is loaded, local or remote.
- **A huge or deeply nested SVG** that takes too long to draw shows the inline notice rather than
  blocking the window (FR-045).
- **Default OS Program with no OS handler.** The OS's refusal shows File Explorer's Open in OS Default
  Program notice (067 FR-018); throng does not fall back to a panel.
- **Default OS Program and a disabled provider.** A disabled provider suspends the choice: its files
  open as if no provider claimed them (044 FR-062), and re-enabling restores the stored choice.
- **PDF with hundreds of pages.** Pages render as they come into view; opening a large PDF does not
  render every page up front (FR-065).
- **PDF links.** An internal link (to another page) scrolls the preview to that page; an external URI
  link follows 044 FR-091 on Ctrl+click and never on a plain click; a launch or file action does
  nothing (FR-066).
- **HTML that is a full app shell** (an empty `<body>` filled by script): renders as its static markup,
  which may be nearly empty; the preview says scripts did not run once per preview (FR-081).
- **HTML referencing `../` out of the project**, or a symlinked asset that resolves outside: nothing
  loads (FR-073).
- **HTML parented editor saves as a different type** (`page.html` → `page.md`): 044 FR-027's notice.
- **Unsaved HTML and on-disk assets.** The page text comes from the editor's buffer; its stylesheet and
  images come from disk (FR-072).
- **A file moves or is deleted** while previewed: as every preview today (044 FR-026; 052).
- **A preview open when its provider is disabled in another window**: closes everywhere, persisted
  layouts included (044 FR-063).
- **Focus Mode** on any of the four types behaves as on every panel (054 FR-070 – FR-078).
- **An image inline in a sentence** (a badge, an icon beside text) in a Markdown preview stays inline
  and is not framed; only an image standing as its own paragraph is (FR-055).

## Requirements *(mandatory)*

### Functional Requirements

#### The four providers and their panel types

- **FR-001**: throng MUST ship four new preview providers, each its own preview panel type (054
  FR-005): **Image Preview**, **SVG Preview**, **PDF Preview** and **HTML Preview** (Q1).

  | Provider | Kind (044 FR-071) | Extensions |
  |---|---|---|
  | Image | binary | `.png` `.apng` `.jpg` `.jpeg` `.jfif` `.pjpeg` `.pjp` `.gif` `.webp` `.avif` `.bmp` `.dib` `.ico` `.cur` |
  | SVG | text | `.svg` |
  | PDF | binary | `.pdf` |
  | HTML | text | `.html` `.htm` |

  The image extensions are the raster types Chromium decodes natively; TIFF, HEIC and RAW formats are
  out of scope. `.jfif`, `.pjpeg` and `.pjp` are JPEG (`image/jpeg`), `.dib` a BMP (`image/bmp`) and `.cur`
  a cursor in the ICO container (`image/x-icon`), each served as that type under FR-094 (2026-11-19).
- **FR-002**: Every new type MUST follow 054 FR-006 in full — every access and activation point a
  Markdown preview has, as far as its kind allows (044 FR-073: a binary provider has no editor
  status-bar or editor-menu affordance) — including 054 FR-004 (an open of a file that already has a
  preview focuses it), FR-005a (title is the full file name; tooltip the full path), FR-007 (Last
  Active reuse per type), 044 FR-033 (header menu), FR-034 (per-panel zoom), FR-066 (layout
  persistence), FR-100 – FR-112 (navigation history) and 054 FR-070 – FR-078 (Focus Mode).
- **FR-003**: A text provider here (SVG, HTML) MUST support parented and standalone previews exactly as
  044 FR-010 – FR-015 and FR-022 – FR-024 describe; a binary provider (Image, PDF) MUST always be
  standalone and follow the disk (044 FR-023, FR-073).
- **FR-004**: An image, SVG or PDF preview is **one picture or one paginated document, not a text
  document**: its menus MUST NOT offer Go to Heading or the Outlining submenu. Copy and Select All are
  governed per provider below (FR-028, FR-048, FR-068, FR-085).
- **FR-005**: Adding each provider MUST require no change to the preview panel, its menus, the status
  bar, Files & Folders or the preferences page beyond the provider's own registration, view and
  settings (044 FR-070, User Story 5). Generic seam extensions this feature needs (a descriptor field,
  a notice kind) name no provider. Changes to the security policy (FR-091, FR-092) are the only
  permitted provider-specific exception and MUST be listed in the plan.
- **FR-006**: Every new provider MUST ship **enabled**.

#### Settings and the size limit

- **FR-010**: Each new provider MUST have its own subsection under **Editor → Previews** (054 FR-050),
  holding, as `editor.previews.providers.<id>.*` descriptors, in this order:
  - **Enabled** (all four);
  - **Open <files> in** (FR-016);
  - **Open previews in** (Last Active / New Preview Panel), as 054 FR-051 gives Markdown and Mermaid —
    for every provider, text and binary;
  - **Maximum file size** (FR-011);
  - ~~**Image: Default fit** — Fit to panel or Actual size, shipping Fit to panel (#441).~~ *(Removed
    2026-11-19 by FR-020a: every preview opens the same way, with no setting.)*
- **FR-011**: The **Maximum file size** settings MUST ship at: Image **50 MB**, SVG **10 MB**, PDF
  **100 MB**, HTML **10 MB** (MB = 1,048,576 bytes, as `editor.maxOpenFileBytes` counts). Each value is
  shown and edited digit-grouped (constitution 4.5.0/5.4.0) and takes effect without a restart on the
  next load or Refresh.
- **FR-012**: *(Narrows 044 FR-026 and the seam contract §4 for these four providers.)* A file larger
  than its provider's Maximum file size MUST NOT be read or decoded; the panel MUST show one inline
  notice naming the file's size and the limit, following 044 FR-026's one-condition-one-notice rule.
  Raising the limit and pressing Refresh (044 FR-028) MUST then show the file. For a parented SVG or
  HTML preview the limit applies to the source's current content, and the editor's own
  `editor.maxOpenFileBytes` still governs whether the editor can open the file.
- **FR-013**: Labels MUST carry the provider name (054 FR-052): *"Image: Maximum file size"*, *"HTML:
  Open previews in"*. The Open … in row is the one exception, worded per FR-017.
- **FR-014**: Disabling a provider MUST behave as 044 FR-062 – FR-064 and FR-067 prescribe.
- **FR-015**: Every new setting MUST have a descriptor the preferences editor renders and be covered by
  the configuration-editor completeness test (054 FR-060), and MUST be documented in
  `docs/preferences.md`.

#### Open … in — what opening a file does, for every preview type (Q2, Q5)

- **FR-016**: *(Supersedes 044 FR-050 and FR-051.)* **Every** preview provider, text and binary —
  those shipped before this feature, the four here and every later one — MUST have one setting,
  **Open <files> in**, stored at the existing key `editor.previews.providers.<id>.defaultOpenAction`
  (no migration: every stored `editor` / `preview` value keeps its meaning). Its values:

  | Value | Option label | Offered by |
  |---|---|---|
  | `editor` | **Throng Editor** | text providers only |
  | `preview` | **Throng Preview** | every provider |
  | `os` | **Default OS Program** | every provider |

  Shipped values: Markdown **Throng Editor** (unchanged, 044 FR-050), Mermaid **Throng Preview**
  (unchanged), Image, SVG, PDF and HTML **Throng Preview**. A stored value a provider does not offer
  (`editor` written by hand for a binary provider) reads as that provider's shipped value. A provider
  may rename its `preview` option where its preview is more than a viewer (spec 073's CSV:
  "Throng Preview Editor").
- **FR-017**: *(Rewords 044 FR-050's label and 054 FR-034's description.)* The setting's label MUST be
  **Open <files> in**, naming the provider's files in the plural — "Open Markdown files in", "Open
  Mermaid files in", "Open images in", "Open SVG files in", "Open PDFs in", "Open HTML files in" — and
  its description MUST say what each value does and that Open In's explicit targets always do what
  they name.
- **FR-018**: With **Default OS Program**, opening a file of that type from Files & Folders (the
  `editor.openOnClick` gesture or Enter), Quick Open, or a link followed in a preview MUST hand the
  file to the operating system's default program through the existing open-in-OS route (067 FR-018,
  its one failure notice included) and MUST NOT open a throng panel. Open In's explicit targets
  (New Editor, Preview, Open in OS Default Program) still do what they name (044 FR-055).
- **FR-019**: *(Narrows 054 FR-030 – FR-033.)* A Find in Files result in a file whose type is set to
  **Default OS Program** MUST open an editor at the match, as for **Throng Editor**: an OS program
  cannot be taken to a match.

#### Image provider (#441)

- **FR-020**: The Image provider MUST show the image fitted to the panel — whole image visible,
  centred, never enlarged beyond its natural size by Fit — or at actual size, as **Image: Default fit**
  chooses, each time a file is shown. *(Superseded by FR-020a.)*
- **FR-020a**: *(2026-11-19, third round.)* Every Image, SVG and PDF preview MUST open at **100%** — or at
  **Fit** where the picture, or a PDF's widest page, is larger than the panel (on either axis for a picture; across
  for a PDF, whose pages run on down). There is no setting for it. The opening view holds until the reader zooms or
  chooses Fit, so a panel resized before then follows the same rule. A Mermaid diagram already opens this way: its
  Fit never enlarges past 100% (054). *(2026-11-20, fifth round, superseding the reset-is-Fit rule of 054's MT-04
  round for these previews.)* The zoom reset (Ctrl+Alt+0 and its siblings) returns this opening view — 100% for a
  picture or page that fits, Fit for one that does not — never Fit for a picture smaller than the panel. A Mermaid
  diagram's reset stays Fit, which is its opening view.
- **FR-021**: The image MUST be read through the preview protocol's source route under the project's
  confinement (044 FR-074; realpath re-check), never through a `file:` URL or `fs` in the renderer.
- **FR-022**: The panel's status strip MUST show the image's pixel dimensions and file size,
  digit-grouped. *(2026-11-20, sixth round.)* Beside them, the zoom the picture is shown at; an SVG Preview's strip
  shows its zoom, and a PDF Preview's shows it beside the page (FR-062).
- **FR-023**: An Image Preview MUST follow the file on disk (044 FR-023): a change redraws it without
  reopening, keeping the view mode.
- **FR-024**: A file that cannot be decoded MUST show one inline notice in the panel (044 FR-026), never
  a blank panel, a broken-image glyph or a raw error string.
- **FR-025**: An image whose decoded size would exceed a bounded pixel count MUST show an inline notice
  instead of being drawn, so a small file with huge dimensions cannot exhaust memory or stall the
  window (Principle XII). The bound is a plan constant, not a setting.
- **FR-026**: An animated image MUST play; while the OS reduced-motion preference is on, it MUST show
  its first frame only.
- **FR-027**: *(Superseded by FR-027a and FR-027b, 2026-11-19.)* The backdrop behind the image MUST come
  from theme tokens and keep transparent regions distinguishable from the panel in every shipped theme.
- **FR-027a**: An Image or SVG preview MUST draw its picture on a solid **canvas** filling the whole panel
  body, in the theme colour **Picture Preview Background** (`pictureCanvas`); unset, it is derived from the
  editor background and text colour so it differs from the editor background, and the picture's edges are
  visible in every shipped theme.
- **FR-027b**: A picture's transparent areas MUST be drawn over a diagonal **hatch** in the theme colour
  **Picture Transparency Marker** (`pictureHatch`; unset, derived from the editor background and text
  colour), at a constant on-screen spacing at every zoom, in bands of ten thin lines and ten thicker ones, every
  thin line alike and every thick one alike *(sixth round: one repeated tile, at whole-pixel offsets)*. **Image: Hatch transparent areas** and **SVG:
  Hatch transparent areas** (`editor.previews.providers.<id>.transparencyHatch`, shipped on) turn it off,
  leaving the canvas showing plainly. Both colours are edited in Preferences → Themes; the toggles in
  Preferences → Settings with the provider.
- **FR-028**: An Image Preview's body menu MUST offer **Copy Image** (the image as a bitmap on the
  clipboard) and **Copy Path**; it MUST NOT offer text Copy or Select All.

#### Image and SVG view controls (maintainer's additional requirement)

- **FR-030**: An Image Preview and an SVG Preview MUST carry exactly the view controls a Mermaid
  preview has (054 FR-046b – FR-046e, FR-046h, FR-046l – FR-046n): **Fit**, **Zoom In**, **Zoom 100%**,
  **Zoom Out**, middle-button pan with the move cursor, Ctrl+wheel zoom about the pointer,
  Ctrl+middle-click to Fit, the panel zoom chords redirected to the picture, and the fading zoom
  percentage — by drawing through the same diagram frame, so the two cannot drift apart.
- **FR-031**: As in a Mermaid preview (054 FR-046a's exception, FR-046f), the picture fills the panel,
  Fit uses its width and height, ~~the panel shows no scrollbar at any zoom~~ *(superseded by FR-031a)*,
  and the panel header's Focus Mode is the maximise route; there is no inline Maximise. The picture opens
  in the **centre** of the panel, and the view controls sit in its top-left corner whatever the picture's
  size (2026-11-19: the fill rules covered Mermaid alone, so a small picture's viewport collapsed and
  clipped its controls).
- **FR-031a**: *(2026-11-19.)* An Image or SVG preview MUST scroll horizontally and vertically, with
  scrollbars, whenever the picture at its current zoom is larger than the panel, and show no scrollbar
  while it fits. The picture stays centred while smaller than the panel on an axis. Middle-button drag
  moves the scroll position, and a zoom step keeps the point under the pointer (or at the centre)
  where it is; Fit and Zoom 100% centre the view. A Mermaid preview keeps 054's pan-only view.
- **FR-031b**: *(2026-11-19, second round.)* An Image or SVG preview's Fit MUST **fill** the panel: the
  largest scale at which the whole picture fits, enlarging a picture smaller than the panel (FR-031's Fit,
  the opening view is FR-020a's). Zoom In from a Fit already past the usual zoom
  ceiling still zooms in. A Mermaid diagram's Fit still never enlarges past 100% (054).
- **FR-031c**: *(2026-11-19, second round.)* On an axis where the picture does NOT fill the panel, a
  middle-button drag MUST move the picture itself, following the pointer; on an axis where it overflows,
  the drag scrolls (FR-031a). Fit and Zoom 100% put it back in the centre.
- **FR-031d**: *(2026-11-19, fourth round.)* A fitted picture (Fit, or the opening view) MUST hold still at every
  panel size, panel zoom and app zoom: it fits, so it never scrolls and never raises a scrollbar. Only a chosen zoom
  scrolls. (Defect: at app zoom 1.33 and 0.9 sub-pixel rounding raised both scrollbars, the smaller viewport refitted
  smaller, the scrollbars went, and the picture refitted again, indefinitely.)
- **FR-031e**: *(2026-11-19, fourth round.)* An Image or SVG Preview MUST follow its panel as it resizes, at most once
  per frame, as a PDF or HTML preview does — not once the drag pauses. A diagram inside a document keeps 054 B5's
  coalescing.
- **FR-031f**: *(2026-11-20, fifth round.)* A zoomed picture MUST hold its scrollbars still at every zoom step, at
  every app zoom. (Defect: zoomed out from 100% at app zoom 1.33 or 0.9, a picture no larger than its viewport lost
  and regained both scrollbars for good — its stage was sized from the viewport's whole-pixel measurement, which
  rounded past the real width. The stage is now the picture's own extent with a CSS minimum of the viewport.)
- **FR-031g**: *(2026-11-20, sixth round, extending 054's #486 indicator for previews.)* An Image, SVG, PDF or
  Mermaid preview MUST always show its zoom percentage in its top-right corner, faded as its view controls are until
  the pointer is over the preview (full in Focus Mode), and full for a moment after every zoom step.
- **FR-032**: Zoom, pan and view mode MUST be view state only (054 FR-046g): never written to the file,
  never marking anything dirty, reset when the preview is reopened, kept across a live redraw.
- **FR-033**: *(Fourth round: a zoom control's tooltip also names its chord — Zoom in and Zoom out the panel zoom
  chords. The zoom reset chord names the button that matches the opening view: Fit for a diagram, Zoom 100% for a
  picture or a PDF (fifth round).)* Every control MUST be a themeable icon control with a tooltip naming it, reachable and
  operable by keyboard, and the body's right-click menu MUST offer what a Mermaid preview's offers
  (054 FR-046k: Copy Image, Focus Mode), so no action is reachable only from the toolbar.
- **FR-034**: An image is drawn smoothly when shrunk and with visible pixels (no smoothing) when
  enlarged past 100%, so pixel art and icons can be inspected.
- **FR-035**: An image or SVG drawn inside a Markdown preview (FR-054, FR-055) MUST carry the controls
  and right-click menu an inline Mermaid diagram carries there (054 FR-046a – FR-046n), including its
  inline Maximise and the box height a document may give it (`|300`, `height=300`).

#### SVG provider (#631)

- **FR-040**: The SVG provider MUST draw a `.svg` file **as an isolated image** (Q3): the browser's
  image mode, in which an SVG cannot run script or load anything outside itself. An SVG file may
  contain scripts and links to remote content; throng draws it as a picture so none of that runs.
- **FR-041**: The SVG provider MUST offer the editor status-bar preview button, Open Preview and Open In
  → Preview, as every text provider does (044 FR-001 – FR-003).
- **FR-042**: A parented SVG Preview MUST follow the editor's unsaved content within the update delay
  and maximum wait (044 FR-022, FR-060, FR-060a); a standalone one MUST follow the disk.
- **FR-043**: An SVG MUST draw at its intrinsic size from `width`/`height`, or from its `viewBox` when
  those are absent, and fit per FR-031.
- **FR-044**: A previewed SVG MUST run no script and load nothing outside its own content: no
  `<script>`, no event-handler attribute, no `javascript:` URL, no `<foreignObject>` content that runs
  or loads, no external `href`/`xlink:href`, no `@import`, no `url()` outside the file, and no fetch of
  a local project file either. Image mode guarantees it; a test MUST assert it against a hostile SVG
  fixture, at the lowest layer that can (that the drawing is image-mode) and end-to-end in the real
  engine (FR-090).
- **FR-045**: A malformed SVG, or one whose drawing exceeds a bounded time, MUST show the preview's
  inline failure notice; if the same preview drew successfully earlier in its life, the last good
  drawing MUST stay, dimmed, under the notice, which clears on the next good draw (054 FR-044's rule).
  Live updates MUST NOT blank the preview.
- **FR-046**: *(Extends 054 FR-046i's supersession of 044 FR-122a to SVG.)* **Synchronise Scrolling**
  MUST be absent from an SVG Preview and from its source's editor — menus, status-bar toggle and
  chord. Open Preview, Go to Editor and Open in Editor are unaffected.
- **FR-047**: An SVG Preview can reveal its one picture: a Find in Files match in an `.svg` whose Open
  SVG files in is Throng Preview MUST open the SVG Preview alone, focused, as 054 FR-030/FR-032 do for
  a Mermaid file, and MUST NOT also open an editor.
- **FR-048**: An SVG Preview's body menu MUST offer **Copy Image** (the SVG rasterised at its natural
  size as a bitmap) and copy of the file's source as text, as a Mermaid preview's copy offers its
  source, and MUST NOT offer text Select All.

#### SVG in a Markdown preview (#631, Q4)

- **FR-050**: `![alt](relative/path.svg)` in a Markdown preview MUST draw the local SVG in place, resolved
  and confined as any local image is (044 FR-084), with a test that uses a **local, relative** SVG.
  Any gap found is fixed in this feature.
- **FR-051**: `![[diagram.svg]]` and `![[diagram.svg|200]]` MUST draw as 068 FR-010 and FR-056 draw an
  embedded image.
- **FR-052**: An SVG embedded in a Markdown preview MUST run no script and fetch nothing, whatever the
  SVG contains. It MUST stay an image (not markup merged into the document), so 044 FR-081's sanitiser
  profile is unchanged.
- **FR-053**: Raw inline `<svg>` markup written directly in a Markdown file MUST continue to be removed
  with its content by the Markdown sanitiser (044 *security-policy* Layer 2, `ADD_FORBID_CONTENTS`).
- **FR-054**: *(Extends 054 FR-040 – FR-049.)* A fenced code block whose info string is `svg` MUST be
  drawn as its picture, the way a ```` ```mermaid ```` fence is: through the block-renderer seam, in a
  diagram frame with the inline diagram controls (FR-035), its last good drawing kept under a notice
  while the fence is malformed (054 FR-044), and with exactly FR-040's isolation — no script, no load
  of anything outside the fence. Copy over it copies its source, or its image, as a Mermaid fence's
  does (054 FR-049a). Find leaves the drawing out of the searched text (054 FR-032). The fence is drawn
  whenever the Markdown provider is enabled; there is no separate setting.
- **FR-055**: *(Extends 044 FR-084 and 068 FR-010.)* A **local** image (a project file the preview
  protocol serves) that stands as its own paragraph — `![alt](x.png)`, `![[x.png]]`,
  `![[x.svg|200]]` alone on its line — MUST be drawn in a diagram frame with the inline diagram
  controls (FR-035), keeping its alternative text. An image inline with text, and every remote image,
  stays as it is drawn today.

#### PDF provider (#388)

- **FR-060**: The PDF provider MUST render a `.pdf` as its pages, read-only, in a PDF Preview panel, with
  every page laid out one after another in a vertically scrolling body.
- **FR-061**: The PDF MUST be read through the preview protocol's source route under the project's
  confinement (044 FR-074), never via `fs` or a `file:` URL in the renderer.
- **FR-062**: The panel's zoom (044 FR-034) MUST change the rendered scale of the pages, re-rendering
  them sharp at the new scale rather than stretching a bitmap. The status strip MUST show the current
  page and the page count, digit-grouped.
- **FR-062a**: *(2026-11-19.)* A PDF Preview MUST carry view controls pinned to the body's top-left —
  **Fit page width**, **Zoom In**, **Zoom 100%**, **Zoom Out** — as themeable icon controls with the fading
  zoom percentage, as a picture preview does (FR-030, FR-033). Fit sets the widest page across the panel,
  ~~never enlarged past 100%~~ *(second round, 2026-11-19: Fit FILLS the width, enlarging a page narrower
  than the panel; in Two Pages, two pages fill it — FR-062c)*, and is the view a PDF opens in. The panel's zoom chords and Ctrl+wheel drive
  this view (the reset is Fit), as they drive a drawing that fills its panel; a step keeps the point under
  the pointer, or at the centre, where it is. Pages are re-rendered sharp at every scale (FR-062).
- **FR-062b**: *(2026-11-19.)* In a PDF Preview, the preview's Go to command (`preview.goToHeading`,
  `Ctrl+G`; labelled **Go to Heading or Page…** in the key-bindings editor) and a **Go to Page…** row in the
  body and panel menus MUST open a **Go to Page** modal naming the current page and the page count ("Page 3
  of 120", digit-grouped). Its field MUST accept only a whole number from 1 to the page count — any other
  keystroke is refused — and Enter MUST scroll that page to the top and close the modal; Escape or a click
  outside closes it; focus returns to the pages either way. One command keeps one chord (Principle IV):
  the command a Markdown preview opens Go to Heading with goes to a page where the provider is paged.
- **FR-062c**: *(2026-11-19, second round.)* A PDF Preview MUST offer three **page layouts**, as themeable icon
  controls beside the view controls (pressed while current) and as checked rows of the body menu's View & state
  section (Principle VI): **Single Page** (one under another, the default), **Two Pages** (two to a row, like an
  open book) and **Pages Side by Side** (as many to a row as the panel's width holds, wrapping; a resize
  re-flows them). Changing layout keeps the current page in view. A layout is view state (FR-032).
- **FR-062d**: *(2026-11-19, second round.)* No page may make the body scroll sideways while every page fits:
  each page's selectable text layer MUST be sized for the view's current zoom, painted since or not (a page
  left outside the painted range after a zoom-out kept its wider layer: a horizontal scrollbar on a long PDF),
  and the body's width MUST NOT change as its vertical scrollbar comes and goes (Fit flipped between two
  scales every frame).
- **FR-063a**: *(2026-11-19.)* Every preview whose body scrolls MUST scroll by a **middle-button drag**, the
  content following the pointer with the move cursor, and Chromium's middle-click autoscroll MUST NOT
  start — as a diagram or picture pans (054 FR-046e, FR-031a), which keeps its own drag. Ctrl+middle-click
  stays the zoom reset. *(Superseded 2026-11-20 by FR-074a / FR-083a / FR-085a.)* An HTML Preview cannot: its page is an isolated frame (FR-074) whose pointer events
  never reach throng.
- **FR-063**: The body MUST be scrollable by wheel, scrollbar and keyboard (044 FR-096: arrows, Page
  Up/Down, Home/End); Ctrl+wheel and the zoom chords zoom the panel.
- **FR-064**: A PDF Preview MUST follow the file on disk (044 FR-023) and, after a re-render, keep the
  reader at the same page and approximate position when that page still exists, else the last page.
- **FR-065**: Pages MUST render on demand as they approach the viewport, so opening and scrolling a PDF
  of several hundred pages keeps the window responsive (Principle XII; SC-004). The renderer MUST load
  only when a PDF preview first needs it (054 FR-047's rule).
- **FR-066**: Nothing in a PDF MUST execute or fetch: no embedded JavaScript, no open or page actions,
  no form submission or reset, no launch / file / sound / movie actions, no remote resource. An
  internal link MUST scroll to its target page; an external `http:`/`https:`/`mailto:` link MUST follow
  044 FR-091 and FR-094 (Ctrl+click, hover names the target and gesture); any other link action does
  nothing. Form fields render as their static appearance and are not editable. A test MUST assert
  this against a hostile PDF fixture.
- **FR-067**: An encrypted, password-protected, malformed or truncated PDF MUST show one inline notice
  saying it cannot be displayed and, where known, why (044 FR-026). No password prompt is offered.
- **FR-068**: *(Superseded by FR-068a, 2026-11-19.)* Selecting and copying a PDF's text is out of scope
  (follow-up); the body menu MUST NOT offer Copy or Select All, and MUST offer Copy Path.
- **FR-068a**: A PDF's text MUST be selectable with the pointer and copyable with Copy, the Copy chord
  and Select All (the body menu offers both, and Copy Path), as plain text. The selectable text is PDF.js's
  text layer laid over each painted page at that page's scale: spans whose text PDF.js sets as text, never
  markup, so FR-066 holds. Links stay above the text.
- **FR-069**: The PDF renderer MUST be an existing, actively maintained open-source library whose
  licence is compatible with throng's AGPL-3.0-only licence, recorded in the plan's research with its
  licence named (for example, PDF.js under Apache-2.0). Chromium's built-in PDF viewer is acceptable
  only if it can be held to FR-066 and FR-091; the plan decides between them against those two
  requirements, not on convenience.

#### HTML provider (#508)

- **FR-070**: The HTML provider MUST render an `.html` / `.htm` file as a page in an HTML Preview panel,
  with the editor status-bar preview button, Open Preview and Open In → Preview (044 FR-001 – FR-003).
- **FR-071**: *(Deferral ended by FR-071b, 2026-11-20.)* A parented HTML Preview MUST follow the editor's unsaved content within the update delay
  and maximum wait (044 FR-022, FR-060, FR-060a); a standalone one MUST follow the disk. *(Narrows 044
  FR-024 for HTML, deferred: the isolated frame's scroll position cannot be read from outside it
  (FR-074), so an update redraws the page from its top until a follow-up restores the place; plan
  Complexity Tracking.)*
- **FR-071b**: *(2026-11-20, ending FR-071's deferral.)* An HTML Preview MUST update in place: when its
  source changes (the editor's unsaved text, or the file on disk), the page on screen MUST stay drawn until
  the new version replaces it — never a blank, white or flashing frame between the two — and the reader's
  scroll position on both axes MUST be kept, clamped where the new page is shorter or narrower. The page
  still runs no script of its own (FR-074, FR-088): the mechanism is the plan's, and it may not depend on
  the page.
- **FR-072**: *(Font deferral ended 2026-11-20: the same-origin frame (FR-074a) loads a relative `@font-face` from the asset route, and FR-072a a safe remote one.)* Relative resources the page names — stylesheets (including `@import` of a relative
  stylesheet), images, `srcset` candidates and CSS `url()` — MUST resolve against the file's own
  folder and load from disk through the preview protocol, and MUST apply to the page (2026-11-19: the
  `srcdoc` frame inherits the renderer's content policy, whose `style-src` refused the asset route, so
  a page's linked stylesheets never applied; the grant is FR-092's). A change to one of them on disk MUST be
  shown at the next update or Refresh. Web fonts (`@font-face`) are deferred: an isolated frame may
  load a font only with a cross-origin grant the preview protocol does not give (plan Complexity
  Tracking); the page falls back to its next font.
- **FR-072a**: *(2026-11-20, superseding FR-075 and FR-093 for HTML only.)* **Safe HTML preview sources**: an
  HTML Preview MAY load **stylesheets, fonts and images** — nothing else — from a remote source on its safe
  list. The list is the global preference **HTML: Safe preview sources**
  (`editor.previews.providers.html.safeSources`, shipped `https://fonts.googleapis.com` and
  `https://fonts.gstatic.com`) plus the project's own list in **Project Settings**. A source is an
  `https:` origin, optionally with a leading `*.` for its subdomains; `http:` is never a source. Scripts
  never run and nothing navigates whatever the list says (FR-074, FR-076, FR-088); SVG and PDF previews keep
  FR-093. Each layer of 044's security-policy contract (FR-091) enforces the list, not one of them alone.
- **FR-072c**: *(2026-11-20, derived.)* A wildcard `https://*.example.com` admits every subdomain at any depth and not
  `example.com` itself; a port must match exactly (none listed = the default port); a redirect is a new request and
  is judged on its own URL; an entry that is not a source is refused by the editor that adds it and dropped when a
  stored list is read.
- **FR-073**: Every resource request MUST be confined to the preview's project by its real path
  (Principle I; 044 FR-074 and the realpath re-check); a path or symlink that leaves the project loads
  nothing, silently.
- **FR-074**: *(Opaque-origin clause superseded by FR-074a, 2026-11-20.)* The page MUST render in an **isolated, sandboxed frame** whose document has a unique
  opaque origin and no access to throng's renderer, its preload bridge, its storage or any other
  preview. **Scripts MUST NOT run**: no `<script>`, no event-handler attribute, no `javascript:` URL,
  no script in an SVG or nested document.
- **FR-074a**: *(2026-11-20, superseding FR-074's "unique opaque origin".)* The frame MAY share the renderer's
  origin so the panel can update the page in place (FR-071b), read and restore its scroll, search it (FR-086b)
  and handle its input and menu directly (FR-083a, FR-085a). Scripts MUST still never run, each refused by its
  own layer: the sanitiser removes them, the frame's sandbox grants no `allow-scripts`, and the page's content
  policy grants no script source. The page MUST still have no preload bridge of its own, no navigation of the
  panel, no forms and no nested documents (FR-076, FR-077).
- **FR-075**: *(Superseded for the safe list's stylesheets, fonts and images by FR-072a, 2026-11-20.)* The page MUST make **no network request** of any kind — scripts, stylesheets, fonts,
  images, media, `srcset`, CSS `url()`, prefetch/preload, `<link rel>` of any kind, beacons — whatever
  any provider's settings say; the Markdown provider's **Load remote images** does not apply to HTML.
  A blocked remote resource is simply absent.
- **FR-076**: The page MUST NOT navigate the panel or anything else: `<meta http-equiv="refresh">`,
  `<base href>`, a link click, a form submission and a `target` attribute MUST leave the preview showing
  the same document. It MUST NOT open a window, a dialog, a popup, a download or a permission prompt.
- **FR-077**: Forms MUST NOT submit; nested `<iframe>`, `<frame>`, `<object>` and `<embed>` MUST load
  nothing.
- **FR-078**: The frame MUST NOT be able to steal keyboard focus from the rest of throng, change the
  window title, or draw outside the preview body (no overlay of panel chrome, whatever its CSS).
- **FR-079**: A link in the page MUST follow the constitution's one gesture (5.5.0): **Ctrl+click**,
  and **Ctrl+Enter** where it has keyboard focus; a plain click follows nothing. Hover MUST name the
  target and the gesture. An `http:`/`https:`/`mailto:` link MUST open in the OS default handler (044
  FR-091, FR-119); a relative link to a project file MUST open it as 044 FR-090 and 054 FR-008
  prescribe; a same-document `#fragment` link MUST scroll the preview to its target; any other link
  does nothing.
- **FR-080**: #508's wording "clicking a link" is read as following a link by the constitution's
  gesture (FR-079); this is a reading of the issue, not a supersession of any requirement.
- **FR-081**: When the page contained script, the preview MUST say so ~~once, inline and dismissible, per
  preview~~ *(superseded by FR-081a)* — "Scripts in this page do not run in the preview" — never as a
  notification or toast (*one condition, one notice*).
- **FR-081a**: *(2026-11-19, third round.)* The scripts notice MUST belong to the page on screen: shown, inline
  and dismissible, whenever that page carried script; gone as soon as a page without script replaces it; and shown
  again for every page loaded with script, whether or not an earlier one was dismissed. A Dismiss holds for its
  page through that page's live updates.
- **FR-082**: The page's own CSS MUST apply inside the frame and MUST NOT affect anything outside it; the
  panel MUST supply a themed default background and text colour only where the page sets none.
- **FR-083**: The panel's zoom (044 FR-034) MUST scale the rendered page. *(2026-11-19, third round.)* At every
  zoom the frame MUST fill the space under the notice and follow the panel as it resizes, its scrollbar on the
  panel's edge (CSS `zoom` on the frame did not: a 336px body held a 256px frame at 1.3×).
- **FR-083a**: *(Mechanism amended by FR-074a, 2026-11-20: the panel hears the page's input from the frame document itself; the behaviours below stand.)* *(2026-11-19, third round.)* Input inside the page MUST reach the app as it does anywhere else in the
  panel: a click in the page activates the panel; while focus is in the page, app chords (Ctrl, Alt or Meta, and the
  function keys) run as they would from the panel — the zoom chords included — and Ctrl+wheel over the page zooms it.
  The page keeps its own keys (typing, arrows, paging) and still receives every key. The page runs no script and has an
  opaque origin, so the app hears its input from the main process, never from inside it. *(Fourth round.)* Focus in
  the page MUST show its panel as the foreground window's active panel, not the dimmed inactive one: the window still
  holds the foreground while a frame in it has focus. Ctrl+middle-click on the page resets the zoom as it does
  anywhere in the panel.
- **FR-084**: A Find in Files match in an HTML file MUST open an editor at the match, whatever Open HTML
  files in says: the HTML provider cannot reveal a source position (054 FR-033).
- **FR-085**: *(Out-of-scope clause superseded by FR-085a, 2026-11-20.)* The body MUST allow selecting text and copying it with the Copy chord as **plain text**,
  whatever the preview copy format. Rich copy, and a body right-click menu inside the page, are out of
  scope: the page is an isolated document the panel cannot read into (FR-074).
- **FR-085a**: *(2026-11-20, superseding FR-085's out-of-scope clause for the menu and rich copy.)* A
  right-click inside an HTML page MUST open the panel's body menu with **Split**, **Select All**, **Copy**,
  **Copy as Rich Text** and **Find…**, as a Markdown preview's body menu offers them. Copy as Rich Text puts
  the selection on the clipboard as HTML with a plain-text alternative; Copy stays plain text.
- **FR-085b**: *(2026-11-20, derived.)* The shared body menu's other rows that apply to a selection — **Copy as
  Plain Text** — are offered too, as on every preview.
- **FR-086**: *(Superseded by FR-086b for HTML, 2026-11-20.)* The preview find bar (#420) SHOULD search the rendered page when the seam allows it
  without change; when it does not, Find MUST be shown disabled on an HTML Preview and a follow-up
  issue filed, never offered and broken.
- **FR-086a**: *(2026-11-19, superseding 047 FR-007's "always present" for pictures.)* An Image or SVG Preview
  has no text to search: **Find…** MUST be absent from its body and header menus, and the `search.find` chord
  consumed and inert there. **Go to Heading…** is likewise absent from its header menu, as from its body menu
  (FR-046): a single picture has nothing to go to.
- **FR-086b**: *(2026-11-20, superseding FR-086's disabled Find for HTML.)* Find MUST work in an HTML
  Preview: the preview find bar searches the rendered page's text, highlights every match, shows the count
  and steps Next / Previous, scrolling each into view. No preview offers Replace.
- **FR-086c**: *(2026-11-20.)* Find MUST work in a PDF Preview across the whole document — pages not yet
  drawn included — scrolling the page holding each match into view. Every preview with text has Find;
  Image and SVG keep FR-086a.
- **FR-086d**: *(2026-11-20.)* Find in an HTML or PDF Preview MUST be the preview find bar every other panel
  uses — the same bar, chords, match highlighting, count, Next / Previous and case / word / regex options — not a
  variant of it. A provider that cannot offer exactly that has no Find (FR-086a's rule), never a lesser one.
- **FR-087**: *(Supersedes 044 FR-122a for HTML.)* **Synchronise Scrolling** MUST be absent from an HTML
  Preview and from its source's editor: an HTML page has no block-to-source map.
- **FR-088**: Allowing a page's scripts to run — globally, per project or per file — is out of scope;
  any future opt-in is its own issue with its own security decision.

#### The security boundary (all four)

- **FR-090**: Each provider MUST have a hostile fixture and a test, at the lowest layer that can prove
  it plus one end-to-end check in the real engine, asserting that previewing it runs no script, makes
  no request leaving the machine, reads nothing outside the project, opens no window and does not
  navigate — the 044 SC-004 pattern (`preview-hostile.e2e.ts`) extended to Image (a polyglot file), SVG,
  PDF and HTML, and to the ```` ```svg ```` fence.
- **FR-091**: The four independent layers of 044's security-policy contract (sanitiser or isolation,
  content policy, request filter, protocol confinement) MUST each still hold for every new provider;
  a defect in one layer MUST NOT be enough to run code or make a request. The contract MUST be amended
  in this feature with each new provider's row.
- **FR-092**: Where a provider needs the renderer's content policy or the preview protocol's response
  policy widened (a frame source for HTML; a worker or a fetch for PDF), the grant MUST be the
  narrowest that works — scoped to the preview protocol, to that provider's route, and to the
  directive it needs — MUST NOT widen what Markdown or any other surface may do, and MUST be recorded
  in the security-policy contract with the reason and the test that pins it. `renderer-csp.test.ts`
  MUST be updated to pin the new policy exactly.
- **FR-092a**: *(2026-11-20, narrowing FR-092 for FR-074a.)* A same-origin `srcdoc` frame inherits the renderer's
  content policy, which is fixed when the window loads, while the safe list is the user's to edit. The renderer policy
  therefore grants `style-src https:` and `font-src 'self' https: throng-preview:`, and the list is enforced by the
  frame's own policy and by the request filter: the filter MUST refuse an `https:` stylesheet or font from every
  renderer document but an HTML Preview frame, and from that frame unless its registered sources admit it. Pinned by
  `renderer-csp.test.ts` and `renderer-request-policy.test.ts`; recorded in 044's security-policy contract.
- **FR-093**: *(Superseded for HTML by FR-072a and FR-093a, 2026-11-20.)* The request filter MUST refuse every `http:`/`https:` request from an SVG, PDF or HTML
  preview, independently of the Markdown provider's Load remote images setting.
- **FR-093a**: *(2026-11-20.)* When an HTML Preview leaves out remote resources, the panel MUST raise **one**
  inline notice (one condition, one notice) listing each one left out, grouped by its source, with
  **Allow this source** per source. Allowing adds the source to the project's safe list (FR-072a) and reloads
  the page; the notice names the global **HTML: Safe preview sources** preference for trusting a source in
  every project. A source that can never be allowed (`http:`, a script) is listed without the action.
- **FR-094**: The preview protocol MUST serve each binary provider only the MIME types it declares
  (seam contract `sourceMimeTypes`), with `Content-Security-Policy: sandbox` and `nosniff` as every
  response carries today.

#### Documentation and governance

- **FR-100**: `docs/preferences.md` MUST document every new setting and the renamed Open … in rows;
  `README.md` and the docs index MUST name the new preview types where Markdown and Mermaid previews are
  named; the security-policy and provider-seam contracts MUST be amended (FR-091, FR-092) in the same
  change (Documentation currency).
- **FR-101**: Every new bindable command (if any) MUST appear in the key-bindings editor and
  `docs/key-bindings.md`, shipping unbound, and have a menu item.
- **FR-102**: Any new runtime library MUST be named in the plan with its licence and confirmed
  compatible with AGPL-3.0-only before it is added.
- **FR-103**: *(2026-11-20.)* Every preview provider MUST be able to declare its own **preview icon**, a themeable
  icon key in the icon set (Principle VI: themeable icon controls), drawn wherever that type's preview is named: the
  preview panel's header, its tab and the tab picker, the editor's status-bar preview button and every menu row that
  opens a preview of that type. The shipped Markdown, Mermaid, Image, SVG, PDF and HTML providers each declare one,
  drawn as the preview icon with a mark for the type, so they read as one family. A provider that declares none
  shows the generic **preview** icon. Each new icon key MUST carry its description and appear in every shipped
  icon set.
- **FR-104**: *(2026-11-20, superseding 044 FR-031's " - Preview" suffix; FR-032's rule that the suffix is never
  cut stands.)* A preview's title MUST be `<name> - <Type> Preview`, where `<Type>` is the provider's display name
  (`Markdown`, `Mermaid`, `Image`, `SVG`, `PDF`, `HTML`). A preview with no file yet keeps its placeholder title.

### Key Entities

- **Safe HTML preview source** *(2026-11-20)*: an `https:` origin, optionally `*.`-prefixed, from which an
  HTML Preview may load stylesheets, fonts and images. Held in two lists — the global preference and the
  project's list in Project Settings — whose union applies (FR-072a).

- **Preview provider descriptor** (044): identity, display name, extensions, kind, own settings,
  `sourceMimeTypes` for binary, and — new, provider-neutral — the plural noun its Open … in label uses
  and an optional label for its `preview` option. Four new descriptors: `image`, `svg`, `pdf`, `html`.
- **Provider settings** (`editor.previews.providers.<id>.*`): `enabled`, `defaultOpenAction` (every
  provider; `editor` | `preview` | `os`), `openTarget` (every provider), `maxFileBytes`; Image and SVG
  add `transparencyHatch` (FR-027b). *(Image's `defaultFit` was removed by FR-020a.)*
- **View state** (not persisted beyond 044 FR-066's zoom): an image or SVG's view mode, zoom and pan; a
  PDF's scroll position (persisted, as a preview's scroll is, through navigation history).
- **Hostile fixtures**: one per provider, under `packages/ui/tests/fixtures/preview/`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can see any PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG, PDF or HTML file in the
  project without leaving throng, from the same places a Markdown preview opens from.
- **SC-002**: Previewing each provider's hostile fixture runs no script, makes zero requests leaving the
  machine, reads zero files outside the project, opens no window and does not navigate — asserted by
  tests in the real engine.
- **SC-003**: *(2026-11-20: asserted on reference hardware; CI runners record the reading, per the repo's performance-SLA rule.)* A 10 MB image and a 5 MB SVG appear within 1 second of opening on the CI runners; a
  parented SVG or HTML preview shows an edit within the configured update delay plus 250 ms.
- **SC-004**: *(2026-11-20: asserted on reference hardware; CI runners record the reading, per the repo's performance-SLA rule.)* A 500-page PDF shows its first page within 2 seconds of opening, and scrolling through it
  never freezes the window for more than 100 ms at a time.
- **SC-005**: A file over its provider's size limit shows its notice within 200 ms, with no read of the
  file's content.
- **SC-006**: Adding the four providers changes no file in the preview panel, its menus, the status
  bar, Files & Folders or the preferences editor beyond registration, views, settings, provider-neutral
  seam extensions and the named security-policy grants (checked by the seam's guard test).
- **SC-007**: `![x](relative.svg)` and a ```` ```svg ```` fence in a Markdown preview each render, proven
  by a test.
- **SC-008**: Every preview type's Preferences subsection carries an **Open <files> in** row worded the
  same way, and each of its values does what it names from Files & Folders and Quick Open, proven by
  tests over every shipped provider.

## Assumptions

- The existing preview seam (044, 054) needs no structural change to host binary and text providers of
  these kinds; the plan's first research task is to confirm what the current CSP and the source route's
  `sandbox` response policy permit for PDF and HTML before choosing a renderer or isolation mechanism.
- The image extension list matches what Chromium decodes natively; no image-decoding library is added.
- PDF text selection, search, thumbnails, outline, annotations, form filling, printing and password
  entry are follow-ups (#388 out-of-scope list), each its own issue when wanted.
- HTML scripts, remote resources, dev servers, devtools, scroll sync and printing are out of scope
  (#508); printing from any preview type is #484.
- Visual SVG editing, animation playback controls and export/rasterisation to a file are out of scope
  (#631).
- Resource Monitor attribution for preview panels is #498's, not this feature's.
- The size-limit defaults (FR-011) are chosen to stay well below what a renderer process handles
  comfortably on the CI runners; the maintainer may change them at review.
- No preview has a Default fit setting: every one opens by FR-020a's rule.
- *(Default taken, 2026-11-18.)* **Default OS Program** is not followed by a Find in Files result
  (FR-019): an OS program cannot show a match, and the result's whole purpose is the match.
- *(Default taken, 2026-11-18.)* Only a **local** image standing as its own paragraph is framed in a
  Markdown preview (FR-055). Framing every image would put a toolbar on each build badge and inline
  icon and break the line it sits in, and a remote image cannot be copied as a bitmap without reading
  it from the network a second time.
- *(Default taken, 2026-11-18.)* The ```` ```svg ```` fence has no setting of its own (FR-054): it is
  drawn as a picture, isolated, and there is nothing in it to turn off for safety. A reader who wants
  the source shows it in the editor.
- *(Default taken, 2026-11-18.)* *(Superseded 2026-11-20 by FR-074a / FR-083a / FR-085a.)* An HTML Preview's body has no right-click menu inside the page, and
  its Copy is the Copy chord's plain text (FR-085): the page is an opaque-origin document the panel
  cannot read into, which is the isolation FR-074 requires.
