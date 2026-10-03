# throng

**Every project, every terminal, one window.**

[![CI](https://github.com/Bidthedog/throng/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/Bidthedog/throng/actions/workflows/ci.yml?query=branch%3Amaster)
[![Release](https://github.com/Bidthedog/throng/actions/workflows/release.yml/badge.svg)](https://github.com/Bidthedog/throng/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/Bidthedog/throng?include_prereleases&sort=semver&label=release&color=blue)](https://github.com/Bidthedog/throng/releases/latest)
[![v1.0.0 progress](https://img.shields.io/github/milestones/progress-percent/Bidthedog/throng/1?label=v1.0.0)](https://github.com/Bidthedog/throng/milestone/1)
[![Platform](https://img.shields.io/badge/platform-Windows%2011-0078D4)](#getting-started)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

throng is a desktop workspace for people who live in the command line. Give each project its own
folder and colour, then build it a home: tabs and split panels holding real PowerShell, Git Bash
and CMD terminals beside a code editor, a live file tree and rendered previews, arranged the way you
think and restored exactly as you left it. Terminals run in a background service, so closing the
window never kills a build, a server or an AI agent mid-task — reopen throng and they are still
there, scrollback and all. Switch projects in a keystroke, tear a tab off onto a second monitor, and
run a dozen agents across a dozen repositories without losing track of any of them.

<!-- VIDEO: whistle-stop tour of throng (v1.0.0), tracked in #445. Embed it here. -->

## The problem it solves

A serious day of development means an IDE, a scatter of terminal windows in different shells, a
handful of Explorer folders and, more and more, several AI agents each working in their own
directory — spread across a taskbar with no idea which window belongs to which project. Close the
wrong one and a long-running job dies with it. throng pulls all of that into one keyboard-first
window where every project is its own isolated space, and nothing you start is lost when the window
goes away.

## Features

- **Projects and categories** — each project owns a root folder and a colour; group them into categories and switch between them from the keyboard.
- **Dockable workspace** — unlimited tabs of drag-to-split panels, saved and restored per project.
- **Sub-workspaces** — tear tabs or panels off into their own windows that move as one group.
- **Terminal panels** — your real installed shells, owned by a background service so they survive a restart and reattach.
- **Editor panels** — a fast code editor with syntax highlighting for 31 languages, crash recovery and one buffer per file across every window.
- **File explorer** — a live, project-scoped file tree with undoable rename, move, copy and delete, and cut, copy and paste between projects.
- **Find across files and Quick Open** — search and replace the whole project, or jump to any file by name.
- **Previews** — rendered, live-updating Markdown beside its editor, with scroll kept in sync, find,
  a heading outline, section folding shared with the editor, and wikilinks.
- **Clickable links** — paths, URLs and hyperlinks in terminals, editors and previews open where they belong.
- **Keyboard-first** — every pane, panel and project reachable from one consistent set of chords, all rebindable.
- **Make it yours** — a visual preferences window, 14 bundled themes, icon packs and live-reloading config files.

## Getting started

throng runs on **Windows 11** today; macOS ([#22](https://github.com/Bidthedog/throng/issues/22)) and
Linux ([#23](https://github.com/Bidthedog/throng/issues/23)) are planned.

1. **Install it** — download the installer, a portable build or a zip from the
   [Releases page](https://github.com/Bidthedog/throng/releases). No admin rights and no prerequisites;
   [installation](docs/installation.md) covers every option, verifying the download, and running from
   source.
2. **Take the tour** — the [quick start](docs/quick-start.md) goes from first launch to a working
   project in a few minutes.
3. **Go deeper** — every guide is listed in the [docs index](docs/README.md): key bindings,
   preferences, environment variables, architecture, testing and releasing.

Running from a clone instead:

```bash
npm install
npm start
```

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how work is proposed, specced,
built and reviewed, and the bar every change is tested to; what's planned lives in the
[issue tracker](https://github.com/Bidthedog/throng/issues), grouped by
[milestone](https://github.com/Bidthedog/throng/milestones).

## Licence

Copyright © 2026 Christopher Sebok, licensed **AGPL-3.0** — see [LICENSE](LICENSE) and
[COPYRIGHT.md](COPYRIGHT.md).
