# Launch-sharing decisions — every E2E spec file

Spec 034 **SC-009** requires a recorded launch-sharing decision for every surviving spec file,
*including the ones that keep a launch per test*. This file is that record. It is generated from
the live tree, so regenerate it rather than hand-editing a row.

## Why a launch is worth counting

Every launch is an Electron process, a daemon and often a real shell — around two seconds on CI.
Where a file’s tests do not need state that exists BEFORE the app starts, they can share one app
via `openApp()` in `beforeAll`; see `harness.ts`.

## The boundary, located by failure rather than by argument

A test needs its own launch when **its claim is about the startup path**. Two worked examples, both
found by a conversion that had to be undone:

- `theme-flash.e2e.ts`’s Light test was converted and REVERTED. Sharing made it read a DARK native
  window background while the renderer had correctly gone light, because that value is fixed when
  the `BrowserWindow` is CONSTRUCTED from the saved theme. Anything read off window construction
  cannot be shared.
- `preferences-json.e2e.ts` keeps its own app for a malformed settings file and a nonexistent active
  theme: an app that has already started successfully cannot prove what happens when startup meets
  a broken file.

Conversely, **`freshCfgRoot()` is not a blocker.** Most calls pass no arguments at all: the isolated
root is WRITE ISOLATION, not pre-launch state, and the two are indistinguishable at the call site.
Reading them as the same thing is what wrote off the whole `@prefs` family — about 70 launches — as
structurally unshareable in this spec’s own success criterion.

## The risk that governs how a conversion is verified

Four conversions on this branch were applied and undone: `editor-basics`, `destroy-cascade`,
`workspace-docking` and `theme-flash`. Every one passed a single green run first. Three held a
resource with a life of its own — a live terminal session, a filesystem watcher — that outlived the
test that created it; the fourth read window-construction state. **A conversion is verified at
`--repeat-each=3`, never on one pass**, and one whose teardown cannot be named is marked UNSAFE
rather than written.

## Where the count stands

| | launches | reduction |
|---|---:|---:|
| pre-034 baseline (`d55054b`, re-measured) | 592 | — |
| today | **382** | **35.5%** |
| if every decision below is applied | 382 | 35.5% |
| SC-010 target (40%) | 355 | 40% |

**The baseline is 592, not the 681 the spec published.** That figure is recorded in `baseline.md`
under the heading "`runApp()` call sites" and is the naive `grep -c 'runApp('` — the exact measure
`scripts/count-e2e-launches.mjs` documents as wrong, because most shared-app files keep a local shim
of that name. Re-counting `d55054b` naively reproduces 681 to the digit; counting it properly gives
592. Every percentage here is against 592, which makes the bar harder than the published one.

## Verdicts

- **ALREADY-SHARED** — 65 files
- **SINGLE-LAUNCH** — 62 files
- **UNSAFE-RESOURCE** — 30 files
- **SAFE-SHARE** — 29 files
- **BLOCKED-SEEDING** — 29 files
- **PARTIAL** — 14 files

`SAFE-SHARE` one app serves the file · `PARTIAL` some tests share, named others keep their own ·
`UNSAFE-RESOURCE` a live shell or watcher outlives its test · `BLOCKED-SEEDING` a claim about the
startup path · `ALREADY-SHARED` / `SINGLE-LAUNCH` at the floor · `UNREVIEWED` no decision yet — that
row is the gap, and SC-009 is not met while any remain.

