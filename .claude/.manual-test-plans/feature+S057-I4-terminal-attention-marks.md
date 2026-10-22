# Manual test plan: 057 — show which projects and tabs have a terminal that needs attention

Spec: `specs/057-terminal-attention-marks/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Project row marks from a bell | signed off | f4d7f344f5c3 | 2026-10-22 | |
| MT-02 | Tab, overflow and panel marks | signed off | 5a0e82ea099b | 2026-10-21 | |
| MT-03 | Toasts and Windows notifications | signed off | f4d7f344f5c3 | 2026-10-22 | |
| MT-04 | Taskbar badge | signed off | f4d7f344f5c3 | 2026-10-22 | |
| MT-05 | Attention settings | signed off | f4d7f344f5c3 | 2026-10-22 | |
| MT-06 | Command finished and terminal exited | signed off | 5a0e82ea099b | 2026-10-21 | |
| MT-07 | Go to Next Marked Panel | signed off | 5a0e82ea099b | 2026-10-21 | |
| MT-08 | Marks across a closed window | signed off | f4d7f344f5c3 | 2026-10-22 | |
| MT-09 | Mark in the dot's place, blinking | signed off | 5a0e82ea099b | 2026-10-21 | |
| MT-10 | A mark stays until you focus the panel | signed off | f4d7f344f5c3 | 2026-10-22 | |
| MT-11 | Hover popovers on the project list | signed off | 5a0e82ea099b | 2026-10-21 | |
| MT-12 | Claude Code's notifications reach throng | signed off | f4d7f344f5c3 | 2026-10-22 | |
| MT-13 | Popovers and notifications name the tab and say what ran | signed off | f4d7f344f5c3 | 2026-10-22 | |
| MT-14 | Attention row display settings | signed off | 5a0e82ea099b | 2026-10-21 | |
| MT-15 | Overflow control popover | signed off | 5a0e82ea099b | 2026-10-21 | |
| MT-16 | Clicking a mark cycles its panels | signed off | 5a0e82ea099b | 2026-10-21 | |
| MT-17 | One row per notification type | signed off | 5a0e82ea099b | 2026-10-21 | |
| MT-18 | Ordinary notices reach Windows | signed off | f4d7f344f5c3 | 2026-10-22 | |
| MT-19 | A mark is announced once | signed off | f4d7f344f5c3 | 2026-10-22 | |
| MT-20 | A marked panel's header is filled | signed off | 5a0e82ea099b | 2026-10-21 | |

## MT-01: Project row marks from a bell

Covers: US1, FR-002, FR-004, FR-005, FR-012, FR-017
Paths: `packages/ui/src/renderer/attention/**`, `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/main/attention-service.ts`, `packages/core/src/attention/**`, `packages/core/src/terminal/attention-scan.ts`, `packages/daemon/src/terminal-attention.ts`

### Steps
1. Open two projects, A and B. In a PowerShell terminal in A, run `Start-Sleep 5; [Console]::Write([char]7)` and switch to B at once. Within about a second of the five seconds ending, A's row in the project list shows a ⚑ mark.
2. Hover the mark. The tooltip names the terminal and says "Bell".
3. Switch to A and click into the terminal. The terminal's header mark, and then A's row mark, disappear.
4. In A, split the tab into two terminals and ring a delayed bell in each, then switch to B. A's row is marked. Switch to A and click into only one terminal. A's row stays marked until you click into the second.
5. Make A the active project (its row filled with its colour), ring a delayed bell in a second tab of A, and look at A's row. The mark is clearly visible on the coloured fill, where A's colour dot was, in every theme you normally use (FR-017, FR-092).
6. Put A in a category, minimise the category, and ring a delayed bell in A from B. The category's header row shows the mark.
7. In A, run `Start-Sleep 5; exit 1` in one terminal and ring a delayed bell in another, then switch to B. A's row shows the Failed mark (✖), not the ⚑.

### Negative cases
- Type in a focused terminal and press Tab on something with no completion, so the shell rings. No mark appears anywhere.
- The mark never looks like the unsaved-changes dot on an editor tab: it is a flag or cross glyph, not a dot.

## MT-02: Tab, overflow and panel marks

Covers: US2, FR-010, FR-011, FR-013, FR-015, FR-123
Paths: `packages/ui/src/renderer/attention/**`, `packages/ui/src/renderer/workspace/tab-group.tsx`, `packages/ui/src/renderer/workspace/tab-picker.tsx`, `packages/ui/src/renderer/workspace/tab-popover.tsx`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/common/picker.tsx`

### Steps
1. In one project, have two tabs. Ring a delayed bell in a terminal in tab 1 and show tab 2. Tab 1's chip shows the mark.
2. Open enough tabs that tab 1 scrolls out of the strip, and ring a delayed bell in it. The overflow control on that side shows a mark. Open the tab list from it; tab 1's entry is marked.
3. Split a tab into two terminals, click into the left one, and ring a delayed bell in the right one. The right panel's header shows the mark, and the tab chip and project row do too.
4. Click into the right panel. Its header mark clears, and the tab chip clears.
5. Tab to a mark with the keyboard. Focus lands on it and its name is announced the same as its tooltip.

### Negative cases
- The panel you are typing in never shows a mark of its own while you are in it.
- Hovering a ⚑ on a tab, an overflow arrow, a panel header or a picker row never shows a native (yellow) tooltip; a tab shows only its popover.

## MT-03: Toasts and Windows notifications

Covers: US3, FR-034, FR-035, FR-038a, FR-109, FR-111, FR-115, FR-116, FR-117, FR-120, FR-122
Paths: `packages/core/src/attention/attention-model.ts`, `packages/core/src/attention/attention-holders.ts`, `packages/daemon/src/terminal-attention.ts`, `packages/daemon/src/composition-root.ts`, `packages/ui/src/main/attention-service.ts`, `packages/ui/src/main/electron-system-notifier.ts`, `packages/ui/src/main/window-raise.ts`, `packages/ui/src/renderer/attention/attention-toasts.tsx`, `packages/ui/src/renderer/attention/attention-navigation.ts`, `packages/ui/src/renderer/common/notification.tsx`

### Steps
1. With default settings, ring a delayed bell in a terminal and switch to another application. A Windows notification appears headed "Project — Tab — Title", reading "Wants your attention" — no "(Attention)" or "(Bell)".
2. Click the notification. throng comes forward on that project and tab, the terminal has the keyboard, and its mark has gone.
3. Repeat with throng focused on a different project. Only an in-app toast appears, headed and worded the same way. Its go-to icon sits at the top-right beside the copy and X icons, and looks like them. Click it: it lands on the terminal, and the toast goes.
4. Ring two delayed bells in the same unfocused terminal a few seconds apart. Only one toast shows, not two.
5. With a toast showing for a terminal, go to that terminal by clicking in the project list instead of the toast. The toast is dismissed.
6. Minimise throng with a terminal focused, then let a delayed bell in that same terminal ring. A Windows notification appears.
7. In Preferences → Notifications, switch off **Operating system notifications**. Ring a delayed bell and switch to another application. No Windows notification appears; returning to throng, a toast is showing.
10. Switch **Operating system notifications** back on and switch the Attention row's **OS Notify** off. Ring a delayed bell and switch away: no Windows notification; back in throng, a toast is showing.
11. Start Claude Code in a terminal, give it a task that ends by asking you something, and switch to another application. The Windows notification is headed by Claude's own window title (as the panel header shows it, not "Command Prompt") and reads Claude's message alone ("Claude is waiting for your input"). In another terminal run `Start-Sleep 5`, switch away: its notification reads "Start-Sleep 5 has finished".
8. Open Preferences and leave it focused while a delayed bell rings in a background terminal. The toast appears in the main window, not lost.
9. Give a terminal a startup command (a recipe) that runs `Start-Sleep 5`, launch it, and switch away. When it ends the panel is marked, but no toast or Windows notification appears.

### Negative cases
- No notification ever appears for a terminal you were looking at when it signalled.

## MT-04: Taskbar badge

Covers: US3/AC7, FR-039
Paths: `packages/ui/src/main/electron-taskbar-badge.ts`, `packages/ui/src/main/attention-service.ts`, `packages/ui/src/renderer/attention/badge-renderer.ts`, `packages/ui/src/renderer/attention/badge-answerer.tsx`

### Steps
1. Mark three terminals (delayed bells, switched away), one of them by `Start-Sleep 5; exit 1`. throng's taskbar button carries a badge reading 3, in the Failed style.
2. Go to two of them. The badge reads 1. Go to the last. The badge disappears.
3. Tear a tab off into its own window, then mark a terminal. The new window's taskbar button shows the same count.
4. With a mark showing, tear off a new window. Its button shows the badge without anything else changing.

### Negative cases
- With **Taskbar badge** off in Preferences, no badge appears whatever is marked.

## MT-05: Attention settings

Covers: US4, FR-060, FR-061, FR-062, FR-063
Paths: `packages/core/src/config/settings-metadata.ts`, `packages/core/src/config/app-settings.ts`, `packages/ui/src/main/attention-service.ts`, `packages/daemon/src/terminal-attention.ts`

### Steps
1. Open Preferences and find the attention settings. Under Terminal there is a switch per signal, each description saying whether it is exact or heuristic, a master switch and the went-quiet interval (10–600 s). Under Attention there are only the clear delay and the taskbar badge. The descriptions read correctly.
2. Switch **Bell** off and repeat MT-01 step 1. No mark appears. Switch it back on; the mark appears.
3. Mark a terminal by a bell, then switch **Bell** off. The existing mark stays until you go to it.
4. Mark a terminal, then switch terminal attention off. The mark clears, and no new signal marks anything.
5. Switch **Output went quiet** on with a 10 s interval. In a background terminal run `1..3 | % { $_; Start-Sleep 1 }`, switch away at once, and wait. About 10 s after the output stops, the panel is marked "went quiet".
6. Set the clear delay to 3000 ms. Mark two terminals in one tab, switch to that tab and click into one. The other's mark clears about three seconds later.

### Negative cases
- With Output went quiet on, a terminal that printed only while you were looking at it, which you then leave, is not marked when it goes quiet.
- Working normally in a focused shell — typing, completing, short commands — never raises a mark.

## MT-06: Command finished and terminal exited

Covers: US5, US6, FR-064, FR-065
Paths: `packages/daemon/src/terminal-service.ts`, `packages/daemon/src/terminal-attention.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`

### Steps
1. Run `Start-Sleep 10` in a terminal and switch tabs. Within about two seconds of it ending, the tab is marked, with the reason naming the command.
2. Run `Start-Sleep 5; exit 1` and switch projects. When the shell exits, the project row shows the Failed mark, and the tooltip says it exited with code 1.
3. Go to that panel. The mark clears, and the panel still shows its exit notice.
4. Run `Start-Sleep 5; exit 0` and switch away. The mark is the ⚑ kind, not the Failed kind.

### Negative cases
- Close a terminal yourself (its close button, or terminate it). No mark is raised.

## MT-07: Go to Next Marked Panel

Covers: US7, FR-080, FR-080a, FR-106
Paths: `packages/ui/src/renderer/attention/go-to-next.ts`, `packages/ui/src/renderer/attention/attention-navigation.ts`, `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `packages/ui/src/renderer/title-bar/cog-menu-items.ts`, `packages/ui/src/renderer/title-bar/cog-menu.tsx`, `packages/core/src/attention/attention-next.ts`, `packages/core/src/config/keybindings.ts`

### Steps
1. Mark terminals in two projects. Press Ctrl+Shift+Alt+G. throng switches to the next marked terminal, switching project and tab as needed, and it has the keyboard. Press it again; it lands on the other one.
2. Mark two terminals in a project you are not in, the right-hand one first. Press the binding. It lands on the first one in tab order, not the one marked first.
3. Open the cog menu: there is no **Go to Next Marked Panel** row, and Themes sits directly above Open Logs. Right-click a project that has a marked terminal: its menu offers **Go to Next Marked Panel** (without a chord: it steps through that project only), and choosing it goes to that project's marked terminal. Right-click a project with nothing marked: the item is not there.
4. Open Key Bindings. The command is listed, and you can rebind it.
5. On your keyboard layout, check that typing an AltGr character in a terminal (for example `@` or `€` where your layout uses AltGr for it) types the character and does not trigger the command.

### Negative cases
- With nothing marked, pressing the binding does nothing and shows no notice.

## MT-08: Marks across a closed window

Covers: FR-066, FR-091, US1/AC4
Paths: `packages/ui/src/main/attention-service.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/renderer/attention/attention-store.ts`, `packages/daemon/src/terminal-attention.ts`

### Steps
1. Mark a terminal in project A, then close throng choosing **Leave running**. Reopen it. A's row is still marked, and the taskbar badge shows the count.
2. Close throng with **Leave running**, ring a bell in a terminal while it is closed (start `Start-Sleep 20; [Console]::Write([char]7)` before closing), and reopen after it has rung. A's row is marked.
3. With project A unloaded but its terminals kept running, ring a delayed bell in one. A's row, drawn in the unloaded style, shows the mark.
4. With a mark showing, reload the window (Ctrl+R in a dev build, or tear a tab off). The mark is still shown in the reloaded or new window.

### Negative cases
- Marks you cleared before closing do not come back on reopen.

## MT-09: Mark in the dot's place, blinking

Covers: FR-092, FR-093, FR-094, FR-017, FR-107, FR-114
Paths: `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/ui/src/renderer/attention/**`, `packages/ui/src/renderer/theme.css`

### Steps
1. Mark a terminal in a project that is not highlighted (a delayed bell, switched away). On its row, the ⚑ sits exactly where its colour dot was, and the dot is gone.
2. Mark a terminal in the highlighted project (a delayed bell in another of its tabs). On its filled row the ⚑ again sits where the dot was, uncut, with no disc behind it, in the row's text colour — black or white, as the name is — for a light and a dark project colour.
3. Go to each marked panel. Each row's colour dot comes back in the same place.
4. With nothing marked, look at the highlighted row. Its colour dot is clearly visible, ringed in the row's text colour, for a light and a dark project colour.
5. Mark panels so that a panel header, a tab chip, a project row and a minimised category header all show a mark. Every one blinks slowly, more slowly than an unsaved-changes dot.
6. In Windows Settings → Accessibility → Visual effects, turn **Animation effects** off. The marks stop blinking and stay at full strength. Turn it back on.

### Negative cases
- A row with unsaved changes and a mark shows both: the unsaved dot beside the name, the ⚑ in the colour dot's place.
- The ⚑ is drawn larger than the colour dot (16 × 16), centred on the dot's spot, with nothing drawn behind it; the project name does not move when a mark comes and goes.
- The mark never blinks fast or flashes.
- Marking and clearing a row never moves its name or path sideways: the ⚑ takes exactly the dot's space.

## MT-10: A mark stays until you focus the panel

Covers: FR-095, FR-004, US1/AC10
Paths: `packages/core/src/attention/attention-model.ts`, `packages/ui/src/main/attention-service.ts`, `packages/ui/src/renderer/attention/focus-reporter.tsx`, `packages/core/src/config/settings-metadata.ts`

### Steps
1. Mark a terminal in project A, then click A in the project list and wait a few seconds without clicking anything else. A's row and the terminal's header both stay marked.
2. Click into the marked terminal and stay there. About a second later (the clear delay) the marks clear.
3. Mark it again, click into it and click straight back out to the project list within half a second. The mark stays.
4. Mark a terminal in another project and click its toast's link. throng lands in the terminal, and its mark clears about a second later.
5. Set **Clear delay** to 0 in Preferences → Attention, mark a terminal and click into it. The mark clears at once.
6. Read **Clear delay**'s description in Preferences. It says how long the panel must hold focus.

### Negative cases
- Switching tabs or projects to a marked terminal, without clicking into it, never clears its mark.

## MT-11: Hover popovers on the project list

Covers: FR-096, FR-097, FR-098, FR-015, FR-119, FR-121, US1/AC11, US1/AC12, US2/AC7
Paths: `packages/ui/src/renderer/attention/**`, `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/ui/src/renderer/workspace/tab-popover.tsx`, `packages/ui/src/renderer/theme.css`

### Steps
1. Mark a terminal and hover the ⚑ on its panel header. No tooltip appears.
2. Mark two terminals in project A (one by `exit 1`) and hover the mark on A's row. A popover opens with no project name: each terminal is its ⚑ or ✖ and "Tab - Title", with "Wants your attention" (or what failed) on the line beneath, indented, and a rule between the two.
3. Move the pointer away. The popover closes.
4. Mark terminals in two projects inside one category, minimise the category, and hover the header's mark. Each project's name, in bold, heads its terminals, laid out as in step 2 and indented under it, with an indented rule between terminals and a full-width rule between projects, in the list's order.
5. Hover a marked row near the bottom of the window. The popover stays fully on screen, flipping above the row if it has to.
6. Rename a marked terminal to a long title, so its "Tab - Title" wraps onto two or three lines in the popover. Its ⚑ sits beside the first line, not halfway down.

### Negative cases
- No native yellow tooltip appears over a project row's or category header's mark.
- The popover never blocks a click on the row beneath it.
- Arrow-key to a marked row in the project list (keyboard, not a click): the popover opens; press Escape and it closes. Clicking a marked row does not open it.

## MT-12: Claude Code's notifications reach throng

Covers: FR-099, US3/AC8
Paths: `packages/core/src/terminal/negotiation-scan.ts`, `packages/daemon/src/terminal-service.ts`, `packages/ui/src/main/attention-service.ts`, `packages/ui/src/renderer/terminal/use-terminal.ts`, `packages/ui/src/renderer/terminal/focus-reports.ts`

### Steps
1. In Claude Code's `/config`, set notifications to `iterm2`. Start `claude` in a terminal in throng.
2. Ask it: "Send me a notification in 30 seconds." Switch to another tab straight away. When it fires, the tab is marked and a toast shows Claude's own message.
3. Repeat, switching to another project instead of a tab. The project row is marked and the toast appears.
4. Repeat, clicking into the project list (staying on the same tab) instead of switching. It is marked.
5. Repeat, switching to another application. A Windows notification shows Claude's message.
6. Repeat, staying in Claude's terminal the whole time. No mark, no toast.
7. Press Escape several times in Claude, with throng focused throughout. Each press behaves as Escape; nothing extra is typed or triggered.

### Negative cases
- Coming back to Claude's tab and typing works normally: no stray characters, no lost keys.

## MT-13: Popovers and notifications name the tab and say what ran

Covers: FR-100, FR-101, FR-102
Paths: `packages/core/src/attention/attention-holders.ts`, `packages/core/src/attention/attention-model.ts`, `packages/daemon/src/terminal-service.ts`, `packages/daemon/src/terminal-attention.ts`, `packages/daemon/src/composition-root.ts`, `packages/ui/src/main/attention-service.ts`, `packages/ui/src/renderer/attention/attention-popover.tsx`, `packages/ui/src/renderer/attention/focus-reporter.tsx`

Before starting, quit throng choosing **Terminate all** and start it again, so the daemon runs this build.

### Steps
1. In project A, rename a tab to "Agents" and start `claude` in a terminal on it. Ask it to notify you in 30 seconds, then switch to project B. When it fires, hover A's row mark: the line reads **Agents › <panel name>**, then **Wants your attention — <Claude's title for the task>**.
2. Minimise A's category and hover its header mark: A's name heads the group, and the line beneath reads the same.
3. With throng focused, the toast for step 1 says **Wants your attention — <Claude's title>**. Repeat with throng in the background: the Windows notification says the same.
4. In a plain PowerShell terminal in A, run `Start-Sleep 5; [char]7` and switch away. The popover line and the toast read **Wants your attention — Start-Sleep 5; [char]7** (the command it ran).
5. Run `exit 3` in a terminal of a project you are not in. The description reads **Process exited '3'** followed by the command that ran last, if any.

### Negative cases
- Nowhere — popover, toast or Windows notification — reads "Bell".
- A finished command reads **Command finished '<command>'** once, not followed by the same command again.

## MT-14: Attention row display settings

Covers: FR-111
Paths: `packages/core/src/config/app-settings.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/core/src/notice/display-mode.ts`, `packages/ui/src/renderer/attention/attention-toasts.tsx`

### Steps
1. Open Preferences → Notifications. The **Attention** row offers Never display, Display for and Dismiss only, a duration that is usable only under Display for, and **OS Notify**.
2. Set it to **Dismiss only**. Mark a terminal while throng is focused: its toast stays until you dismiss it.
3. Set it to **Display for** at 3 seconds: the next toast goes on its own after about 3 seconds.
4. Set it to **Never display**: a new mark raises no toast, and the mark itself still appears.
5. Set it to **Display for** at 3 seconds and make a terminal exit with `exit 1`: the red Failed toast also goes after about 3 seconds.

### Negative cases
- Changing the Information and Error rows does not change how long attention toasts stay.

## MT-15: Overflow control popover

Covers: FR-104
Paths: `packages/ui/src/renderer/attention/attention-popover.tsx`, `packages/ui/src/renderer/workspace/tab-group.tsx`

### Steps
1. In one project, open enough tabs that some scroll out of the tab strip. Mark a terminal on a hidden tab (a delayed bell, then scroll the strip so the tab is out of view).
2. Hover the overflow control's mark on that side: a popover lists the hidden marked terminal as **<tab> › <panel>** and its reason, one per line.
3. Mark a second hidden terminal on the same side: the popover lists both.

### Negative cases
- No native tooltip appears over the overflow control's mark alongside the popover.
- A marked tab that is visible in the strip is not listed.

## MT-16: Clicking a mark cycles its panels

Covers: FR-105
Paths: `packages/ui/src/renderer/attention/holder-marks.tsx`, `packages/ui/src/renderer/sidebar/projects-panel.tsx`

### Steps
1. Mark two terminals in project A, on different tabs, and switch to project B. Click A's row mark: throng goes to A's first marked terminal. Click A's mark again: it goes to the second. Again: back to the first.
2. Mark a terminal in each of projects A and C in one category, and minimise it. Click the category header's mark repeatedly: it steps through A's marked terminal, then C's, then back to A's.

### Negative cases
- Clicking the mark does not also start a rename or do whatever clicking the row normally does beyond going to the panel.

## MT-17: One row per notification type

Covers: FR-108, FR-109, FR-110, FR-113
Paths: `packages/core/src/config/settings-metadata.ts`, `packages/core/src/config/metadata.ts`, `packages/core/src/notice/display-mode.ts`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `packages/ui/src/renderer/preferences/preferences.css`

### Steps
1. Open Preferences → Notifications. At the top is **Operating system notifications**, then one row each for Error, Warning, Information, Success and Attention. Each row holds, on one line, its display mode, its duration and **OS Notify**.
2. On the Information row choose **Dismiss only**: its duration greys out. Choose **Display for**: it is usable again.
3. On the Error row choose **Never display**. A confirmation appears, saying errors will reach only the log, and that a Windows notification is still sent while OS Notify is on and throng is not focused. Cancel: the row still says Dismiss only.
4. Change the Success row's mode and duration, then press that row's Reset. Both go back to their defaults together, and the other rows are untouched.
5. Narrow the Preferences window as far as it goes. The rows wrap rather than run off the edge.
6. Switch the Error row's OS Notify on, then switch **Operating system notifications** off. Every OS Notify greys out, label and box, and Error's still shows ticked. Switch the global switch back on: they are usable again, Error's still ticked.
7. Hover an OS Notify. Its description says it works whatever the display setting, only while throng is not focused.

### Negative cases
- No row shows a second Reset beside one of its controls.
- Choosing Never display on Information or Success asks nothing.

## MT-18: Ordinary notices reach Windows

Covers: FR-110, FR-109
Paths: `packages/ui/src/main/notice-os.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/preload/preload.cts`, `packages/ui/src/renderer/common/notification.tsx`

### Steps
1. In Preferences → Notifications, switch on the Error row's **OS Notify**; under Editor switch **Auto-save** on with **Auto-save delay** at 10,000 ms. In Explorer make a text file read-only, open it in throng, type a character, and switch to another application at once. About 10 seconds later the save fails and a Windows notification names the failure.
2. Click it. throng's main window comes forward.
3. Type another character and stay in throng. When the save fails only the in-app error notice appears, no Windows notification.
4. Switch off **Operating system notifications** and repeat step 1. No Windows notification appears.

### Negative cases
- With every row's OS Notify off except Attention (the default), no ordinary notice ever reaches Windows.

## MT-19: A mark is announced once

Covers: FR-112
Paths: `packages/ui/src/main/attention-service.ts`, `packages/ui/src/renderer/attention/attention-toasts.tsx`

### Steps
1. In a terminal start Claude Code, give it a task that ends by asking you something, and switch to another application. One Windows notification appears when it finishes; when Claude sends its own notification about 30 seconds later, no second one appears.
2. Repeat with throng focused on another project and the Attention row set to Dismiss only. One toast appears; when Claude's second signal arrives the toast's text changes, and no second toast appears.
3. Go to the panel, so its mark clears. Ring a delayed bell in it and switch away: a new notification appears.

### Negative cases
- Dismissing the toast and then letting the same marked panel signal again raises nothing new; the mark stays.

## MT-20: A marked panel's header is filled

Covers: FR-118
Paths: `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/theme.css`

### Steps
1. In a tab with three terminals, ring a delayed bell in one and switch to another project. Switch back to that tab: the marked terminal's header is filled with the Attention colour, the other two are not, and its title is easy to read.
2. Make another terminal in the tab run `Start-Sleep 3; exit 1` while you are on another tab. Back on the tab, its header is filled with the Failed colour.
3. Click into each marked terminal. After the clear delay its header goes back to normal.
4. Switch theme (a light one and a dark one). The filled headers stand out, and their titles stay readable, in both.

### Negative cases
- An unmarked panel's header never changes colour, whether active or not.
- A marked panel that is also the active panel still shows the filled header.
