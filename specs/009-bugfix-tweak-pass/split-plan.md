# Split Plan: 009 → 010–014

**Decided**: 2026-07-10
**Status**: agreed; successor specs to be authored

The consolidated `009-bugfix-tweak-pass` spec grew to 14 user stories and 98 functional requirements
across one specify pass and two clarify passes. It is split into five standalone features.

## Why split by code surface, not by user-facing theme

Grouping by theme ("themes", "terminals", "preferences") reads well but executes badly: it scatters
each feature across many files, so two features in flight collide at merge, and any one agent must
hold an unrelated mix of concerns in context. Splitting by the files actually touched keeps each
feature's context small and keeps concurrent branches disjoint.

Three consequences shaped the grouping:

1. **The deep one is isolated.** Terminal session integrity (010) is the only work that loses user
   data, involves a daemon/renderer race, and needs real end-to-end coverage. Nothing cosmetic shares
   its branch.
2. **The bulk one is isolated.** Theme content (011) is high-volume, low-reasoning work — hand-writing
   ~28 token descriptions and three palettes. Mixed into an architectural feature it crowds out the
   reasoning.
3. **Terminal flavour configuration is not terminal work.** The launch path already functions
   end-to-end; the defect is that `terminals.flavours` renders as a raw JSON textarea. Fixing it means
   building a structured object-array editor — the same widget work as the notched sliders, the digit
   grouping and the font clear-all. It therefore belongs to 014, not to 010.

## The five features

| Feature | User stories from 009 | Primary code surface |
|---|---|---|
| `010-terminal-session-integrity` | 1 (session survival), 2 (grid arbitration) | `daemon/terminal-service.ts`, `main/terminal-ipc.ts`, `main/daemon-client.ts`, `renderer/terminal/use-terminal.ts`, `renderer/workspace/panel-body.tsx`, `detach-context.tsx` |
| `011-theme-content` | 6 (palettes), 7 (token descriptors), 8 (gutter tokens) | `core/config/theme.ts`, `core/config/theme-metadata.ts`, `core/config/default-themes/`, `renderer/editor/editor.css` |
| `012-focus-contexts-and-search` | 3 (binding contexts, focus model, panel zoom), 14 (find & replace) | `core/config/keybindings*.ts`, `renderer/app.tsx`, `editor/editor-chrome.tsx`, `workspace/active-pane.ts`, `terminal/use-terminal.ts`, `editor/use-editor.ts` |
| `013-shipped-defaults-and-theme-editor` | 5 (theme actions, icon buttons, dialogs, icon packs, shipped defaults) | `main/config-store.ts`, `main/icon-pack-service.ts`, `preferences/themes-tab.tsx`, `preferences/preferences-app.tsx` |
| `014-preferences-and-main-window` | 4 (Escape), 9 (sliders, separators), 10 (flavour config), 11 (affordances, removal verbs), 12 (project folder), 13 (bindings search, row controls) | `preferences/form-controls.tsx`, `settings-tab.tsx`, `keybindings-tab.tsx`, `core/config/settings-metadata.ts`, `projects-panel.tsx`, `panel-type-form.tsx`, `tab-group.tsx` |

## Dependency order

```
wave 1  (parallel)   010 terminal-session-integrity
                     011 theme-content

wave 2  (parallel)   012 focus-contexts-and-search      (after 010)
                     013 shipped-defaults-and-theme-editor (after 011)

wave 3               014 preferences-and-main-window    (after 012 and 013)
```

A dependency must be **merged to `master`**, not merely planned, before its dependents begin.
Otherwise the dependent's tests are authored against code that does not exist.

### Why each edge exists

- **012 after 010** — both rewrite `renderer/terminal/use-terminal.ts`. 010 changes its resize path;
  012 adds focus, zoom and the binding contexts.
- **013 after 011** — 013 turns the bundled themes into distributed immutable artifacts. Doing that
  before 011 recolours Bash, SUBNET and Cyberpunk would produce artifacts that must be regenerated.
- **014 after 013** — restoring a single key binding to its default (and the preferences-level reset)
  reads from the shipped-defaults artifacts that 013 introduces.
- **014 after 012** — both edit `workspace/panel-placeholder.tsx`: 012 for focus and zoom, 014 for the
  removal-verb glossary.

## Conflict hotspots

| File | Touched by | Mitigation |
|---|---|---|
| `renderer/terminal/use-terminal.ts` | 010, 012 | Sequenced across waves; never concurrent |
| `renderer/workspace/panel-placeholder.tsx` | 012, 014 | Sequenced across waves |
| `core/config/default-themes/index.ts` | 011, 013 | Sequenced across waves |
| `preferences/form-controls.tsx` | 014 only | Why user story 10 lives in 014 rather than with the terminal work |

## Cost of standalone specs

Each successor restates the decisions it depends on, so the same fact is written in two places:

- The SUBNET and Cyberpunk hex values → 011.
- The four removal verbs and their consequence matrix → 014.
- The focus model, the `F6` release binding and the Escape pass-through rule → 012, restated in part
  by 014 (the preferences window's own Escape handling is a separate, non-conflicting rule).

If one of those decisions changes later, it changes in more than one file. That is the accepted price
of specifications that clarify and execute independently.

## Prerequisites landed before the split

1. **Constitution v3.12.0** — the "Action controls MUST be themeable icons with hover titles" rule
   (originally FR-037 of 009). It gates the Constitution Check of all five successors, so it had to
   reach `master` before any of them was branched. A narrow exception was added for dialog decision
   buttons, whose text label *is* the statement of consequence the user consents to.
2. **Bridge handoff reset** — `.specify/superpowers-handoff.json` still pinned
   `specs/007-preferences-editor` at status `executing` long after that feature shipped, which made
   the bridge guard deny `speckit.implement` for every subsequent feature. Reset to `idle`.
