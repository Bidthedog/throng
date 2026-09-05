# Changelog

What changed in each release of throng, written for someone deciding whether to take an update.

<!--
  HOW THIS FILE IS USED — it is not decoration.

  The release pipeline reads the section for the version being published and puts it at the top of
  the GitHub Release body, above the fixed footer (the unrecognised-app warning, the checksum table
  and the source commit). Publication is REFUSED, with no override, when the section for that
  version is missing, empty, or headed with a different version. See specs/042 FR-005.

  So: add to `## Unreleased` as work merges, and rename that heading to the version at release
  preparation time, BEFORE the tag is pushed. The review that matters happens on this file's diff.

  FORMAT — the parser is deliberately narrow so that it can refuse:
    - A release is an `## <exact version>` heading, optionally followed by an em-dash and a date.
    - Group entries under `### Added`, `### Fixed`, `### Changed`, `### Removed` or
      `### Known issues`. An unrecognised heading is passed through rather than dropped.
    - Entries are `-` list items, one line each, written in user terms rather than commit terms.
    - A release with genuinely nothing user-visible carries exactly one entry, the literal line
      `- No user-visible changes in this release.` Anything else that is empty is a refusal.
    - HTML comments (including this one) never reach a release body.

  The 1.0.0-alpha1, alpha2 and alpha3 sections below were RECONSTRUCTED after those releases
  shipped, from the work between their tags. They were not reviewed at the time, because this file
  did not exist yet.
-->

## Unreleased

### Added
- Two new ways to get throng: a **portable** build that runs without installing, and a **zip
  archive** you extract to a folder of your choosing. The per-user installer is unchanged.

### Fixed
- The **+** buttons that add a tab and add a panel are announced by a screen reader as "New tab" and
  "Add panel" rather than as "plus".
- When you run a command that opens a window — `az login`'s sign-in prompt, a browser-based login, a
  GUI editor — throng now asks Windows to let that window come to the front, instead of leaving it
  behind throng where a terminal looks like it has stopped responding. Windows makes the final
  decision and can still refuse.

### Changed
- Release notes now say what actually changed in each release, above the download checksums and the
  installation guidance that were previously the whole of the release body.
- Every published download is listed with its own SHA-256, against its own filename.
- The **+** at the end of the tab strip is drawn as a tab: it meets the line beneath the tabs
  instead of floating above it as a rounded square, and its glyph sits centred within it.

## 1.0.0-alpha3 — 2026-08-30

### Added
- The editor status bar now reports cursor position, selection size and document length, and the
  gutter can be turned on or off from Settings.
- Terminals reconnect on their own when a working directory that had gone away comes back, and a
  terminal can be reloaded from its panel menu or automatically, controlled by four new settings.
- New Panel now takes its defaults from your preferences rather than from a fixed built-in.

### Fixed
- A single problem now raises a single notice, carrying one row per affected panel, instead of the
  same condition being reported in up to three different places with three different wordings.
- Clicking a notice no longer activated the control underneath it.
- A dormant terminal placeholder now shows the panel's own name and is styled like the rest of the
  panel, and its Reload item is where it can actually be used.
- A terminal preference could out-rank the elevation gate; it is a seed, and it no longer overrides
  the gate.
- Panel names in the popover now match what the panels call themselves, and the popover marks each
  panel's type.
- A cleared rename box now restores the automatic name rather than leaving the panel unnamed.
- Editing a file whose path disappeared is reported rather than failing silently, and a failed
  recovery snapshot now surfaces instead of being discarded.
- Preferences no longer accept an edit before the configuration has finished loading, and a
  configuration read can no longer be broadcast after a write has overtaken it.

## 1.0.0-alpha2 — 2026-08-20

### Added
- **Quick Open** and **Go To Line**, with a project-wide file index behind them and a toggle for
  whether hidden and excluded files are listed.
- A rebuilt notice system: notices say what they are about, group by cause rather than by the panel
  that hit them, carry the whole of an error rather than a summary, and you decide whether and for
  how long each appears.
- A reworked tab strip — per-tab actions, a shared picker, bounded names, and a strip that no longer
  takes its height out of its own tabs.

### Fixed
- Keystrokes now reach the terminal in the order they were typed.
- throng uses the ConPTY it ships with rather than whichever one the machine happens to have, which
  fixes terminal behaviour that differed between machines.
- A settings write could race the file watcher and lose the change.
- An upgrade could rewrite every user's settings file.
- Tabs were clipped even when inactive, and several dialog and overlay defects that could show two
  overlays at once or blank a list mid-interaction.

## 1.0.0-alpha1 — 2026-08-06

The first published build of throng: a project-first terminal and editor workspace for Windows.

### Added
- A per-user installer that needs no administrator rights and installs nothing machine-wide.
- Dockable panes, tabs and panels, with drag, tear-off and sub-workspace windows.
- Terminals with automatic shell detection, detached sessions that survive the window closing, and
  reattachment when it reopens.
- A code editor with syntax highlighting, find and replace, and recovery of unsaved work.
- A project file explorer with full file operations and an undo history.
- A visual preferences editor covering every setting, key binding and theme token, plus fourteen
  shipped themes.

### Known issues
- Downloads are not code-signed, so Windows shows an "unrecognised app" warning on every download.
  The release notes explain how to get past it and how to verify the download against its checksum.
