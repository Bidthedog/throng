# Quickstart: Validating Settings Write Integrity

**Feature**: 032-settings-write-integrity | **Date**: 2026-08-14

How to prove this feature works — by hand, and by suite. The by-hand path matters more than usual
here, because the defect is a race: a green suite proves the guard holds under the conditions the
suite creates, and only a human racing two windows proves it holds under the conditions that produced
the bug reports.

## Prerequisites

```bash
npm install          # only if the worktree has not been bootstrapped
npm run build        # dist/ must be current — the E2E layer launches the built app
```

## The one command that decides done-ness

```bash
npm run gate
```

Seven stages, fail-fast: lint → typecheck → build → unit → integration → contract → e2e. Anything
less is progress, not done-ness. See the rule in `CLAUDE.md`.

## #249 cannot be reproduced by hand. Don't try.

An earlier version of this document asked you to change a preference and then "immediately" create a
project. That instruction was wrong and is withdrawn: the window is roughly **45 milliseconds**, and
no person can act inside it. Switching windows alone costs longer than that. A verification step
nobody can perform is worse than no step at all, because it reads like coverage.

**#249's verification is machine-only**, and that is a statement about the defect rather than an
excuse:

```bash
# RED on master, GREEN here. The reproduction fills the project form FIRST, changes the
# preference, and only then clicks Save — one click between the two writes.
npx playwright test packages/ui/tests/e2e/settings-write-integrity.e2e.ts --workers=1 --retries=0
```

Measured on `master`: **red 10 runs out of 10**. That is the evidence, and it is stronger than a
human observation would have been — a person could confirm the symptom once, where the suite
confirms it deterministically and will keep confirming it every run from now on.

What you *can* do by hand is confirm the symptom **exists** rather than race it. Set a preference,
use the app normally for a minute — create a project, open a folder, rename a panel — then reopen
Preferences. On `master` a setting occasionally reverts with nothing on screen to say so; on this
branch it does not. That is the user's actual experience of #249, and it is the thing worth
believing. It is not a *test*, because it cannot fail on demand.

## What you CAN verify by hand

Every check below is deterministic and human-speed. Between them they cover #260 completely and
#249's consequences.

### The one that proves #260, and it is fully deterministic

This is the important one, and it needs no timing at all.

1. Launch the app and set **Preferences → Notifications → Error → Never display**.
2. Confirm it landed: `%APPDATA%\throng-dev\settings.json` shows `"mode": "never"`.
3. With the app still running, **truncate the file by hand** — open it in a text editor, delete
   everything after the first twenty characters or so, and save. That is exactly what the config
   watcher can catch mid-write, only now you control when.
4. Watch what the app does.

**On `master`**: every setting silently becomes its shipped default, and stays there. The app is now
running under settings you never chose, and nothing re-reads.
**On this branch**: the truncated read is retried; a file that stays broken surfaces as a problem
rather than being quietly replaced by defaults.

### The reset paths, also deterministic

5. With `settings.json` still truncated, open Preferences and use a **per-setting reset** (the reset
   icon on any modified row). On `master` that rewrites the *whole* document from the shipped record
   — every other choice you made, gone. On this branch it refuses and changes nothing.
6. Do the same with a **key binding** reset against a truncated `keybindings.json`. Same story: on
   `master` every chord you rebound is replaced.

## Negative cases worth trying

These are the ones that catch an over-eager fix.

1. **The JSON tab still replaces the whole document.** Preferences → Settings → toggle to JSON,
   delete a key entirely, then **toggle back to the visual editor** — leaving is what applies it now
   (FR-017). The key is *gone*, not merged back from disk. Whole-document semantics are correct there
   and must survive.
2. **Two writers on the same key converge.** Open Preferences and leave it on Notifications. In a
   text editor, change `notifications.error.mode` in `settings.json` by hand and save. The control in
   Preferences must move to the value you typed — one value, no flicker back to the old one, and no
   third value that neither writer asked for.

   *(This is the honest version of a case an earlier draft got wrong. It said to open "a
   sub-workspace window showing the same preference" and change it in both "within a second". Both
   halves were impossible: `subworkspace-app.tsx:138` passes `showCog={false}`, so a sub-workspace
   window has no cog and cannot open Preferences — there is exactly one Preferences window — and
   "within a second" was the same un-performable race withdrawn from #249 above. Your text editor is
   a real second writer, and it is one you control the timing of.)*

