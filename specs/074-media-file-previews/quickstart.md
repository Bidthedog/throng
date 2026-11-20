# Quickstart: validating Media File Previews (074)

## Prerequisites

A built throng from this branch (`npm run build`, never while a throng from the same worktree is
open), and a project folder holding: `a.png`, `anim.gif`, `logo.svg`, `doc.pdf` (several pages),
`page.html` with `style.css` and `img/logo.png` beside it, and `notes.md` containing
`![Logo](logo.svg)` on its own line, `![[a.png]]` and a ```` ```svg ```` fence. Copy the hostile
fixtures from `packages/ui/tests/fixtures/preview/` into it.

## Automated

| Layer | Command |
|---|---|
| core unit | `td run --runner unit --scope file --target packages/core/tests/unit/preview-open-in-074.test.ts` |
| ui unit/component | `td run --runner unit --scope file --target <file>` / `--runner component` |
| integration | `td run --runner integration --scope file --target packages/ui/tests/integration/preview-protocol-074.integration.test.ts` |
| E2E | `pipeline.yml` dispatch, `-f stages=e2e -f e2e_filter=preview-media` |

## By hand

1. Open each file from Files & Folders: each lands in its own panel type (Image, SVG, PDF, HTML
   Preview); `notes.md` opens in an editor.
2. Image / SVG: Fit, Zoom In, Zoom 100%, Zoom Out, middle-drag, Ctrl+wheel, right-click → Copy Image;
   paste into an image editor.
3. Edit `logo.svg` in an editor beside its preview: the drawing follows unsaved edits.
4. PDF: scroll, zoom the panel, regenerate the file on disk.
5. HTML: open beside its editor; type; Ctrl+click an `https:` link (browser opens), plain click
   (nothing happens).
6. Preferences → Editor → Previews: each subsection has **Open <files> in**; set Open PDFs in to
   Default OS Program and open `doc.pdf` from Files & Folders — the system viewer opens it.
7. Hostile fixtures: each draws (or renders static markup) with no network request (watch the
   devtools Network tab of a dev build), no window and no navigation.
