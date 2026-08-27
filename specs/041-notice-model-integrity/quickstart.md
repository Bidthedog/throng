# Quickstart: validating Notice-Model Integrity

**Feature**: 041 · **Spec**: [spec.md](./spec.md) · **Contract**: [contracts/notice-model.md](./contracts/notice-model.md)

Every scenario below is one a person can actually perform. Where a check needs sub-second timing, a
statistic, or state that exists only transiently, it is **an automated test and not a manual step** —
those are listed in §6 with the command that runs them, because handing someone a stopwatch is how a
race condition ships unverified.

---

## 0. Prerequisites

```sh
npm run build
npm run start:ui
```

Open a project with a nested folder structure — three or more levels, several files. A second
terminal for the `git worktree remove` / `rm -rf` in §1.

**Diagnostics log**: `%APPDATA%/throng/logs/main.log`. Several checks below read it; keep it open in a
tail.

---

## 1. One cause, one notice (US1 · #278)

1. In the file tree, expand a folder and **three of its descendants**, so all four are open.
2. From the second terminal, remove the outermost of those four (`rm -rf <path>`).
3. **Expect exactly one notice.** Not four, not five.
4. Read it: it names **the folder you removed**, not each descendant.
5. **No `ENOENT`, no `realpath`, no raw error text anywhere on it.** This is the check most likely to
   regress silently, because the raw error is legitimately present two lines away in the log.
6. Press **Copy** on the notice, paste somewhere. The raw system error **is** in the payload, below
   the human-readable sentence.
7. In `main.log`, the raw error appears **once**.
8. **Now the log count.** Expand a folder and four descendants, remove the outermost, and count log
   entries for that removal: **one notice on screen, five entries in the log.** The screen count falls;
   the log count does not.

**Then the negative case** — this is the one that proves suppression keys on ancestry rather than on
arrival time:

9. Create three folders that are **siblings** (no common removed ancestor), expand each, and remove
   all three in one command.
10. **Expect three notices.** One per removed folder whose parent survives. Merging them would be
    grouping by time, which 030 FR-036 forbids.

---

## 2. One row per casualty, flashed on repeat (US2 · #328)

1. Create a file too large to open (`fsutil file createnew big.bin 200000000`, or any file past the
   size limit).
2. In Preferences, set **Editor → Open target** to **New Editor** — this is the configuration under
   which the duplicate row reproduced.
3. Open `big.bin` from the tree. **Expect one notice, one row, and no editor panel.**
4. With the notice still on screen, open it **twice more**.
5. **Expect the row count to stay at one**, and the notice to **pulse** on attempts two and three.
6. **Nothing on the row counts the repeats** — no "×3" badge.
7. Watch the dismissal countdown: each repeat **restarts** it. A notice you keep re-triggering does
   not vanish underneath you.
8. Now dismiss the notice, and open `big.bin` again. **A fresh notice appears** — suppression is per
   live notice, not permanent.
9. Set the severity's display mode to **Dismiss only** and repeat step 4. It **pulses** and nothing
   else changes; there is no timer to restart.
10. Set it to **Never display** and repeat. **No notice, and no pulse** — but the entry still reaches
    `main.log`.

**The row's path** (FR-018):

11. Open a refused file that sits several folders deep. The row shows its path **relative to the
    project root** — not `D:\...\project\a\b\c\big.bin`.
12. Copy the notice: the **absolute** path is in the payload. Same in `main.log`.
13. Do the same with a refused file **outside** the project. The row still renders a sensible,
    truncated path and the notice does not grow taller than its bound.

---

## 3. A refusal is not a document (US3 · #327)

The whole point is that the outcome stops depending on unrelated workspace state, so run it **three
times** and compare.

1. **With no editor panel open at all**, open `big.bin` from the tree.
   - **Expect: zero panels created, and a notification naming the reason.**
   - This is the case that is broken today — currently you get a panel with a "could not be read"
     banner and *no* notification.
2. **With one editor panel already open**, open `big.bin`.
   - **Expect: identical outcome.** Zero *new* panels, one notification.
3. **With three editor panels open**, open `big.bin`. **Identical again.**
4. Repeat 1–3 for each refusal reason: a **binary** file, a file **outside the project**, and a
   **folder**. Same outcome each time.
5. **Every entry point** (FR-013a): repeat step 1 from **Quick Open**, and by **dragging the file onto
   empty space**. Same outcome.
