# Contract: Unload

Covers FR-032 – FR-038. The reasoning is in [research.md](../research.md) R7 and R8. The planner is in
[data-model.md](../data-model.md) §8.

## 1. Entry points

| Route | Variant | Enabled when |
|---|---|---|
| Project row menu → **Unload** | none (it runs the preference) | the project is loaded (FR-038: drawn but disabled otherwise) |
| → **Unload and Keep Terminals Running** | `keepRunning` | the same |
| → **Unload and End Terminals** | `endTerminals` | the same |

There is no chord and no inline control. The spec names neither.

## 2. Sequence (`packages/ui/src/renderer/sidebar/unload-project.ts`)

```text
unloadProject(id, variant?):
  1. if dirtyProjects.has(id):
       r = promptDirtyClose(name, [])                  # the same prompt Remove uses (FR-035)
       cancel  -> return (nothing changed)
       save    -> editor.saveAll({scope:'all', activeProjectId:id}); on failure return
       discard -> continue
  2. spare  = projectPanelIdsInSubWorkspaces(id, subWorkspaces)          # FR-037
     busy   = terminal.list({projectId:id, includeBusy:true}).sessions
                .filter(s => s.busy && !s.rootless && !spare.includes(s.panelId))
                # rootless: the daemon skips it on a project-scoped closeIdle/killAll (§3),
                # so it is neither counted nor named; `busy` comes from an awaited probe
     names  = busy.map(s => peekTerminalCommand(s.panelId) ?? s.meta.title)
  3. steps  = planUnload({level, defaultAction, busyCount: busy.length, variant})
     run each step:
       choose      -> useChoose(title "Unload <name>?", details: names,
                                choices [Keep running, End terminals, Cancel],
                                initialFocus: step.focus)
                      Cancel -> return
       confirmEnd  -> useConfirm("Are you absolutely sure?",
                                 "Yes, I'm absolutely sure" / "No, I concede")
                      No -> return
       apply       -> action = the picked action
  4. projectsStore.unloadProject(id)       # openedId := null when active (FR-036); workspace unmounts
  5. for each editor state owned by id, and not in spare: disposeEditor(panelId)
  6. action == keepRunning ? terminal.closeIdle({projectId:id, exceptPanelIds:spare})
                           : terminal.killAll ({projectId:id, exceptPanelIds:spare})
```

- **Ordering.** Step 4 comes before step 6, so the views detach before their sessions are killed. No
  view is left showing an ended session (Principle III, "no orphaned terminal views").
- **The no-dialog case.** Step 6 still runs `closeIdle`: idle shells close under either action
  (FR-034c).
- **The next load** (analysis U1). The terminal panels stay in the saved layout (FR-033). Each one
  mounts through the existing `attach {explicit:false}` path. A session spared by Keep running
  reattaches with its process still running. A session that was closed (idle) or ended (End
  terminals) is re-created with a new shell, as FR-034 already says of an idle shell. End
  terminals adds no new "ended" panel state.
- **Failure.** A failure at step 6 surfaces through the store's `fail` path, with the project as
  subject. The project is already unloaded by then, and a retry is a second Unload, which is
  harmless: a second `closeIdle` or `killAll` finds nothing to act on.

## 3. Daemon RPC changes (`packages/ipc-contract/src/terminal.ts`, additive)

| Method | New optional param | New behaviour when `projectId` is given |
|---|---|---|
| `terminal.closeIdle` | `exceptPanelIds?: string[]` | skips listed panels and `rootless` sessions; the busy check (`isBusy`) runs at call time |
| `terminal.killAll` | `exceptPanelIds?: string[]` | skips listed panels and `rootless` sessions |

- **App close is unaffected.** It sends `killAll {}` with no `projectId`
  (`packages/ui/src/main/main.ts:1960`), and the new rules apply only when `projectId` is given.
- **Tests**:
  - integration, `packages/daemon/tests/integration/`: busy spared, idle closed, excepted panel
    spared, rootless spared;
  - E2E `terminal-no-orphans.e2e.ts`: the conhost returns to baseline after Unload with End
    terminals, and after Keep running with an idle shell.