| file | tests | launches | after | verdict | reason |
|---|---:|---:|---:|---|---|
| `terminate-all-drain.e2e.ts` | 12 | 19 | 19 | UNSAFE-RESOURCE | Every test deliberately closes the app (terminate-all, then an ordinary close) and seven of the twelve relaunch over the same dataDir/userDataDir to prove what survived — blocker #6 twelve times over. Nothing here is a saving. |
| `terminal-claude-keys.e2e.ts` | 8 | 8 | 8 | UNSAFE-RESOURCE | Every test starts a real shell and a real `claude` inside it (:92-105); no panel is ever destroyed and the file's own cleanup (:113-122) swallows the EPERM from a shell still holding the root — the process is KNOWN to outlive the test. Also opt-in (THRONG_CLAUDE_E2E), so its launches do not occur in a normal run. |
| `editor-move-repoint.e2e.ts` | 5 | 6 | 6 | UNSAFE-RESOURCE | AC7 renames the OPEN file behind the app's back from Node inside the watched root (:337), every test leaves a live per-document folder watch (`letWatcherFire`, :126) and then deletes the watched root in `finally` (:164); AC8 is additionally a two-launch restore-on-launch pair (:288, :309). |
| `icon-packs.e2e.ts` | 6 | 6 | 6 | BLOCKED-SEEDING | Four tests write an icon-pack manifest — including a deliberately corrupt one (:236) — before launch (:21-25). The three remaining cannot share either: :84 is a first-run assertion about the app seeding icon-packs on a virgin root, and :150 and :178 both createProject on C:/c/icons, which FR-029 root exclusivity rejects inside one app. |
| `open-in-terminal.e2e.ts` | 6 | 6 | 6 | UNSAFE-RESOURCE | AS-2 leaves one live shell per detected flavour, each in its own tab, never destroyed (:205-255); AS-3/AS-7/B5 each leave another and B5 reloads the window (:340). AS-4 and AS-6 additionally seed contradictory settings documents pre-launch (:370, :425). |
| `panel-auto-naming.e2e.ts` | 5 | 6 | 6 | UNSAFE-RESOURCE | Four tests start real cmd shells that are never destroyed (:132, :180, :226, :292) and the last is a two-launch restart over a shared dataDir (:275-326). Tests 1 and 2 also assert the exact generated names "Panel 1" / "Panel 2" (:114, :123), which depend on the app's global panel-name sequence being pristine. |
| `editor-missing-aggregate.e2e.ts` | 4 | 5 | 5 | BLOCKED-SEEDING | settings.json with editor.warnOnMissingFile=false is written before launch (:356) and passed as THRONG_CONFIG_ROOT (:384); the quarantined test also renames the project root from Node between two launches (:241) and asserts a cold-restart condition its own comment says a reload cannot produce. |
| `preferences-json.e2e.ts` | 11 | 5 | 5 | PARTIAL | 12 of 16 tests write settings.json BEFORE launch (:154, :200, :237, :357, :387, :469, :499, :535, :611, :673, :764, :791) so the app parses a specific document at startup; the four unseeded tests (:71, :270, :322, :550) could share, but test 1 ends with an INVALID JSON buffer, which blocks every exit including the mode toggle, and resizes the prefs window to 420x360. 3 launches for a real hazard. |
| `terminal-start-failure-controls.e2e.ts` | 3 | 5 | 5 | BLOCKED-SEEDING | The project root is renamed away (:183) and a directory removed (:369) BETWEEN two launches so the next app reads a missing folder at startup; test 3 also force-kills the daemon mid-test (:479) under skipDaemon (:565). |
| `app-close-terminals.e2e.ts` | 4 | 4 | 4 | UNSAFE-RESOURCE | Three of four tests end by quitting the app (:75, :125, :140) — blocker #6 — and test 1 drives the close handshake with a real cmd running until it types exit (:21-51). |
| `editor-basics.e2e.ts` | 4 | 4 | 4 | UNSAFE-RESOURCE | Converted and REVERTED on this branch (dcdcb46) for flaking: :147 mutates a dirty, open, WATCHED file from Node and :161 asserts the changed-on-disk notice — a notice an earlier test's surviving watcher can raise or swallow. Nothing in the harness tears a per-document folder watch down. |
| `editor-cross-project-restore.e2e.ts` | 2 | 4 | 4 | BLOCKED-SEEDING | Both tests are launch-1/launch-2 pairs over a shared pre-created dataDir/userDataDir (:120/:177, :211/:247); each second launch asserts restore-on-launch of a persisted layout, which cannot run second inside another app. |
| `explorer-live-sync.e2e.ts` | 4 | 4 | 4 | UNSAFE-RESOURCE | Blocker #1 in its purest form: tests 1 and 2 mutate the watched root directly from Node (:79, :83, :105) and the file's whole subject is which watcher events reach the tree; every test then removes its watched root in a `finally`. |
| `new-project-folder.e2e.ts` | 4 | 4 | 4 | BLOCKED-SEEDING | Each test writes its own settings.json before launch (:32) and hands the app that root (:33); the four newProject documents are mutually exclusive (lastViewed vs profile vs two override variants), so no two can share a process. |
| `notice-consolidation.e2e.ts` | 2 | 4 | 4 | BLOCKED-SEEDING | Both tests are the two-launch dance: build the workspace, quit, rename the root while the app is dead (:225, :391), relaunch against the same dataDir so the project open fails at startup. Test 1 also drives a real cmd terminal through that failure (:197). |
| `tab-scroll.e2e.ts` | 13 | 4 | 4 | ALREADY-SHARED | Four describes already share one app each (:139, :351, :430, :711) and cannot collapse further: each seeds a different tabs.smoothScrollMs into settings.json before launch (:57-66), which the file header names as its independent variable. |
| `destroy-cascade.e2e.ts` | 3 | 3 | 3 | UNSAFE-RESOURCE | Decided by dcdcb46, which converted this file and reverted it for flaking at destroy-cascade:143. The resource is a live terminal session — the real cmd started at :93 and mirrored into a sub-workspace, killed only at :137 — plus the sub-workspace window each test opens. |
| `editor-file-deleted.e2e.ts` | 2 | 3 | 3 | UNSAFE-RESOURCE | Test 1 removes a project root the shared app still has open and watched (:59), and a vanished root raises explorer-error plus panel-failure-notice straight into test 2, whose subject is a count of exactly that (:110); test 3 is a seeded-dataDir restart regardless (:160/:177). |
| `editor-language-override.e2e.ts` | 6 | 3 | 3 | ALREADY-SHARED | The runApp shim throws on options (:47-51), which is the correct shape. The restart escape (:156/:187) is genuine. The stale-language escape (:296) is NOT seeding — both temp dirs are empty and state is set THROUGH the app — its only dependence is env.result.projects[0].id (:307), which picks the wrong project once the shared app has several; select by the active row and it joins, 4 -> 3. |
| `editor-stranded-recovery.e2e.ts` | 3 | 3 | 3 | UNSAFE-RESOURCE | The file's SUBJECT is a real filesystem watcher surviving renames of a live project root (:146, :181, :231); test 2 also passes a seeded dataDir (:235) and calls reloadWindow (:182), which would reload the shared renderer for everyone after it. |
| `editor-undo-recovery.e2e.ts` | 2 | 3 | 3 | BLOCKED-SEEDING | Two of three tests are crash-then-restore pairs over a dataDir/userDataDir the second launch reads at startup (:141/:159, :229/:249); the third opens the singleton prefs window with the hanging waitForEvent shape (:65). |
| `navigation-remember.e2e.ts` | 3 | 3 | 3 | BLOCKED-SEEDING | freshCfgRoot writes settings before every launch (:110, called at :252 with both flags false, :319 and :426 with both true) and the file states the reason at :232: "every one of them needs a config root seeded before the window exists". |
| `panel-failure-banner.e2e.ts` | 5 | 3 | 3 | ALREADY-SHARED | Three tests already share one openApp (:234-265) and both remaining launches are justified: :704 writes settings.json with all four severities never before launch, and :589 starts a REAL cmd that SUCCEEDS (:666) while repairing and re-breaking the workspace the shared tests depend on. |
| `quick-open.e2e.ts` | 11 | 3 | 3 | ALREADY-SHARED | Both escapes genuine: AS-8 writes editor.openTarget=new to settings.json before launch (:388, runOwnApp :397) and FR-017 persists a sub-workspace then reloads the window (:749). |
| `settings-write-integrity.e2e.ts` | 2 | 3 | 3 | PARTIAL | Nothing merges: test 2 IS a restart, two launches against one config root by design (:193, :208), and test 1 asserts the shipped `dismiss` default (:124), which a shared app that had already run test 1 cannot produce. |
| `tab-presentation.e2e.ts` | 11 | 3 | 3 | ALREADY-SHARED | Three groups, three pre-launch arming delays — writeTabSettings(cfgRoot, { closeArmingDelayMs: 2000 }) at :336 and { ...: 0 } at :514 are read at startup — so the three apps are irreducible. |
| `terminal-command-memory.e2e.ts` | 5 | 3 | 3 | UNSAFE-RESOURCE | `ping -t 127.0.0.1` (:23) is started and never stopped by tests 1 and 3, and test 4 leaves `findstr /R x` holding stdin (:225); with THRONG_NO_ORPHAN_REAP set (harness.ts:52) nothing reaps them between tests. Test 5 is a real restart (:245, :281). |
| `terminal-launch-failure-config.e2e.ts` | 1 | 3 | 3 | BLOCKED-SEEDING | One test, three deliberate launches: the project root is renamed away between them (:160) and back (:224), and the whole subject is what the app reads at startup. Nothing to merge. |
| `terminal-no-orphans.e2e.ts` | 3 | 3 | 3 | UNSAFE-RESOURCE | The assertion IS the process tree: a conhostChildren baseline (:83, :126, :147) followed by expectNoOrphanConhosts. One shared daemon means any other test's live conhost is counted as this test's orphan, and test 3 fires terminal.killAll (:160) across the whole daemon. |
| `terminal-wheel-altscreen.e2e.ts` | 3 | 3 | 3 | UNSAFE-RESOURCE | Tests 1 and 3 leave `node altpaint.cjs` running forever in raw stdin mode inside a real cmd (started :78, never killed) and test 2 leaves a cmd with an uncommitted command line (:112). No test destroys its panel. |
| `titlebar-chrome.e2e.ts` | 5 | 3 | 3 | ALREADY-SHARED | The theme escape is genuine seeding — seedThemeSurfaces writes themes/throng.json before launch (:163). The prefs escape (:227) is defensive rather than forced and could save 1, but it follows a programmatic minimise/restore (:211) and ends by polling main.isFocused() (:296), which was not verified. |
| `app-icon.e2e.ts` | 4 | 2 | 2 | ALREADY-SHARED | The remaining runOwnApp (:113) writes themes/throng.json before launch (:92-101) and passes that root (:132) — genuine pre-launch seeding of colours no other test wants. |
| `config-hotreload.e2e.ts` | 3 | 2 | 2 | PARTIAL | Test 3 keeps runOwnApp — it writes confirmations.destroyPanel=none before launch (:64) and launches at :71. Tests 1+2 write only themes/throng.json THROUGH the running app, but test 1's accent mutation is undone only as a side effect of test 2 replacing the whole file, and two consecutive full-file theme hot-reloads in one process are exercised nowhere in the suite today. |
| `daemon-status-bar.e2e.ts` | 2 | 2 | 2 | UNSAFE-RESOURCE | Test 1 starts a real cmd shell (:50) with no teardown, and BOTH tests forceKillProcessTree the daemon (:69, :223) — blocker #1 plus blocker #6, and test 2 leaves it dead. |
| `delete-mixed.e2e.ts` | 3 | 2 | 2 | UNSAFE-RESOURCE | Every test creates a project on a real temp root and deletes it in a `finally` while it is still watched (:61, :95, :137); secondary blocker, tests 1 and 3 seed explorer.deleteMode=permanent pre-launch (:23, :102) while test 2 needs the shipped recycle default (:80). |
| `diagnostics-logging.e2e.ts` | 3 | 2 | 2 | PARTIAL | Test 2 keeps runOwnApp: { skipDaemon: true } (:63) is a launch option and is the whole point of the test. Tests 1+3 share; the state to name is __throngOpenedPaths, seeded once per launch by stubShellOpen, because test 3 asserts it equals exactly [logsDir] (:88) — true only while no earlier test asks the shell to open anything, which test 1 does not. |
| `drag-ghost.e2e.ts` | 2 | 2 | 2 | UNSAFE-RESOURCE | TRIED AND REVERTED 2026-08-18, on evidence rather than caution. Converted to one app; test 2 then failed on ALL THREE repeats — deterministic, not flaky — with createProject timing out because clicking `project-new` never opened `project-form`. Test 1 is a DRAG test and the ghost is a real BrowserWindow only HIDDEN between drags, so it leaves the window in a state the next test cannot click through. The original verdict flagged exactly this ("test 1 never asserts it went away") and rated itself low confidence; it was right to. |
| `editor-find.e2e.ts` | 8 | 2 | 2 | ALREADY-SHARED | The runOwnApp at :330 has persistent find state as its SUBJECT (013 keeps the term across a re-open), so the shared app's leftover term and selection would decide its result — stated at :322. |
| `editor-gutter.e2e.ts` | 2 | 2 | 2 | BLOCKED-SEEDING | Two DIFFERENT themes/throng.json documents written before launch — with gutter tokens (:41, env :69) and without them (:83, env :106). The second test's subject is precisely the absence of those keys at load. |
| `editor-highlighting.e2e.ts` | 6 | 2 | 2 | ALREADY-SHARED | The runOwnApp at :237 needs a config root it can write settings.json into (:253) — OpenApp exposes none — and it switches the app to Matrix permanently, which is blocker #3 for the five colour tests. |
| `editor-indicators.e2e.ts` | 2 | 2 | 2 | BLOCKED-SEEDING | Test 2 writes settings.json with editor.autoSave=true and a 150ms debounce before launch (:61, env :85); test 1's whole subject is a dot that stays lit until an explicit Ctrl+S (:40-49), which auto-save would clear on its own. |
| `editor-menus.e2e.ts` | 2 | 2 | 2 | UNSAFE-RESOURCE | Tests 1 and 2 each open a.txt from a real temp root and delete that root in a `finally` (:60, :75) — a live fs watcher plus an open document over a path that disappears mid-file, the editor-basics shape; test 3 pre-seeds settings.json (:83). |
| `editor-mirrored-undo.e2e.ts` | 2 | 2 | 2 | BLOCKED-SEEDING | Both tests reloadWindow (:39, :108) and both open sub-workspace sw1 and never close it (:52, :117); throng:subworkspace:open is create-or-focus (main.ts:1508), so the second waitForEvent fires no event and hangs. |
| `editor-open-target.e2e.ts` | 2 | 2 | 2 | BLOCKED-SEEDING | Test 1 writes editor.openTarget=new before launch (:24, env :36); test 2's subject is the DEFAULT with the same click sequence (:50). Mutually exclusive for one app. |
| `editor-recovery-stale.e2e.ts` | 1 | 2 | 2 | BLOCKED-SEEDING | ONE test, two launches: the second (:60) is a deliberate restart over the same dataDir/userDataDir to prove no stale recovery temp survives. A second launch inside one test is not a saving. |
| `editor-recovery.e2e.ts` | 1 | 2 | 2 | BLOCKED-SEEDING | ONE test, two launches: the second (:40) restarts over the same dataDir/userDataDir so the recovery temp can be restored. |
| `editor-stranded-restart.e2e.ts` | 1 | 2 | 2 | BLOCKED-SEEDING | ONE test, two launches: the second (:124) is a real restart, and the header (:16-19) states that a renderer reload will not do. |
| `editor-subworkspace.e2e.ts` | 2 | 2 | 2 | BLOCKED-SEEDING | Both tests reloadWindow (:30, :91) and both open sub-workspace sw1 without closing it (:40, :113); create-or-focus makes the second waitForEvent hang. |
| `error-dismiss.e2e.ts` | 4 | 2 | 2 | PARTIAL | Tests 1, 3 and 4 share; test 2 keeps runOwnApp because it installs a SQLite trigger before launch (:65-72) and hands the app that dataDir (:98). Test 1 must stay FIRST (its projectId() takes the first project-switch row, :14-18). Test 4 starts a real cmd twice but proves each death via panel-exit; drop it to runOwnApp if that is judged too weak and the saving is 1. |
| `explorer-follow-active-editor.e2e.ts` | 5 | 2 | 2 | UNSAFE-RESOURCE | Test 4 starts a real PowerShell and waits for its prompt (:231-236) with no teardown that releases it — the exact class dcdcb46 reverted; the last test also pre-writes settings.json (:264) and hot-edits it mid-test (:291), so it cannot share a config root with the rest. |
| `explorer-tree-state.e2e.ts` | 3 | 2 | 2 | BLOCKED-SEEDING | settings.json with editor.openOnClick=single is written before launch (:210) and passed at :261; test 5 also calls reloadWindow (:304), and three tests drag folders across a watched root and then delete it under the live watch. |
| `failure-copy.e2e.ts` | 2 | 2 | 2 | BLOCKED-SEEDING | Test 2 writes settings.json setting every severity to never before launch (:263, env :313) and its subject is that NO notice exists (:287), while test 1's subject is the consolidated notice being on screen (:165). |
| `fileop-lock-cause.e2e.ts` | 2 | 2 | 2 | UNSAFE-RESOURCE | Test 2 starts a real cmd and walks it into a folder to hold it (:238-249); the kill at :307 is on the success path only, not in a `finally`, so a failing assertion leaves a live shell holding a temp directory. |
| `focus-zoom-layout.e2e.ts` | 2 | 2 | 2 | BLOCKED-SEEDING | Test 2 reloads the window (:88) and opens sub-workspace sw1 (:92), which is create-or-focus and never closed. Both blockers are in the LAST test, so an order-pinned conversion saving 1 is conceivable; declined because what a mid-file location.reload() does to the shared OpenApp handle and its afterAll close was not verified. |
| `loaded-projects.e2e.ts` | 1 | 2 | 2 | BLOCKED-SEEDING | ONE test, two launches: the second (:28) over the same dataDir is the whole point — a fresh session must start the project UNLOADED (:35). |
| `menus.e2e.ts` | 3 | 2 | 2 | ALREADY-SHARED | The runOwnApp at :136 asserts a chord removal on disk in join(cfgRoot, keybindings.json) (:159) and OpenApp exposes no config root; it also opens the singleton prefs window (:58), which the shared app must not inherit. |
| `notice-a11y.e2e.ts` | 1 | 2 | 2 | BLOCKED-SEEDING | ONE test, two launches: the second (:157) follows a rename of the project root on disk (:155), so the failure state only exists on restore. |
| `notification-prefs.e2e.ts` | 6 | 2 | 2 | PARTIAL | Five tests share under conversion (b); :364 keeps runOwnApp because it seeds settings.json pre-launch (:60) and its subject is what a pre-030 file does at STARTUP. Declaration order becomes load-bearing: :153 asserts every shipped default so it must stay first, and :282 leaves error={timed,30000} so it must move last, ahead of :429/:508 which assert the dismiss defaults. |
| `pane-shortcuts.e2e.ts` | 3 | 2 | 2 | PARTIAL | Test 3 keeps runOwnApp — keybindings.json rebinding view.toggleProjects to F7 is written at :60 and read at the launch on :66. Tests 1+2 share safely (both projects sit on paths that never exist, so no watcher and no root clash) provided test 1's pane re-expansion at :26/:33 is wrapped in a `finally` the way panes.e2e.ts does. |
| `preferences-reset.e2e.ts` | 9 | 2 | 2 | PARTIAL | Its own openPrefs already polls app.windows() instead of waitForEvent (:39-75), so the singleton is not a blocker here; :256 keeps runOwnApp for a pre-launch themes/MyUser.json. But the shared root needs editor.autoSave, autoSaveDebounceMs and zoom.out restored per test, and :323 replaces settings.json with a DIRECTORY while the config watcher is live. Highest saving on the branch and the least safe. |
| `preferences-settings.e2e.ts` | 7 | 2 | 2 | PARTIAL | Seven tests need only an isolated config root the Node side can read back; :299 (a hand-written explorer.openMode) and :355 (a malformed settings.json) genuinely seed before launch and keep runOwnApp. Conversion (b) — close the prefs window per test — is what makes the singleton (preferences-window.ts:111) a non-issue and clears the search query :187 leaves behind, which :216 asserts is absent. |
| `project-missing-root-wedge.e2e.ts` | 1 | 2 | 2 | BLOCKED-SEEDING | ONE test, two launches: launch 1 (:146) builds the projects and a real cmd terminal, Bravo's root is renamed away only once the app is DEAD (:180), and launch 2 (:198) must be a cold start. The second launch is the subject. |
| `status-bar-deduped.e2e.ts` | 2 | 2 | 2 | BLOCKED-SEEDING | { env: { THRONG_FAKE_ELEVATED: 1 } } (:81) is read at launch, and test 1 asserts the opposite condition under skipIfElevated (:37). |
| `subtree-expand-collapse.e2e.ts` | 4 | 2 | 2 | PARTIAL | Three tests share, AS-10 keeps runOwnApp for its reloadWindow (:596). Three conditions: the throng:files:list ipcMain handler swapped at :241 is never restored and must be undone in a `finally`; each cleanupTemp(projectRoot) must move to afterAll or it deletes a root the shared app still watches; and the three projects are all named "Subtree" (:331, :392, :494) and must be named apart. |
| `subworkspaces.e2e.ts` | 6 | 2 | 2 | ALREADY-SHARED | The escape is unavoidable and correct: test 4 closes the MAIN window (:209), which every other test drives. |
| `tab-name-limit.e2e.ts` | 6 | 2 | 2 | ALREADY-SHARED | The escape is justified: T083 seeds a 300-character tab name into the database before launch (:370-398, runOwnApp :401). |
| `terminal-admin-integrity.e2e.ts` | 0 | 2 | 2 | UNSAFE-RESOURCE | Each of its two adminTest declarations starts up to four real shells, elevated and de-elevated (:133, :160); the de-elevation path routes through a separate agent process tree nothing here observes, and both `finally`s delete the project root (:141, :166). |
| `terminal-clipboard.e2e.ts` | 3 | 2 | 2 | ALREADY-SHARED | Test 1 must launch WITHOUT THRONG_E2E_CLIPBOARD (:100) because it wraps Electron's own clipboard.writeText; tests 2-3 must launch WITH it (:221). Mutually exclusive at launch — env is pre-launch seeding. |
| `terminal-directory-memory.e2e.ts` | 2 | 2 | 2 | UNSAFE-RESOURCE | Four flavour tests each leave a live cmd/powershell/pwsh/git-bash sitting in deepdir with no destroy (:104-133), and all four name the project DirMem (:89), so the shared database's WHERE p.name = ? (:57) would match four rows. Test 6 also seeds terminals.shellIntegration=false pre-launch (:226). |
| `terminal-input-idle.e2e.ts` | 2 | 2 | 2 | UNSAFE-RESOURCE | Both tests leave a live cmd shell — makeCmdTerminal (:48, :158) never kills it (altscreen-fixture.ts:63-72) — and both `finally`s then delete its cwd. |
| `terminal-modified-enter.e2e.ts` | 2 | 2 | 2 | UNSAFE-RESOURCE | The file's own comment states both cases leave a shell at a prompt locking the project root past teardown (:31-35); test 1 additionally spawns a real node-pty powershell probe from the worker (:53-79). |
| `terminal-persistence.e2e.ts` | 1 | 2 | 2 | BLOCKED-SEEDING | ONE test, two launches: launch 1 (:45) persists the layout, the database is rewritten while the app is dead (:60-64), and launch 2 (:70) must read the mutated flavourId at startup. |
| `terminal-startup-command-flavours.e2e.ts` | 2 | 2 | 2 | UNSAFE-RESOURCE | The assertion IS that the shell survives — panel-type-select must have count 0, i.e. the panel did not revert (:64, :102) — so every case leaves a live shell by design. (Two source declarations run four flavours each, so the runtime cost is 8 launches against the counter's 2.) |
| `terminal-startup-command.e2e.ts` | 3 | 2 | 2 | PARTIAL | Already shared for four tests. The two runOwnApp escapes (:161, :193) write the SAME USER_FLAVOUR settings.json into two temp roots, so one seeded app in a second describe serves both. Caveat: tests 2 and 3 leave live cmd shells in the shared app (:116, :140), which is already-shipped practice on this branch rather than proven safe. |
| `theme-flash.e2e.ts` | 2 | 2 | 2 | BLOCKED-SEEDING | TRIED AND REVERTED 2026-08-18. Sharing made the Light test read a DARK native window background while the renderer had correctly gone light — because the native background is fixed when the BrowserWindow is CONSTRUCTED, from the theme saved at startup. Its subject IS the startup path, so no amount of restoring between tests reaches it: the window would have to be built again. This is the worked example the whole boundary is stated from. |
| `theme-tokens.e2e.ts` | 3 | 2 | 2 | PARTIAL | Tests 1 and 2 write themes/throng.json THROUGH the running app and poll for hot-reload (:39, :61) — not pre-launch seeding — and test 2 overwrites the whole document. Test 3 keeps runOwnApp: it writes appearance.theme=Ghost before launch and asserts no themes/Ghost.json is created (:98). cleanupTemp must move to afterAll. |
| `about-async.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | One edit: test 1 never closes the About window, which is create-or-focus AND app-modal (about-window.ts:44, :52), so test 2's waitForEvent (:36) would hang. Add `await about.close()` to test 1 — about-window.ts:92 refocuses the main window on close — and both run on one app. |
| `about.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One app and one daemon in beforeAll (:127) with no runOwnApp escapes; the singleton, app-modal About window is neutralised by the afterEach that closes any about=1 page (:147). Two of its three counted launches are the counter matching `openApp()` in the header comment. |
| `active-panel.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | No seeding, distinct project names and non-overlapping roots (C:/c/active, C:/c/pertab); every assertion is scoped to a panel or tab id the test itself made, and only the active project's workspace renders. |
| `app-shell.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One launch already serves 4 tests — at the floor. |
| `colour-picker.e2e.ts` | 5 | 1 | 1 | SAFE-SHARE | No seeding; the config root exists only so readTheme can read the file back. Conversion (b) disposes of the colour picker left OPEN by :65 and :180 — under one long-lived window the next swatch click would toggle that picker SHUT instead of opening one — and of the panel scrolled to the bottom by :175. |
| `config-files.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `config-write-failure.e2e.ts` | 3 | 1 | 1 | PARTIAL | Test 2 keeps runOwnApp: its setup clicks editor.autoSave and polls for true (:213), which only holds on a virgin root — test 1 leaves autoSave=true in the shared settings.json (:111-118). Tests 1+3 share, with test 1 closing its prefs window at the end. |
| `context-menu-shortcuts.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `context-menu.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `daemon-death-notice.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `daemon-selfspawn.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `default-themes.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | One shared config root serves both (test 1 restores all 15 at :60), and test 1 asserts the first-run shipped-defaults write so it must stay first. Needs conversion (b): openThemes (:28-37) uses waitForEvent and would hang at :234. Unverified: what the active theme falls back to when test 1 deletes Matrix while it is selected (:50). |
| `destroy.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `drag-to-new-tab.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `editor-caret-persist.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One launch already serves 4 tests — at the floor. |
| `editor-column-select.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One launch already serves 5 tests — at the floor. |
| `editor-command-scope.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `editor-content-menu.e2e.ts` | 7 | 1 | 1 | ALREADY-SHARED | One launch already serves 7 tests — at the floor. |
| `editor-cut-line.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `editor-external-change-named.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `editor-feedback.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One launch already serves 4 tests — at the floor. |
| `editor-feedback2.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One openApp in beforeAll (:74); the second counted launch is the counter matching `runApp` in the header comment describing the old shape. |
| `editor-feedback3.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One openApp in beforeAll (:69); the second counted launch is prose in the header comment. |
| `editor-file-switch.e2e.ts` | 6 | 1 | 1 | ALREADY-SHARED | One launch already serves 6 tests — at the floor. |
| `editor-function-highlight.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `editor-highlight-perf.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `editor-indentation.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `editor-naming.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | No seeding; separate temp roots and distinct project names (:27 BlurNameProj, :65 NamingProj); every assertion is on a panel id the test made, and test 1 closes its context menu with Escape (:47). |
| `editor-open.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `editor-replace.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `editor-scroll-position.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `editor-search-highlight.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `editor-subworkspace-owned.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `editor-tab-destroy-reopen.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | No seeding; distinct names and roots (:80, :111), .tab-chip counts see only the active project's workspace, and the one-buffer registry is keyed by absolute path so the two note.txt files cannot collide. |
| `editor-word-wrap.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `explorer-keyboard-selection.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `explorer-new-items.e2e.ts` | 1 | 1 | 1 | SAFE-SHARE | One edit: both tests create a project called NI (:22, :49) over different roots — name them apart. Otherwise separate temp roots, and every assertion is a context-menu item or an existsSync under the test's own root. |
| `explorer-rename-focus.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `explorer-selection-visibility.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | No seeding; distinct names and roots (:43, :79). Test 2's only window-wide locator, .cm-content (:85), can see just its own project's panels because an inactive project's workspace is not rendered. |
| `explorer.e2e.ts` | 12 | 1 | 1 | ALREADY-SHARED | One launch already serves 12 tests — at the floor. |
| `fileop-undo.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One launch already serves 5 tests — at the floor. |
| `focus-context.e2e.ts` | 2 | 1 | 1 | UNSAFE-RESOURCE | Test 2 starts a real cmd terminal (:72-79) and never terminates it — no teardown at all. |
| `ghost-drag-noise.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `goto-line-keybinding.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `goto-line.e2e.ts` | 7 | 1 | 1 | ALREADY-SHARED | One launch already serves 7 tests — at the floor. |
| `handles.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `hover-suppression.e2e.ts` | 2 | 1 | 1 | BLOCKED-SEEDING | Test 1 opens the singleton preferences window (:44) and never closes it, and deliberately leaves the main window BLURRED (:52) — which is the file's own subject. Test 2's opening claim is that a hover paints while the window is focused (:69), which that leftover suppresses. |
| `icon-colour.e2e.ts` | 3 | 1 | 1 | SAFE-SHARE | Nothing is written before launch — THRONG_CONFIG_ROOT exists only so readTheme can read the file back. The single blocker is openThemes (:33-41) using the hanging waitForEvent shape, so the prefs window is opened ONCE. Order is load-bearing: test 2 asserts the field is EMPTY and the theme file carries no iconColour (:89, :105), so it must stay ahead of test 3. |
| `keybindings.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `layout.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | No projects, no seeding. One leftover to name: test 2 resizes the window to 900x620 (:47) and never restores it — it is declared last and test 1 only reads transitionProperty (:12), so pin the order or restore in a `finally`. |
| `menu-keyboard.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `move-focus.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `notice-logging.e2e.ts` | 1 | 1 | 1 | BLOCKED-SEEDING | Six tests seed a distinct notifications/diagnostics document into THRONG_CONFIG_ROOT before launch (:164, :194, :219, :286, :335, :434) and the modes contradict each other; on top of that every assertion counts records in one userDataDir log file (`toHaveLength(1)`, :317, :399, :446), which a shared app makes cumulative. |
| `notice-overlay.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `notice-stacking.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `notice-subjects.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One openApp in beforeAll (:136) plus a beforeEach that empties the notice stack (:144); the header documents the 5 -> 1 conversion. The second counted launch is prose. |
| `os-drop-defects.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | One edit: both create a project called Demo (:59, :86) over different temp roots — name them apart. editorPanelId reads window-wide but only the active project's panels render, and the two a.txt paths differ so the one-buffer registry cannot collide. |
| `os-drop.e2e.ts` | 6 | 1 | 1 | UNSAFE-RESOURCE | Every test creates a project on a fresh real temp root and deletes it in a `finally` (:76, :98, :124, :160, :185, :223, :250, :288, :335) while the explorer still watches it; the harness has no watcher teardown short of killing the app. Test 7 also asserts `.editor-panel` toHaveCount(1) window-wide, which leftovers break. |
| `pane-auto-collapse.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One openApp in beforeAll (:59); the header documents the 4 -> 1 conversion, its FR-029 root fix and the order dependency. The second counted launch is prose. |
| `panel-name-unique.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | Needs a reorder: panel names come from ONE global daemon sequence and test 2 asserts Panel 1 / Panel 2 (:84, :97), a first-run condition that test 1's four panels push to Panel 5 / Panel 6. Flagged because the dependency on the daemon's global sequence was inferred from the test's own comments rather than the daemon source. |
| `panel-owner-align.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `panel-rename-key.e2e.ts` | 2 | 1 | 1 | UNSAFE-RESOURCE | Test 2 launches a real cmd (:81) and then closes the whole app to answer the terminate prompt (:16-22, called :94) — blockers #1 and #6 in one test, and with only two tests the other has nothing to share with. |
| `panel-reset-name.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `panel-sync.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One openApp in beforeAll (:58), no escape needed; test 3's ordinal was already replaced by an id-delta lookup (:182). The second counted launch is prose. |
| `panel-tooltips.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One app AND one project in beforeAll (:39); every assertion is relative to the current title. The second counted launch is prose. |
| `panel-type-form.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | Both real shells are exited in-test and the revert to the type form is ASSERTED (:62, :102), which is the application observing the session's death — a named teardown. Flagged because it is still a real shell: if blocker #1 is applied as strictly as to the terminal-* files this is UNSAFE-RESOURCE. Test 2 must also close the sub-workspace window it opens (:80). |
| `panel-zoom.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One launch already serves 4 tests — at the floor. |
| `panes.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | The reference conversion; the one blocker (a collapsed pane) is restored in a `finally` (:156-171). The second counted launch is prose. |
| `performance.e2e.ts` | 2 | 1 | 1 | ALREADY-SHARED | One launch already serves 2 tests — at the floor. |
| `persistence-restore.e2e.ts` | 2 | 1 | 1 | ALREADY-SHARED | One launch already serves 2 tests — at the floor. |
| `phase9.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One launch already serves 5 tests — at the floor. |
| `preferences-fonts-and-sliders.e2e.ts` | 5 | 1 | 1 | SAFE-SHARE | No seeding at all (freshCfg only mkdtemps). Conversion (b) is REQUIRED rather than preferred: :178 asserts theme-revert is absent, which is a claim about the prefs window's on-entry snapshot, captured once per renderer mount (preferences-app.tsx:106-137) — so the window must be closed and re-opened per test. The cog menu :52 opens needs an Escape. |
| `preferences-keybindings.e2e.ts` | 5 | 1 | 1 | SAFE-SHARE | No seeding anywhere — every config root is read-back isolation. The blocker was the shared keybindings.json (:74 leaves view.toggleProjects rebound, which :127 must reach FROM the default; :93 against :168), and helpers/config-snapshot.ts — added on this branch WHILE this audit ran — dissolves it: restoreConfigRoot in an afterEach puts the shipped chords back between tests. With that plus closePrefsWindow this is 7 -> 1; without it, 7 -> 3. |
| `preferences-map-control.e2e.ts` | 3 | 1 | 1 | SAFE-SHARE | No pre-launch writes (:87, :130, :182 are read-back roots only); the only blocker is openPrefs (:39-48) using the hanging waitForEvent shape, so the window opens once. Test 1 removes its own row and ends at {} (:83) and test 2's tab-wide reset (:118) puts every settings key back to shipped defaults, which is exactly what keeps test 3 true. |
| `preferences-rapid-edit.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | Blocker #2 only: openPrefs uses waitForEvent (:38-46) so the prefs window opens ONCE and is switched by tab. Leftover prefs state is the active tab plus test 1's two removed zoom chords (:75), neither of which test 2 reads — it reads settings.json editor.* only. |
| `preferences-row-actions.e2e.ts` | 5 | 1 | 1 | PARTIAL | Seven tests share; :189 and :225 keep runOwnApp because both seed editor.autoSaveDebounceMs=900 pre-launch (:22) and assert an on-entry claim. Conversion (b) — close the prefs window at the end of every test — also disposes of the themes-search left as "destroy" (:148) and the keybindings-search left filled (:309), both of which would filter rows out from under later tests. |
| `preferences-scroll.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `preferences-slider.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `preferences-theme-reset.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | Same singleton fix, but here the prefs window must be CLOSED at the end of each test: Revert's baseline is the value the window OPENED with (:79, :88), so one window shared across both makes test 2's baseline test 1's leftover. Whether that baseline is captured at window open or tab mount was not verified. |
| `preferences-themes.e2e.ts` | 10 | 1 | 1 | BLOCKED-SEEDING | Three tests seed themes/CustomOne.json before launch (:102, :116, :139); the other eight mutate the shared theme DIRECTORY irreversibly (Restore All, deleting Debian, creating MyCustom/MyTheme/Renamed) and four of them assert `waitForSeededList` = EXACTLY 15 options (:64), which the first created theme breaks. A 7-launch saving exists only by weakening that invariant to >=15. |
| `preferences-window.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | Already one app and one prefs window in beforeAll for the three read-only tests (:46-56); :82 calls skipIfElevated and asserts the MAIN window title after making its own project, and :95 opens a sub-workspace window that outlives the test. Both escapes stand. |
| `project-browse-neutral.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `project-rename-subworkspace.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `project-settings.e2e.ts` | 1 | 1 | 1 | SAFE-SHARE | Test 1 leaves project-settings-dialog open (:51) and both tests create a project called Demo (:43, :112) — close the dialog in a `finally` and give the second a distinct name. |
| `projects.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One launch already serves 4 tests — at the floor. |
| `quick-open-perf.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One launch already serves 5 tests — at the floor. |
| `quick-open-target.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | The one escape is justified: settings.json with editor.openTarget=new is written BEFORE launch (:539, runOwnApp :545), and the shim throws on options (:76-86). |
| `quick-open-toolbar.e2e.ts` | 1 | 1 | 1 | ALREADY-SHARED | FR-018c needs an app where no project has ever been opened (:127), which only a fresh launch gives. The rebind escape (:300) is read-back only and could arguably join the shared app as the last test, saving 1 — declined because a later-added test would then silently run under a rebound F8. |
| `removal-verbs.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `scrollbars.e2e.ts` | 2 | 1 | 1 | UNSAFE-RESOURCE | Test 2 confirms a real cmd terminal (:70) and never kills it; its own `finally` records that the shell still holds the project root after teardown (:101-111). |
| `search-keybindings-editor.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | Blocker #2 only: openKeybindings waits for a new window (:44-53), so open it once. One shared config root is safe because test 1 only READS the list and test 2's expected chords (:100) need search.find untouched, which test 1 leaves it. |
| `select-popup.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `shipped-defaults-startup.e2e.ts` | 2 | 1 | 1 | ALREADY-SHARED | One launch already serves 2 tests — at the floor. |
| `side-pane-max.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `sidebar.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One launch already serves 5 tests — at the floor. |
| `status-bar-visibility.e2e.ts` | 2 | 1 | 1 | UNSAFE-RESOURCE | Test 1 confirms a real cmd terminal (:20) with no kill anywhere, and its `finally` deletes the root that shell is sitting in (:29). |
| `status-bar.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | Test 1's whole claim is "no project is active" (:21-26) — a startup claim only the first test in an app may make. It is declared first and must stay first. |
| `subworkspace-content-sync.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `subworkspace-detach.e2e.ts` | 1 | 1 | 1 | SAFE-SHARE | Requires rewriting an ORDINAL: both tests assert the list contains "Sub-workspace 1" (:41, :73), so test 2 would pass against test 1's leftover record. panel-sync set the id-delta precedent on this branch, but changing what the test checks is an owner's decision, not a mechanical conversion. Both child windows must also be closed in a `finally`. |
| `subworkspace-owned-terminal.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | Its one real shell is killed and the kill awaited (:120-121), and test 3 counts against a run-time baseline (:201). The second counted launch is prose. |
| `subworkspace-persist-error.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `subworkspace-prefs-modality.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `subworkspace-rename-sync.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `subworkspace-rename-title.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | Test 1's window-title poll for "Sub-workspace 1" (:31) is an ordinal true only of the first sub-workspace, so it must stay first; both tests leave their child window open (:25, :60) and must close it. Same ordinal-rewrite caveat as subworkspace-detach. |
| `subworkspace-sync.e2e.ts` | 2 | 1 | 1 | ALREADY-SHARED | One launch already serves 2 tests — at the floor. |
| `subworkspace-titlebar.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `tab-actions.e2e.ts` | 8 | 1 | 1 | ALREADY-SHARED | One launch already serves 8 tests — at the floor. |
| `tab-picker.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One launch already serves 5 tests — at the floor. |
| `tab-settings.e2e.ts` | 4 | 1 | 1 | SAFE-SHARE | No seeding — the roots are read-back isolation. Conversion (b). Declaration order must change to :94 -> :181 -> :146 -> :211, because :94 deep-equals the whole shipped tabs record on disk (a first-run claim, :132-140) and :205 asserts the shipped maxNameLength of 64, which :174 destroys by setting 30. |
| `tab-strip-overflow.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One launch already serves 4 tests — at the floor. |
| `terminal-activation-cost.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-admin.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-altscreen-fidelity.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `terminal-altscreen-parity.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-de-elevation-hang.e2e.ts` | 0 | 1 | 1 | SINGLE-LAUNCH | 0 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-dual-size.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-editing-matrix.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-env-freshness.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-find.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One launch already serves 4 tests — at the floor. |
| `terminal-flavours.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | NO shell is ever launched — both tests only open the type form and read the dropdown. The config root is written THROUGH the running app to prove hot-reload (:70-77), so one root serves the file provided test 2 stays second (it asserts my-wsl absent first, :60). |
| `terminal-font.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-input-soak.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-kitty-editing-keys.e2e.ts` | 7 | 1 | 1 | ALREADY-SHARED | One launch already serves 7 tests — at the floor. |
| `terminal-link-once.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One launch already serves 5 tests — at the floor. |
| `terminal-links.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-mirror-survival.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-mirror.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-path-drop.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-reattach.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-redraw-action.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-refresh.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-resize.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-revert.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-root-lock.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-scrollback-nav.e2e.ts` | 3 | 1 | 1 | ALREADY-SHARED | One launch already serves 3 tests — at the floor. |
| `terminal-slow-start.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-tab-switch-render.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal-title-persist.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `terminal.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `theme-buttons.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `theme-fields.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `theme-fonts.e2e.ts` | 5 | 1 | 1 | SAFE-SHARE | The only file in the theme group that never opens the preferences window, so the singleton does not arise. Every writeTheme happens INSIDE the runApp body — a hot-reload write through the running app — and replaces themes/throng.json WHOLESALE (:11-12), so each test re-establishes the entire theme rather than inheriting one. Project roots are five distinct paths. |
| `theme-sizes-and-notices.e2e.ts` | 3 | 1 | 1 | SAFE-SHARE | No seeding. Conversion (b) lets :162 keep the cog route to Settings while :31/:62 use Themes and :119 opens no prefs window at all. Surviving drift (sizes.iconPx, sizes.scrollbarPx, an excludeGlobs entry, an open project-creation form) is read by no later assertion, and the default-dependent claims at :56 and :150 touch tokens nothing here edits. |
| `theme-sweep.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | Both tests write settings.json through the running app and wait on data-theme (:34-42); one config root works provided test 1 stays first, since test 2 adds Optional.json to the themes folder (:111) which test 1's sweep over every theme would otherwise include. |
| `title-statusbar.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `transient-overlays.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One app, one project and one editor in beforeAll (:89-105); every case resets the window through prepare() (:136). The second counted launch is prose. |
| `tree-drop-open.e2e.ts` | 5 | 1 | 1 | ALREADY-SHARED | One openApp (:56), no escape; each test makes its own project under its own root and only the active project renders. The second counted launch is prose. |
| `tree-unsaved-dot.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
| `unsaved-dot-pulse.e2e.ts` | 2 | 1 | 1 | SAFE-SHARE | The only leaked per-window state is emulateMedia({ reducedMotion: reduce }) in test 2 (:62), which must be reset in a `finally`; test 1's showSaveDialog stub (:46) is per-app and harmless. |
| `ux-refinements.e2e.ts` | 8 | 1 | 1 | ALREADY-SHARED | One app, one daemon and one window for the whole file in beforeAll (:183) with shutdownApp in afterAll; the conversion is documented at :12-65. Three of its four counted launches are the counter matching `openApp()` inside that prose. |
| `window-chord-resolution.e2e.ts` | 8 | 1 | 1 | ALREADY-SHARED | One launch already serves 8 tests — at the floor. |
| `workspace-docking.e2e.ts` | 4 | 1 | 1 | ALREADY-SHARED | One launch already serves 4 tests — at the floor. |
| `workspace-min-width.e2e.ts` | 1 | 1 | 1 | SINGLE-LAUNCH | 1 test, 1 launch — at the floor; there is no second test to share with. |