6. **The exception**: drag `big.bin` onto an **existing** editor panel. That creates nothing, so its
   current behaviour is unchanged — you get the existing refusal handling, not a new panel.

**The two things that must NOT change:**

7. Open a file, then delete it outside throng, then use **File → Open Recent** (or reopen it). A
   **missing** file is not a refusal: its panel still opens, still holds a recovered buffer, and can
   still be saved back.
8. Open a file, close throng, make the file too large, reopen throng. **Workspace restore still
   creates the panel** — restore is not an open-a-file action.

---

## 4. A keyboard route to a notice (US4 · #314)

1. Trigger any notice that carries a list of rows (open two different refused files).
2. **Before pressing anything**: the list shows a **visible cue that it is focusable** — not just a
   focus ring that appears after you arrive.
3. Press **`Ctrl+Alt+M`**. Focus moves to the most recent notice.
4. Scroll the list with the arrow keys.
5. Press **Escape**. Focus returns to **exactly where it was** before you pressed the chord.
6. **From a focused terminal**: click into a terminal, type a few characters, press `Ctrl+Alt+M`.
   Focus moves to the notice, and **the shell never saw the chord** — nothing was typed into it.
7. Press `Ctrl+Alt+M` **twice**. You stay on the most recent notice; it does not walk to the older one.
8. With focus on a notice, raise another. **Focus does not move.**
9. Tab from the notice. Focus **leaves** — it is never trapped.
10. Tab on to a second notice, then press Escape. You land back on **the element you started from**,
    not the notice you tabbed from.
11. Dismiss every notice, then press `Ctrl+Alt+M`. **Nothing happens, and no notice appears saying
    there are no notices.**
12. Press `Ctrl+\`` (cycle focus) repeatedly. **Notices are not in the ring.**
13. In **Preferences → Keybindings**, find `focus.notice`. It is listed, shows `Ctrl+Alt+M`, and is
    rebindable like any other binding.

---

## 5. Screen-reader behaviour

Needs a real screen reader (Narrator or NVDA on Windows).

1. Trigger a refused open. The notice is announced once.
2. Re-trigger the same file. **The repeat is announced** — briefly, naming the file — and it **does
   not re-read the whole list**.
3. Rapid repeats (hold the open action, or open ten times quickly) produce **one** announcement, not
   ten. This is the audible form of the row-stacking the feature exists to stop.

---

## 6. What is proven by test, not by hand

These need sub-second timing, a permutation sweep, or a count over many runs. Run the commands; do
not attempt them manually.

| What | Command |
|---|---|
| One notice per removal at 1, 3 and 5 expanded descendants | `npm run test:unit` |
| The same result under **every permutation** of event arrival order | `npm run test:unit` |
| Ten repeats → one row, with **and** without a panel | `npm run test:unit` |
| Suppressed casualties still reach the log, at the cause's level | `npm run test:unit` |
| Utterances equal pulses (rapid vs spaced repeats) | `npm run test:component` |
| Focus idempotence across three live notices; Escape origin after tabbing | `npm run test:component` |
| Zero panels created at 0, 1 and 3 existing editors | `npm run test:integration` |
| A **missing** file is still openable — 018's recovery path intact | `npm run test:integration` |
| A failure banner prints its path exactly once, both panel types | `npm run test:component` |
| A notice re-triggered below its timeout never expires | `npm run test:component` |

**The full gate**, which is what establishes done-ness:

```sh
npm run gate
```

Eight stages in CI's order, fail-fast: lint → typecheck → build → unit → component → integration →
contract → e2e. ~18 minutes for the E2E stage alone.

---

## 7. Regression watch

Behaviour 029 and 030 established that this feature must not disturb. If any of these changes, the
work is wrong even if everything above passes.

1. Rename a project's root with editors **and** terminals open → still **one** notice, listing both
   kinds of panel, naming the project once.
2. Two genuinely unrelated failures → still **two** notices. They do not merge because they arrived
   together.
3. A panel already open on a file that later becomes unopenable → its **banner** behaviour is
   unchanged.

**Not in this list, deliberately:** *"a panel's failure banner prints its path once"* (FR-019). It
belongs to the **guards**, not to a manual watch — it is already true in both panel types, and a
requirement that is true with nothing asserting it is how the three requirements this feature
restores came to stop holding. It is asserted by T047a, in `packages/ui/tests/component/panel-failure-banner.test.ts`.