## 4. Settings

`confirmations.unloadProject` and `projects.unloadTerminalAction`
([data-model.md](../data-model.md) §3). Both are read from the injected settings, never hardcoded
(Principle X).

## 5. What Unload does not do

- Delete anything from the saved layout, the project row, its colour, its settings or its category
  (FR-033).
- Touch a panel held by a sub-workspace window, whether editor or terminal (FR-037).
- Change the daemon's persisted `is_active`. Startup opens nothing either way (R7).
- Minimise or move the project in its category (FR-060 is the other direction of the same rule).

## 6. Iterate round 1 (checkpoint 2026-09-24; spec FR-081, FR-085, FR-086, FR-111)

Supersedes §2 step 3 and the "no-dialog case" bullet, and §4's first setting.

```text
unloadProject(id, variant?):
  1. unsaved-editor prompt, unchanged (FR-035) — the only dialog Unload may show (SC-015)
  2. spare = projectPanelIdsInSubWorkspaces(id, subWorkspaces)          # FR-037, unchanged
  3. action = variant ?? settings.projects.unloadTerminalAction         # planUnload, data-model §8
  4. projectsStore.unloadProject(id)                                    # unchanged
  5. dispose editor states owned by id and not in spare                 # unchanged
  6. action == endTerminals ? terminal.killAll({projectId:id, exceptPanelIds:spare})
                            : nothing                                   # FR-086: no closeIdle
```

- **No `choose`, no `confirmEnd`.** Neither row asks anything, whatever the terminals are doing
  (FR-111). `busy` and `names` are no longer computed for a dialog.
- **Keep Terminals Running keeps idle shells** (FR-086, constitution v5.6.0 III stated exception).
  Every session stays alive; on the next load each terminal panel reattaches through
  `attach {explicit:false}` to the **same** session (same pid, scrollback restored). `closeIdle`
  keeps its app-close and project-close callers; Unload is no longer one of them. *Corrected at
  analyze, 2026-09-24:* the source shows no such callers. Unload (`unload-project.ts`) is
  `closeIdle`'s only production caller, and the app-close path in `main.ts` never calls it. After
  T128 the RPC has no caller, and where FR-015b's idle rule runs at app close is an open question
  that T124 records and T153 lands. *T153, 2026-09-25: settled — no production path closes an idle
  shell at app close (Leave running keeps every session; Terminate all sends `killAll {}`; no idle
  sweep at shutdown), and `terminal.closeIdle` now has no caller at all. FR-015b's app-close rule is
  unmet, a pre-existing known violation recorded in plan.md's Complexity Tracking; not filed —
  unreproduced; recorded in PR #440's description for the maintainer to reproduce and file. The RPC
  stays in the contract (§3) for that work to call.*
- **End Terminals** kills every terminal of the project, running processes included, with no
  dialog. Its reaping assertion in `terminal-no-orphans.e2e.ts` stands.
- **Settings**: `confirmations.unloadProject` is withdrawn — descriptor, control, parse, clone and
  planner input (FR-111). `projects.unloadTerminalAction` is unchanged. A saved value stays in a
  development `settings.json` as an unmodelled key (`settings-validity.test.ts:57`).
  *Corrected in implementation, 2026-09-25 (FR-111's supersede note):* it stays only until the next
  settings write. `writeConfigPatch` normalises through `parseSettingsGuarded`
  (`config-write-ipc.ts`), which drops unmodelled keys, as 019 FR-023 does for a retired key;
  `config-write-patch.contract.test.ts` asserts the drop.
- **Tests**: `terminal-no-orphans.e2e.ts`'s Keep running declaration is rewritten in place to
  assert that the idle shell's process survives and is the same process after reload; the End
  terminals declaration is unchanged. The budget does not move.
  *Corrected (analyze M8, 2026-09-25):* the End terminals declaration **does** change, in place
  (T129): it clicks **Unload Project and End Terminals** instead of the old choose-dialog path, and
  no longer presses Enter for a confirmation, because none is shown (FR-111). Its reaping assertion,
  tags and `@reserve:process` are unchanged, no declaration is added or removed, and the budget does
  not move.
