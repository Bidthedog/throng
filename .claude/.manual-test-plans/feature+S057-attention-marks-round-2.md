# Manual test plan: S057 attention marks, round 12 (#522, #523, #524, #525)

Spec: `specs/057-terminal-attention-marks/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Click a notification to reach its panel | untested | | | |
| MT-02 | Flag a panel by hand | untested | | | |
| MT-03 | Project list: counts, pills and paler minimised categories | untested | | | |
| MT-04 | Tab chips: numbered flags and panel-count pills | untested | | | |
| MT-05 | A marked panel announces once, whatever marked it | untested | | | |

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

Covers: FR-129, FR-130, FR-131, FR-133, 046 FR-051a, #523
Paths: `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/ui/src/renderer/attention/holder-marks.tsx`, `packages/ui/src/renderer/attention/attention-mark.tsx`, `packages/ui/src/renderer/attention/use-attention.ts`, `packages/ui/src/renderer/theme.css`, `packages/core/src/attention/attention-holders.ts`

### Steps
1. Have two categories, one minimised and one expanded. The minimised header is visibly paler than the expanded one. Switch to a light theme, then a dark one: still paler in both.
2. Each category header shows a pill with its total number of projects. No "1 of 2" text appears anywhere, minimised or not.
3. Flag three panels in project A by hand. A's row shows a blinking flag reading 3, where the colour dot was. Clear two (focus each in turn): it reads 1; clear the last: the colour dot is back.
4. Put A (two flagged panels) and B (one) in the minimised category. Its header's flag reads 3.
5. With the default UI scale, the number inside each flag is readable without zooming.

### Negative cases
- As a flag appears, changes number or goes, no row changes height and no project or category name moves sideways.
- One Failed mark among them turns the numbered flag to the Failed style.

## MT-04: Tab chips: numbered flags and panel-count pills

Covers: FR-131, FR-132, FR-133, #523
Paths: `packages/ui/src/renderer/workspace/tab-group.tsx`, `packages/ui/src/renderer/attention/holder-marks.tsx`, `packages/ui/src/renderer/attention/attention-mark.tsx`, `packages/ui/src/renderer/attention/use-attention.ts`, `packages/ui/src/renderer/theme.css`, `packages/core/src/attention/attention-holders.ts`

### Steps
1. Make a tab with three panels and a tab with one. The first chip shows a pill reading 3; the second shows no pill.
2. Split the single-panel tab into two. Its chip now shows a pill reading 2.
3. Flag two panels in the three-panel tab by hand and switch to the other tab. The first chip shows a blinking flag reading 2.

### Negative cases
- As the flag appears, changes or clears, the chip's width does not change and neighbouring chips do not move.

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
