# Launch-sharing assessment — every spec, and what was decided

**Required by**: FR-023 — *"Every spec file MUST be assessed for whether its tests require a
separately launched application, and the outcome of that assessment MUST be recorded for every file,
including the files that keep their own launches."*

**Feature**: [spec.md](./spec.md) · **Baseline**: [baseline.md](./baseline.md)

Measured on `origin/master` `d55054b`: **681 `runApp()` launches for 782 tests**, against 47 shared
`openApp()` calls in 42 of 235 files. At the ~2 seconds per launch `docs/testing.md` records for CI,
that is roughly 23 minutes of process startup inside a suite that runs in 40.

---

## The four decisions

| Decision | Files | Launches | Meaning |
| --- | ---: | ---: | --- |
| `shared` | 42 | 165 | already converted before this feature |
| `own` | 121 | 340 | must keep a launch per test |
| `candidate` | 59 | 176 | no pre-launch seeding found — worth converting, one at a time |
| `n/a` | 13 | 0 | launches no app of its own |

**`own` is a real answer, not a gap.** A test that seeds a configuration root, a database, an
environment variable or `skipDaemon` before the app starts cannot share one, because the shared app
is already running by the time the test asks. The shim in every converted file *throws* on options
rather than ignoring them, because a dropped seed does not fail a test — it makes it pass for the
wrong reason. That was measured once already in this suite, where a swallowed
`editor.openOnClick: 'double'` let a single click open a file and the assertion saw 2 opens where it
expected 0.

---

## What a candidate is worth, and what it costs

A candidate is a file where nothing was found seeding state before launch. It is **not** a promise
that the conversion works. The assessment reads the *setup*; what actually breaks a conversion is
whether the **assertions** depend on a pristine app — accumulated panels, projects and panes.

`docs/testing.md` records the rate from the previous attempt: of 54 files assessed, 34 converted and
**20 were reverted**. This feature added one more point to that ledger, deliberately.

### `panel-tooltips.e2e.ts` — converted, verified, reverted

Five launches for five tests, no seeding: a clean candidate on paper. It was converted with the
established shim, then run twice at one worker with retries off. It failed **both** times at
`panel-tooltips.e2e.ts:91` — *"a renamed panel shows its NEW title on hover"*. The test renames the
first panel and asserts the header carries the new title; in a shared app the panel it finds is not
the one it means.

**Reverted rather than adjusted**, which FR-024 requires and which is worth restating: a conversion
patched with a more specific selector until it goes green has not been made correct, it has been
made quiet. The ~10 seconds it would have saved are not worth a test that stops failing when the
feature breaks.

One candidate of 59 measured, and it went the way roughly a third of them are expected to.

---

## Remaining work

The candidates below are the work-list, ordered by launches saved. Each needs converting and
verifying **individually** — the whole point of the ledger above is that the rate cannot be assumed,
so nothing here should be swept in bulk. `terminal-claude-keys` heads the list but is opt-in behind
an environment flag and never runs in a default run, so it saves nothing in practice.

A realistic ceiling: 59 candidates hold 176 launches and would keep 59 between them, so a complete
conversion at the historical two-in-three rate saves on the order of 75–80 launches — a few minutes
of a 40-minute suite. Worth having, and worth doing carefully rather than quickly.

---

## Every spec

