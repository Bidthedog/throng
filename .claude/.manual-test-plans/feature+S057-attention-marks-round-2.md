# Manual test plan: S057 attention marks, round 12 (#522, #523, #524, #525)

Spec: `specs/057-terminal-attention-marks/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Click a notification to reach its panel | signed off | 1575753e50ca | 2026-10-24 | |
| MT-02 | Flag a panel by hand | signed off | 1575753e50ca | 2026-10-24 | |
| MT-03 | Project list: counts, pills and paler minimised categories | untested | | | steps rewritten for round 13 (numbered circle); failed at 63bd9532: I don't see a number for the count of flags within a tab or project — I can just see the flag |
| MT-04 | Tab chips: numbered flags and panel-count pills | untested | | | steps rewritten for round 13 (numbered circle); failed at 63bd9532: don't see the number on the flag |
| MT-05 | A marked panel announces once, whatever marked it | signed off | 1575753e50ca | 2026-10-24 | |

A delayed bell, used below: in a PowerShell terminal, `Start-Sleep 15; Write-Host "`a"`.

## MT-01: Click a notification to reach its panel

Covers: FR-124, FR-034, FR-122, #525
Paths: `packages/ui/src/renderer/attention/attention-toasts.tsx`, `packages/ui/src/renderer/common/notification.tsx`, `packages/ui/src/main/attention-service.ts`, `packages/ui/src/main/notice-os.ts`

### Steps
1. In project A, run the delayed bell in a terminal, then switch to project B within 15 s. An attention toast appears. It has Copy and Dismiss at its top-right and no arrow / go-to control.
2. Click the toast's text. throng switches to project A and its tab, and the terminal is focused.
3. Repeat step 1, then click **Copy** on the toast. The text is copied; throng stays on project B.
4. Repeat step 1, then click **Dismiss**. The toast goes; throng stays on project B; A's row is still marked.
5. Run the delayed bell in A, then switch to another application. A Windows notification appears. Click anywhere on it. throng comes forward on project A with that terminal focused.

### Negative cases
- Copy and Dismiss sit in exactly the same place as on an ordinary notice toast; nothing shifts where the arrow used to be.

## MT-02: Flag a panel by hand

Covers: FR-125, FR-126, FR-127, FR-128, FR-063, #522
Paths: `packages/core/src/attention/**`, `packages/ui/src/main/attention-service.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/preload/preload.cts`, `packages/ui/src/renderer/attention/**`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/daemon/src/attention-flag-service.ts`, `packages/daemon/src/project-service.ts`, `packages/persistence/src/attention-flag-repository.ts`, `packages/persistence/src/migrations/v11-attention-flags.ts`

### Steps
1. Click into a terminal panel. Right-click it. The menu offers **Flag**. Choose it. The panel header, its tab chip and the project row show the Attention flag; the taskbar badge counts it.
2. Stay in the panel for 10 s. It stays flagged.
3. Click into another panel, then back into the flagged one. After the clear delay (1 s by default) the flag clears everywhere.
4. Flag an editor panel and a terminal panel. Hover the project row's flag. The popover lists both with the reason "Flagged".
5. With both flagged, close throng and reopen it. Both are still flagged.
6. In Preferences, switch terminal attention off. Both flags stay.

### Negative cases
- Flagging raises no toast and no Windows notification, with throng focused or in the background.
- Choosing Flag on a panel that is already marked Failed leaves it Failed with its original reason.

## MT-03: Project list: counts, pills and paler minimised categories

Covers: FR-129, FR-130, FR-131, FR-133, FR-135, FR-136, FR-137, FR-114, FR-107, FR-014, 046 FR-051a, #523
Paths: `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/ui/src/renderer/attention/**`, `packages/ui/src/renderer/theme.css`, `packages/core/src/attention/attention-holders.ts`, `packages/core/src/config/theme.ts`, `packages/core/src/config/colour-math.ts`, `packages/core/src/config/default-themes/index.ts`

### Steps
1. Have two categories, one minimised and one expanded. The minimised header is visibly paler than the expanded one. Switch to a light theme, then a dark one: still paler in both.
2. Each category header shows a pill with its total number of projects. No "1 of 2" text appears anywhere, minimised or not.
3. Every project's colour dot is a little larger than before.
4. Flag three panels in project A by hand. Where A's colour dot was, a blinking solid circle in the theme's attention colour, the same size as the dot, reads a clear 3. No flag is drawn. Clear two (focus each in turn): it reads 1; clear the last: the colour dot is back.
5. Select project A (its row filled with its colour) while it is marked: the same attention-coloured circle and number, still readable.
6. Put A (two flagged panels) and B (one) in the minimised category. Its header shows the same circle reading 3.
7. In a light theme and a dark theme, at the default UI scale, every circle's number reads clearly against its fill.

### Negative cases
- As a circle appears, changes number or goes, no row changes height and no project or category name moves sideways.
- A failed terminal among them (run `exit 1` in one) leaves the circle looking exactly as it does for a bell.

## MT-04: Tab chips: numbered flags and panel-count pills

Covers: FR-131, FR-132, FR-133, FR-135, FR-136, FR-138, FR-139, #523
Paths: `packages/ui/src/renderer/workspace/tab-group.tsx`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/sidebar/project-menu.ts`, `packages/ui/src/renderer/attention/**`, `packages/ui/src/renderer/theme.css`, `packages/core/src/attention/attention-holders.ts`, `packages/core/src/config/theme.ts`, `packages/core/src/config/theme-ops.ts`, `packages/ui/src/main/icon-pack-service.ts`

### Steps
1. Make a tab with three panels and a tab with one. The first chip shows a pill reading 3; the second shows no pill.
2. Split the single-panel tab into two. Its chip now shows a pill reading 2.
3. Flag two panels in the three-panel tab by hand and switch to the other tab. The first chip shows the same blinking circle a project row does, reading a clear 2. No flag is drawn.
4. Look at a flagged panel's header: the same circle, blinking, with no number.
5. Make an editor panel unsaved and flag it: its header shows the unsaved dot and the circle, and the two are plainly different.
6. Open the cog menu and a panel's right-click menu: *Go to Next Marked Panel* and *Flag* are there, without a flag glyph.

### Negative cases
- As the circle appears, changes or clears, the chip's width does not change and neighbouring chips do not move.

## MT-05: A marked panel announces once, whatever marked it

Covers: FR-134, FR-112, FR-038, FR-038a, #524
Paths: `packages/ui/src/main/attention-service.ts`, `packages/core/src/attention/attention-model.ts`, `packages/daemon/src/terminal-attention.ts`

### Steps
1. In a terminal run `Start-Sleep 15; Write-Host "`a"; Start-Sleep 15; Write-Host "`a"` and switch project. At the first bell one toast appears. At the second, 15 s later, no second toast and no Windows notification appear.
2. Leave a terminal marked, close throng and reopen it. The terminal is still marked and nothing is announced. Ring its bell again while away from it: no toast and no Windows notification.
3. Focus that terminal until its mark clears, then ring its bell again while away. One toast appears.
4. Flag a panel by hand, then make its terminal ring the bell while you are elsewhere. No toast, no Windows notification.

### Negative cases
- At no point does a panel that is already showing a flag produce a second toast or a second Windows notification.
