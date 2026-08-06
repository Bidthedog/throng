# Quickstart: validating Terminal Render & Input Fidelity (028)

Prerequisites: Windows 11, the repo built (`npm install && npm run build`). Run the app with
`npm start`.

## Automated gates

```bash
npm run lint
npm run typecheck
npx vitest run --project unit --project integration --project contract
npx playwright test packages/ui/tests/e2e/terminal-tab-switch-render.e2e.ts \
                   packages/ui/tests/e2e/terminal-redraw-action.e2e.ts \
                   packages/ui/tests/e2e/terminal-wheel-altscreen.e2e.ts \
                   packages/ui/tests/e2e/terminal-input-idle.e2e.ts \
                   packages/ui/tests/e2e/terminal-link-once.e2e.ts
```

The #200 volume soak is **opt-in** (FR-024a) and is not part of the normal run:

```bash
THRONG_SOAK=1 npx playwright test packages/ui/tests/e2e/terminal-input-soak.e2e.ts
```

It prints its repetition count and the flavours it covered (FR-024c).

## Scenario 1 — a tab switch no longer corrupts a terminal (#162)

1. Open a project and create **two tabs**.
2. In tab 1, add a terminal that **fills the tab**. In tab 2, add a terminal **split beside another
   panel**, so the two terminals are visibly different widths. This difference matters — with equal
   widths the fault often will not show.
3. In each terminal run something that paints a full screen and keeps updating, e.g.
   `for ($i=0; $i -lt 100000; $i++) { cls; Get-Date; Get-ChildItem }` in PowerShell, or a Claude Code
   session if you have one.
4. Switch tab 1 → tab 2 → tab 1, ten times, without touching a divider.
5. **Expect**: every terminal is correctly rendered the moment its tab appears — no overlapping
   glyphs, no fragments of an earlier frame, wrapping at that panel's own width. Before this feature
   this was wrong on almost every switch.
6. **Also check**: the switch itself still feels instant, and no panel changed size.

## Scenario 2 — the manual redraw action (#163)

1. With a terminal panel focused, press **`Ctrl+F5`**. Nothing visible should change on a healthy
   terminal, and nothing should be typed into the shell.
2. **Right-click inside the terminal** → a **"Refresh / redraw terminal"** entry is present. Invoke it.
3. **Right-click the panel header** → the same entry, same name. Invoke it.
4. Before invoking, note the scrollback position, any text you have selected, and where the cursor is.
   **Expect** all three unchanged afterwards, the layout untouched, and a running program uninterrupted.
5. Press `Ctrl+F5` in an **editor** panel and in the **file tree** — expect nothing to happen there.
6. Open Preferences → Keyboard: the action is listed and its chord can be changed or cleared.

## Scenario 3 — the mouse wheel (#187)

1. In a terminal, run a full-screen program that does **not** use the mouse (e.g. `less` on a long
   file, or a Claude Code session).
2. Scroll the wheel over it **without pressing any key first**. **Expect**: the program's own view
   moves (the wheel is sent as up/down arrows). Before this feature, nothing happened at all.
3. At an ordinary shell prompt with plenty of output, scroll the wheel. **Expect**: the view scrolls
   through scrollback, and **no characters appear on the command line**.
4. Hold **Ctrl** and scroll. **Expect**: the panel zooms, exactly as before.
5. In a program that *does* claim the mouse (e.g. `vim` with `:set mouse=a`), scroll. **Expect**: the
   program handles it itself.

## Scenario 4 — no keystroke is lost after idling (#200)

1. Open a Git Bash terminal panel, then work elsewhere in throng for several minutes.
2. Click straight back into the panel and immediately type `git status`.
3. **Expect**: `git status` — all of it. Not `it status`.
4. Repeat reaching the panel by keyboard rather than by clicking, and again after a tab switch, a
   project switch, and an app restart with the session re-attached.
5. Repeat in PowerShell and cmd. This one is intermittent, so try it several times each.

## Scenario 5 — links open exactly once (#198)

1. Print a URL as plain text (`echo https://example.com`) and Ctrl+click it → **one** browser tab.
2. Ctrl+click a hyperlink whose visible text is the URL → **one** tab.
3. Ctrl+click a hyperlink whose visible text differs from its target → **one** tab, at the target.
4. Click any of them **without** Ctrl → nothing opens.
5. **The alternate-screen case needs you**: run an agent session that prints a link on its full-screen
   UI and Ctrl+click it. Note whether one tab opens or two, and whether the URL appears twice on the
   line. This is the condition automation cannot reach, and per FR-055b your own check is what settles
   #198 — the write-up on the issue explains what was already measured and ruled out.