3. **A write that cannot land is reported.** With the app running, **replace `settings.json` with a
   folder of the same name** containing any file. That makes the atomic commit's rename fail with a
   genuine EPERM, and it is far easier to do and undo than fighting Windows ACLs. Now change a
   setting **from the main window** — creating a project is the easy trigger. A notice must name the
   document and say nothing was changed. On `master` this fails silently, because the notice
   subscriber is mounted only in Preferences. Delete the folder and restore the file afterwards.
4. **A suppressed severity still logs.** With errors set to *never display*, repeat case 3. No notice
   appears, and the failure is still in the diagnostics log.

The hand-corruption case that settles #260 is not repeated here — it is steps 3–6 of *What you CAN
verify by hand* above, where it belongs, because it is a positive check rather than a guard against
over-fixing.

## The JSON editor's edit lifecycle (FR-017 – FR-019a)

This is the part that was reported by hand, so it is the part most worth checking by hand. Every
step below is human-speed; none of them needs you to beat a clock.

7. **Nothing is written while you type.** Preferences → Settings → toggle to JSON. Change the theme
   name to something else, and **wait**. `settings.json` does not change. On the previous build it
   was written ~300 ms after you stopped typing, and if the value you were halfway through happened
   to be out of range, throng corrected it and wrote the correction back — which is what moved your
   caret and raised *"this file changed on disk"*.
8. **Leaving applies it.** Toggle back to the visual editor. Now `settings.json` has your change, and
   the visual editor shows it.
9. **A half-typed number no longer fights you.** Put the caret in the middle of a numeric value —
   `panes.projects.maxWidth`, say — and type slowly, pausing between digits. The caret stays where
   you left it, no banner appears, and nothing is rewritten under you. On the previous build a pause
   with an out-of-range intermediate value was enough to move the caret to line 1, column 1.
10. **You cannot leave it broken.** Delete a closing brace. A red panel appears naming what is wrong.
    Now try all three exits: click another tab, click the JSON toggle, and close the window. Each is
    refused, visibly — never silently ignored.
11. **The notice says what is wrong, per value.** Fix the brace, then set
    `"panes": { "projects": { "maxWidth": 99999 } }`. The panel names the key, states the permitted
    range, and shows the value you typed. Try an enumerated setting too —
    `"notifications": { "error": { "mode": "loud" } }` — and it lists the values that *are* accepted,
    so you never have to leave the editor to find out.
12. **The escape works.** With the document still invalid, close the window. The refusal offers
    **Discard changes and close**. Take it: the window closes, and `settings.json` still holds the
    last valid document — nothing was written, so there is nothing to roll back.
13. **A valid buffer survives closing the whole app.** Re-open Preferences → JSON, make a valid
    change, and *without leaving the editor* close throng itself. Re-launch: your change is there.
    This is the fourth exit, and the one the three apply triggers do not cover.
14. **A genuine external change is reported, not adopted.** With the JSON editor open and your caret
    in it, edit `settings.json` in a text editor and save. A note appears saying the file also
    changed; your buffer and your caret are untouched, and your version wins when you leave. That is
    what a text editor does, and it is what the old conflict banner should have been.

## Proving it by suite

```bash
# The reproduction, on its own. Must be RED on master, GREEN here.
npx playwright test packages/ui/tests/e2e/settings-write-integrity.e2e.ts --workers=1 --retries=0

# The specs that write a running app's config, together, retries off.
THRONG_E2E_RETRIES=0 npx playwright test preferences notification-prefs --workers=1

# The #250 condition — the FULL serial tier, which the preferences subset does not reproduce.
THRONG_E2E_RETRIES=0 THRONG_E2E_TIER=serial npx playwright test --workers=1
```

Recorded this session as the pre-change baseline, so a later red can be attributed honestly:
**94 passed, 0 failed, 0 flaky in 5.1 minutes** for the second command. The reported bugs do not
reproduce from the preferences subset — which is why the third command exists.

## What "done" looks like

- `npm run gate` green, including its E2E stage.
- `settings-write-integrity.e2e.ts` observed **failing on `master`** and passing here. A test that was
  never seen red proves nothing.
- The manual reproduction above no longer reverts the setting.
- Exactly one atomic config-write helper in the E2E tree, asserted by
  `packages/ui/tests/unit/config-write-helper-single.test.ts` (T047) rather than by a grep.

  An earlier draft of this section told you to run `grep -rl "writeFileSync" packages/ui/tests/e2e`.
  Don't: it matches **119 files and 378 occurrences**, counts neither implementations nor writes to a
  *running* app's config root, and misses any writer using `fs.promises.writeFile` or a stream. A
  check that cannot fail is not a check.
