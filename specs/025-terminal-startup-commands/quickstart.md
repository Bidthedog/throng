# Quickstart: Terminal Startup Commands & Command Memory (025)

How to prove the feature works, by hand and by suite.

## Prerequisites

```bash
npm install          # once, in this worktree
npm run typecheck    # must be clean before starting
```

## The gates

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:contract
npm run test:e2e          # builds first via pretest:e2e
```

Baseline before this feature: lint 0, typecheck 0, **1482** unit, **360** integration, **60** contract.
Any number below those is a regression, not a starting point.

## Scenario 1 — a startup command runs (US1)

1. `npm start`, open a project.
2. On an empty panel choose **Terminal**, pick a flavour, type `npm run dev` in **Startup Command**,
   Confirm.
3. **Expect**: the terminal opens and the command begins running.
4. Stop it (`Ctrl+C`). **Expect**: an interactive prompt remains — *not* a closed terminal. This is the
   assertion that catches a wrong recipe; `bash -c` without the re-exec fails exactly here.
5. Close and reopen the project. **Expect**: the command runs again.

Repeat for **each** built-in flavour — the recipes differ per shell, so one passing flavour proves nothing
about the others.

## Scenario 2 — quoting survives (FR-013)

Startup Command: `git commit -m "a message"` — expect the shell to receive it intact. `cmd` is the one
that breaks first if the argv composition regresses (research R1a).

## Scenario 3 — the memory rule (US2)

With **Remember the last running command** ticked, each row is a separate run:

| Start with | Do | Kill terminal while | Expect saved |
|---|---|---|---|
| `npm run dev` | nothing | running | `npm run dev` |
| *(empty)* | run `npm run dev` | running | `npm run dev` |
| *(empty)* | run then **stop** `npm run dev` | idle | *(empty)* |
| `npm run dev` | **stop** it | idle | `npm run dev` |
| `npm run dev` | stop it, run `ping -t bbc.co.uk` | running | `ping -t bbc.co.uk` |

Then untick the box and repeat row 2 — the saved command must **not** change (FR-018).

Read the saved value by closing the terminal: the panel returns to its empty form, **pre-filled**
(FR-007a). That is also the only edit surface (FR-007b).

## Scenario 4 — crash survival (FR-019, US2.7)

Start a long-running command, then kill the daemon process outright (Task Manager) rather than closing
throng. Reopen. **Expect** the command to have been captured — this is what live tracking buys, and the
only scenario that distinguishes it from a read-at-teardown design.

## Scenario 5 — directory memory (US3)

`cd` a terminal into a subdirectory, close and reopen the project. **Expect** it to reopen there, and a
second panel to reopen in *its* own directory. Delete a remembered directory and reopen: expect the
project root, **no error dialog** (FR-030).

Do this with memory **off** too — directory memory is independent (FR-027a).

## Scenario 6 — a user-defined flavour launches (#113 / FR-042)

Add to `settings.json`:

```json
{ "terminals": { "flavours": [
  { "id": "my-cmd", "label": "My CMD", "file": "C:\\Windows\\System32\\cmd.exe",
    "args": [], "defaultShellArguments": "", "commandRecipe": ["/K", "{command}"] }
] } }
```

Pick **My CMD**, give it a startup command, Confirm. **Expect** it to launch *and* run the command —
the claim nothing in the suite made before.

## Scenario 7 — the rename migrated (FR-002d)

Before upgrading, save a `settings.json` containing the **old** keys:

```json
{ "terminals": { "defaultParams": { "cmd": "/K" } } }
```

Start the app. **Expect** the value intact under Shell Arguments, no error, no reset, no re-prompt.
Same for a layout blob whose terminal panel has `"params": "-NoLogo"`.
