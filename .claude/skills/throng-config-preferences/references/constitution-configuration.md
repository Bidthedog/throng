# Themes, quoted settings, editor completeness and digit grouping — constitution detail

Binding: constitution Principle X and Development Workflow & Quality Gates (`.specify/memory/constitution.md`, *X. Externalised Configuration; Development Workflow & Quality Gates*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1. This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## Principle X — every theme setting belongs to its theme

**Every theme setting belongs to its theme.** Switching theme is a promise that the whole
look changes with it.

- Everything a theme governs — every colour, font, size and typography role, its icon set and its
  icon colour — MUST be stored in that theme's file, and nowhere else. No theme value lives in the
  settings, in another theme, or in the session.
- Activating a theme MUST restore every one of those values from its file. Nothing from the theme
  that was active before may remain on screen, and an edit MUST be written to the theme it was made
  in.
- An optional token left unset is the theme's own choice, stored with it like any value.
- A token added to the shipped themes MUST reach every theme file already on disk, through the
  additive upgrade that `SHIPPED_DEFAULTS_VERSION` gates, so the version moves in the same change.
  `theme-leaves-version.test.ts` fails the build for a theme leaf added or removed under an
  unchanged version.
- A token missing from a theme's file — the Themes JSON tab can delete one — MUST be drawn from
  that theme's own record (a built-in's shipped value; for a custom theme, the base theme it fills
  from at upgrade), never from whichever theme was active before or from a global default.

## Principle X — settings are quoted by value (known gaps included)

**Settings are quoted by value.** Text that tells the user about a setting is only true while it
reads the setting.

- Any user-facing text that refers to a quantity a setting governs — a notice, error, tooltip,
  setting description, menu row, dialog or status text — MUST state that setting's **current
  value**, read when the text is shown, in the unit the setting's Preferences control displays,
  digit-grouped per the digit-grouping gate (Development Workflow & Quality Gates).
- It MUST NOT state the shipped default, a constant copied from the code, or an estimate.
- Documentation that lists defaults names them as defaults.
- This is an **end-state requirement** under the Incremental Delivery rule, binding on new work
  immediately. Known violations, audited 2026-11-20 and being fixed by the numeric-settings work on
  the branch that adopts this rule:
  - `packages/ui/src/renderer/preview/preview-notice.tsx` — the too-large notice states the limit
    in bytes, where the spreadsheet preview's *Preview size limit* is displayed in MB.
  - `packages/ui/src/renderer/editor/editor-missing-notice.ts` — "too large to open in an editor"
    names `editor.maxOpenFileBytes`'s limit without stating it.
  - `packages/core/src/editor/drop.ts` — the drop refusal states the size and the limit
    ungrouped.
  - `packages/core/src/config/settings-metadata.ts` — `resourceMonitor.captureIntervalMs`'s (077
    FR-001's name for `captureIntervalSeconds`) description copies the minimum-interval bands from
    `packages/core/src/resources/settings-resolution.ts`, and `editor.maxOpenFileBytes`'s
    hard-codes "the slider moves in 5 MB steps".
  - `packages/core/src/preview/providers/media-settings.ts` — every media preview's *Maximum file
    size* description hard-codes the same "5 MB steps".

## Quality gate — configuration editors stay in sync with all configurable options

- **Configuration editors MUST stay in sync with all configurable options (NON-NEGOTIABLE).**
  Every configurable application setting, key binding, and theme token MUST be exposed and editable
  through the visual preference editors; when new configuration is added to the application, the
  corresponding editor MUST be updated to expose it, so no configuration is editable only by
  hand-editing JSON. This MUST be enforced by a **declarative editor-metadata registry** (a single
  authoritative source with one descriptor per configurable setting / key-binding action / theme
  token, living in the platform-agnostic core) **plus a completeness test** asserting every
  configurable key/action/token has exactly one descriptor — so a newly added config key without an
  editor descriptor **fails the test**. A change that adds or alters configurable options MUST NOT be
  considered complete, and a PR MUST NOT be merged, while any configurable key lacks its editor
  descriptor. (A raw-JSON escape hatch MAY be offered in addition to, never instead of, the visual
  editor.)

## Quality gate — displayed quantities are digit-grouped, grouping is never stored (known gaps included)

- **Displayed quantities MUST be digit-grouped, and grouping MUST NEVER be stored (NON-NEGOTIABLE).**
  Every **quantity** the application shows a user — in a preference editor, on a status bar, in a
  notice, a dialog, a tooltip, a panel, or any surface added later — MUST be rendered with the
  **active locale's** digit grouping, so `10485760` reads as `10,485,760` rather than as eight digits
  nobody can scan. Grouping applies at every magnitude: a column in which `5000` sits beside `10,000`
  teaches the reader that the separator means something, when it means only that one number crossed a
  threshold.
  - **The rule is about quantities, not about digits.** A quantity is a number the user reads *as an
    amount* — a count, a size, a length, a position, a duration. Three things are therefore **NOT**
    quantities and MUST NOT be grouped:
    - **An identifier or an ordinal inside a name.** `Panel 1024`, `report copy 1024.txt`,
      `Terminal 3`. These are names that happen to contain digits; grouping produces `Panel 1,024`
      and a filename with a comma in it.
    - **A number seeded into an editable field**, unless that field's parser is the **exact inverse**
      of the formatter that seeded it. The preference editors pair the two and so may group; a field
      whose parser accepts bare digits MUST be seeded ungrouped, or its own starting value is invalid
      and submitting an untouched field fails.
    - **Anything machine-read** — a log line, a diagnostic field, a serialised message, a test
      fixture. These are covered by the storage rule below, and are named here because a log is a
      surface a human also reads, which is exactly when the mistake gets made.
  - **Grouping is strictly a view concern.** A grouping character MUST NEVER reach a stored value, a
    settings file, a theme file, or anything crossing a process boundary. The parser that reads a
    displayed number back MUST be the exact inverse of the formatter **for the same locale** — the
    separator is derived from the locale, never assumed to be a comma, because a locale that groups
    with `.` otherwise turns `1.024` into either a corrupted number or a rejected one depending on
    which way the bug falls.
  - Formatting and parsing MUST live in **one** platform-agnostic place, so no surface grows its own.
  A change that adds or alters a surface displaying a quantity MUST NOT be considered complete while
  that surface displays an ungrouped quantity or lets a separator reach a stored value.
  - **The shipped app does not yet satisfy this at every surface**, so this is an end-state
    requirement under Incremental Delivery. Known gaps, all quantities:
    - `packages/ui/src/renderer/app-close-prompt.tsx` — the running-terminal count.
    - `packages/ui/src/renderer/sidebar/subworkspaces-panel.tsx` — the tab and panel counts in a
      sub-workspace row's tooltip.
    - `packages/ui/src/renderer/subworkspace-app.tsx` — its local `plural()` helper.

    Closing a gap is not required by the feature that happens to touch the file; it is required
    before that surface's next *numeric* change.
