---
name: macos-lane-chords
description: @core E2E specs also run on the macOS lane, so application chords they press must be ControlOrMeta, not Control
metadata:
  type: project
---

The macOS E2E job runs `--grep '@core|@macos'` (spec 070), so every `@core` spec runs on a Mac too. On macOS the
shipped application chords are Cmd's (`ctrlToMeta` over the Windows table, plus `MACOS_BINDING_OVERRIDES` in
`packages/core/src/config/keybindings.ts`), so a `@core` spec that presses `Control+…` for a throng command misses.

**Why:** a `Control+s` that worked on Windows and Linux silently does nothing on macOS, and the spec fails for a
reason unrelated to its subject.

**How to apply:** in a `@core` spec, press application chords as Playwright's `ControlOrMeta+…`. Keep plain
`Control` for keys meant for the shell or the editor's own Ctrl behaviour (a terminal's Ctrl+C). Overridden chords
(Ctrl+` focus cycle, Ctrl+M,x markdown folds) stay Ctrl on macOS, so `ControlOrMeta` is wrong for those; read the
override table. Tooltips render chords through `chordLabel` (Apple order: Ctrl, Option, Shift, Cmd).