| Spec | Launches | Tests | Decision | Why |
| --- | ---: | ---: | --- | --- |
| `terminal-claude-keys.e2e.ts` | 9 | 9 | candidate | 9 launches for 9 tests, no pre-launch seeding found |
| `preferences-fonts-and-sliders.e2e.ts` | 7 | 7 | candidate | 7 launches for 7 tests, no pre-launch seeding found |
| `subworkspaces.e2e.ts` | 6 | 6 | candidate | 6 launches for 6 tests, no pre-launch seeding found |
| `theme-sizes-and-notices.e2e.ts` | 6 | 6 | candidate | 6 launches for 6 tests, no pre-launch seeding found |
| `explorer-follow-active-editor.e2e.ts` | 5 | 5 | candidate | 5 launches for 5 tests, no pre-launch seeding found |
| `notice-subjects.e2e.ts` | 5 | 5 | candidate | 5 launches for 5 tests, no pre-launch seeding found |
| `panel-tooltips.e2e.ts` | 5 | 5 | candidate | 5 launches for 5 tests, no pre-launch seeding found |
| `preferences-window.e2e.ts` | 5 | 5 | candidate | 5 launches for 5 tests, no pre-launch seeding found |
| `theme-fonts.e2e.ts` | 5 | 5 | candidate | 5 launches for 5 tests, no pre-launch seeding found |
| `tree-drop-open.e2e.ts` | 5 | 5 | candidate | 5 launches for 5 tests, no pre-launch seeding found |
| `app-close-terminals.e2e.ts` | 4 | 4 | candidate | 4 launches for 4 tests, no pre-launch seeding found |
| `editor-basics.e2e.ts` | 4 | 4 | candidate | 4 launches for 4 tests, no pre-launch seeding found |
| `editor-feedback2.e2e.ts` | 4 | 4 | candidate | 4 launches for 4 tests, no pre-launch seeding found |
| `editor-feedback3.e2e.ts` | 4 | 4 | candidate | 4 launches for 4 tests, no pre-launch seeding found |
| `pane-auto-collapse.e2e.ts` | 4 | 4 | candidate | 4 launches for 4 tests, no pre-launch seeding found |
| `panes.e2e.ts` | 4 | 4 | candidate | 4 launches for 4 tests, no pre-launch seeding found |
| `config-hotreload.e2e.ts` | 3 | 3 | candidate | 3 launches for 3 tests, no pre-launch seeding found |
| `destroy-cascade.e2e.ts` | 3 | 3 | candidate | 3 launches for 3 tests, no pre-launch seeding found |
| `pane-shortcuts.e2e.ts` | 3 | 3 | candidate | 3 launches for 3 tests, no pre-launch seeding found |
| `panel-sync.e2e.ts` | 3 | 3 | candidate | 3 launches for 3 tests, no pre-launch seeding found |
| `subworkspace-owned-terminal.e2e.ts` | 3 | 3 | candidate | 3 launches for 3 tests, no pre-launch seeding found |
| `terminal-no-orphans.e2e.ts` | 3 | 3 | candidate | 3 launches for 3 tests, no pre-launch seeding found |
| `terminal-wheel-altscreen.e2e.ts` | 3 | 3 | candidate | 3 launches for 3 tests, no pre-launch seeding found |
| `theme-tokens.e2e.ts` | 3 | 3 | candidate | 3 launches for 3 tests, no pre-launch seeding found |
| `about-async.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `active-panel.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `editor-gutter.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `editor-mirrored-undo.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `editor-naming.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `editor-open-target.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `editor-subworkspace.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `editor-tab-destroy-reopen.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `explorer-new-items.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `explorer-selection-visibility.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `fileop-lock-cause.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `focus-context.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `focus-zoom-layout.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `hover-suppression.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `layout.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `os-drop-defects.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `panel-name-unique.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `panel-rename-key.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `panel-type-form.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `project-counts.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `project-creation.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `project-rename-guard.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `scrollbars.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `status-bar-deduped.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `status-bar-visibility.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `status-bar.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `subworkspace-detach.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `subworkspace-rename-title.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `terminal-admin-integrity.e2e.ts` | 2 | 0 | candidate | 2 launches for 0 tests, no pre-launch seeding found |
| `terminal-flavours.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `terminal-input-idle.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `terminal-modified-enter.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `terminal-startup-command-flavours.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `title-statusbar.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `unsaved-dot-pulse.e2e.ts` | 2 | 2 | candidate | 2 launches for 2 tests, no pre-launch seeding found |
| `terminate-all-drain.e2e.ts` | 19 | 12 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `preferences-json.e2e.ts` | 17 | 17 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `preferences-themes.e2e.ts` | 12 | 12 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `preferences-reset.e2e.ts` | 11 | 11 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `notice-logging.e2e.ts` | 10 | 10 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `preferences-row-actions.e2e.ts` | 10 | 10 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `preferences-settings.e2e.ts` | 10 | 10 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-move-repoint.e2e.ts` | 9 | 8 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `os-drop.e2e.ts` | 9 | 9 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `preferences-keybindings.e2e.ts` | 9 | 9 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `icon-packs.e2e.ts` | 8 | 8 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `notification-prefs.e2e.ts` | 8 | 8 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `project-settings.e2e.ts` | 7 | 7 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `colour-picker.e2e.ts` | 6 | 6 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `panel-auto-naming.e2e.ts` | 6 | 5 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-missing-aggregate.e2e.ts` | 5 | 4 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-undo-recovery.e2e.ts` | 5 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `explorer-tree-state.e2e.ts` | 5 | 5 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `preferences-map-control.e2e.ts` | 5 | 5 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `preferences-slider.e2e.ts` | 5 | 5 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `terminal-start-failure-controls.e2e.ts` | 5 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-cross-project-restore.e2e.ts` | 4 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-file-deleted.e2e.ts` | 4 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `error-dismiss.e2e.ts` | 4 | 4 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `explorer-live-sync.e2e.ts` | 4 | 4 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `new-project-folder.e2e.ts` | 4 | 4 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `notice-consolidation.e2e.ts` | 4 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `tab-settings.e2e.ts` | 4 | 4 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `config-write-failure.e2e.ts` | 3 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `delete-mixed.e2e.ts` | 3 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `diagnostics-logging.e2e.ts` | 3 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-menus.e2e.ts` | 3 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-stranded-recovery.e2e.ts` | 3 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `icon-colour.e2e.ts` | 3 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `preferences-theme-reset.e2e.ts` | 3 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `settings-write-integrity.e2e.ts` | 3 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `terminal-command-memory.e2e.ts` | 3 | 5 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `terminal-directory-memory.e2e.ts` | 3 | 3 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `terminal-launch-failure-config.e2e.ts` | 3 | 1 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `daemon-status-bar.e2e.ts` | 2 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `default-themes.e2e.ts` | 2 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `drag-ghost.e2e.ts` | 2 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-indicators.e2e.ts` | 2 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-recovery-stale.e2e.ts` | 2 | 1 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-recovery.e2e.ts` | 2 | 1 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `editor-stranded-restart.e2e.ts` | 2 | 1 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `failure-copy.e2e.ts` | 2 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `loaded-projects.e2e.ts` | 2 | 1 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `notice-a11y.e2e.ts` | 2 | 1 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `preferences-rapid-edit.e2e.ts` | 2 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `project-missing-root-wedge.e2e.ts` | 2 | 1 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `search-keybindings-editor.e2e.ts` | 2 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `terminal-persistence.e2e.ts` | 2 | 1 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `theme-flash.e2e.ts` | 2 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `theme-sweep.e2e.ts` | 2 | 2 | own | seeds state before the app starts (config root, data dir, env or skipDaemon) |
| `config-files.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `confirm-modality.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `context-menu-sections.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `context-menu-shortcuts.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `copy-path.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `daemon-death-notice.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `daemon-selfspawn.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `editor-external-change-named.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `editor-highlight-perf.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `editor-reveal-file.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `editor-scroll-position.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `editor-search-highlight.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `editor-subworkspace-owned.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `editor-word-wrap.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `explorer-dir-doubleclick.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `explorer-keyboard-selection.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `ghost-drag-noise.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `handles.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `keybindings.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `language-picker-keyboard.e2e.ts` | — | — | — | **DELETED** — 034 FR-045: every assertion moved to `packages/ui/tests/component/language-picker-keyboard.test.ts`, as seven tests. STRONGER THERE: the strip is flanked by focusable controls placed before and after it, so the focus-trap claim is a SEQUENCE (a trap that pinned focus satisfied the E2E eight times over); and the chosen override is asserted on the `document.setState` params, which the E2E never looked at. NOTHING STAYED: the picker’s clamp against the window edge is real layout (Principle V / FR-049) and was never asserted here — it lives in `editor-language-override.e2e.ts`. ANTI-VACUITY CONTROL: publish `undefined` from the `ServicesProvider` in `mount()`; `useServices()` throws inside `LanguagePicker` and all seven fail. |
| `notice-overlay.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `notice-stacking.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `panel-owner-align.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `panel-reset-name.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `preferences-scroll.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `preferences-terminal-flavours.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `project-browse-neutral.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `project-rename-subworkspace.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `rename-noop.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `select-popup.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `shipped-defaults-startup.e2e.ts` | 1 | 5 | own | one launch already — nothing to amortise |
| `side-pane-max.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `subworkspace-content-sync.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `subworkspace-drift-heal.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `subworkspace-persist-error.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `subworkspace-prefs-modality.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `subworkspace-rename-sync.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `subworkspace-titlebar.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-activation-cost.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-admin.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-altscreen-parity.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-cwd.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-de-elevation-hang.e2e.ts` | 1 | 0 | own | one launch already — nothing to amortise |
| `terminal-dual-size.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-editing-matrix.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-env-freshness.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-font.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-input-soak.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-links.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-mirror-survival.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-mirror.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-path-drop.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-redraw-action.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-refresh.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-resize.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-revert.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-root-lock.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-slow-start.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-tab-switch-render.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-title-header.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal-title-persist.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `terminal.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `theme-buttons.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `theme-fields.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `tree-unsaved-dot.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `workspace-min-width.e2e.ts` | 1 | 1 | own | one launch already — nothing to amortise |
| `explorer.e2e.ts` | 17 | 18 | shared | already converted |
| `editor-content-menu.e2e.ts` | 8 | 8 | shared | already converted |
| `editor-find.e2e.ts` | 8 | 9 | shared | already converted |
| `editor-column-select.e2e.ts` | 7 | 7 | shared | already converted |
| `terminal-kitty-editing-keys.e2e.ts` | 7 | 7 | shared | already converted |
| `editor-file-switch.e2e.ts` | 6 | 6 | shared | already converted |
| `editor-highlighting.e2e.ts` | 5 | 6 | shared | already converted |
| `editor-indentation.e2e.ts` | 5 | 5 | shared | already converted |
| `editor-language-override.e2e.ts` | 5 | 7 | shared | already converted |
| `fileop-undo.e2e.ts` | 5 | 5 | shared | already converted |
| `sidebar.e2e.ts` | 5 | 5 | shared | already converted |
| `terminal-link-once.e2e.ts` | 5 | 5 | shared | already converted |
| `context-menu-icons.e2e.ts` | 4 | 4 | shared | already converted |
| `editor-caret-persist.e2e.ts` | 4 | 4 | shared | already converted |
| `editor-cut-line.e2e.ts` | 4 | 4 | shared | already converted |
| `editor-feedback.e2e.ts` | 4 | 4 | shared | already converted |
| `editor-replace.e2e.ts` | 4 | 4 | shared | already converted |
| `explorer-rename-focus.e2e.ts` | 4 | 4 | shared | already converted |
| `menu-keyboard.e2e.ts` | 4 | 4 | shared | already converted |
| `menus.e2e.ts` | 4 | 5 | shared | already converted |
| `panel-zoom.e2e.ts` | 4 | 4 | shared | already converted |
| `removal-verbs.e2e.ts` | 4 | 4 | shared | already converted |
| `subworkspace-sync.e2e.ts` | 4 | 4 | shared | already converted |
| `terminal-find.e2e.ts` | 4 | 4 | shared | already converted |
| `terminal-startup-command.e2e.ts` | 4 | 6 | shared | already converted |
| `app-icon.e2e.ts` | 3 | 4 | shared | already converted |
| `destroy.e2e.ts` | 3 | 3 | shared | already converted |
| `editor-command-scope.e2e.ts` | 3 | 3 | shared | already converted |
| `editor-function-highlight.e2e.ts` | 3 | 3 | shared | already converted |
| `editor-open.e2e.ts` | 3 | 3 | shared | already converted |
| `explorer-rename-reentry.e2e.ts` | 3 | 3 | shared | already converted |
| `move-focus.e2e.ts` | 3 | 3 | shared | already converted |
| `terminal-altscreen-fidelity.e2e.ts` | 3 | 3 | shared | already converted |
| `terminal-scrollback-nav.e2e.ts` | 3 | 3 | shared | already converted |
| `titlebar-chrome.e2e.ts` | 3 | 5 | shared | already converted |
| `panel-failure-banner.e2e.ts` | 0 | 10 | shared | already converted |
| `tab-actions.e2e.ts` | 0 | 8 | shared | already converted |
| `tab-name-limit.e2e.ts` | 0 | 9 | shared | already converted |
| `tab-picker.e2e.ts` | 0 | 9 | shared | already converted |
| `tab-presentation.e2e.ts` | 0 | 11 | shared | already converted |
| `tab-scroll.e2e.ts` | 0 | 13 | shared | already converted |
| `tab-strip-overflow.e2e.ts` | 0 | 4 | shared | already converted |
| `about.e2e.ts` | 0 | 5 | n/a | launches no app of its own |
| `app-shell.e2e.ts` | 0 | 4 | n/a | launches no app of its own |
| `context-menu.e2e.ts` | 0 | 4 | n/a | launches no app of its own |
| `drag-to-new-tab.e2e.ts` | 0 | 1 | n/a | launches no app of its own |
| `harness-shutdown.e2e.ts` | 0 | 1 | n/a | launches no app of its own |
| `performance.e2e.ts` | 0 | 2 | n/a | launches no app of its own |
| `persistence-restore.e2e.ts` | 0 | 2 | n/a | launches no app of its own |
| `phase9.e2e.ts` | 0 | 5 | n/a | launches no app of its own |
| `projects.e2e.ts` | 0 | 4 | n/a | launches no app of its own |
| `terminal-clipboard.e2e.ts` | 0 | 3 | n/a | launches no app of its own |
| `terminal-reattach.e2e.ts` | 0 | 1 | n/a | launches no app of its own |
| `ux-refinements.e2e.ts` | 0 | 8 | n/a | launches no app of its own |
| `workspace-docking.e2e.ts` | 0 | 4 | n/a | launches no app of its own |
