# Quickstart: proving Failure Presentation works

Phase 1 validation guide. Written for someone driving the real app, in the order the stories land —
so it can be run after any phase, stopping where the work stops.

## Prerequisites

```bash
npm install
npm run build
```

A scratch project you can break on purpose:

```bash
mkdir -p D:/git/throng_tests/"test 1"/{a,b}
printf 'one\n'  > D:/git/throng_tests/"test 1"/a/one.txt
printf 'two\n'  > D:/git/throng_tests/"test 1"/b/two.txt
```

Then in throng: add `test 1` as a project, make **Tab 1** with two editors (`one.txt`, `two.txt`)
and a terminal, and **Tab 2** with one editor and one terminal. Leave Tab 1 active.

## A — Display modes (#224)

1. `npm run start:ui`. Preferences → Settings → **Notifications**. Four rows, each with a mode and a
   timeout in ms.
2. Set `info` to **Display for** `1500`. Do something that raises an info notice; it goes after ~1.5s.
3. Set `info` to **Dismiss only**. Raise it again — it stays until you dismiss it.
4. Set `info` to **Never display**. Raise it — nothing appears. Then check the log:

   ```bash
   tail -5 "$APPDATA/throng/logs/main.log"     # the event is there, tagged renderer-notice
   ```

4a. Now set **Diagnostics → log level** to `error`, and repeat step 4. The `info` notice must **still**
    reach the log — notice records bypass the threshold (FR-006b). Without this step the whole
    guarantee behind Never display can be silently false while everything looks fine.
4b. Raise the *same* silenced event twice in quick succession. The log holds **one** record, not two —
    a silenced notice is de-duplicated exactly as a displayed one is (FR-005b).
4c. Still silenced, let the same cause claim a **further** panel (open another affected tab). A
    **second** record appears, naming the new panel (FR-005c). This is the clause that decides whether
    a spreading failure is recorded at all once its severity is silenced — 4b and 4c fail in opposite
    directions, so run both.

5. Set `error` to **Never display** — you are asked to confirm and told errors will only reach the
   log. Decline; the mode stays as it was. Accept; then break something and confirm no toast appears
   **but the panel still shows its banner**.
6. Try to type `900` into a timeout. It cannot be committed (min 1500).

## B — Named subjects (#195)

7. Rename a panel to a name another panel already has. The notice names **both** panels, not "this
   item".
8. Delete `one.txt` outside throng and click its editor tab. The notice's heading names the file.
9. Do two different things to the same panel and confirm both notices spell it identically.

## C — One notice per cause (#235)

10. Quit throng. Rename `D:/git/throng_tests/test 1` to `test 1 moved`. Start throng and open the
    project.
11. **Exactly one notice**, naming the project once, listing Tab 1's affected panels grouped under
    **Tab 1** — panel names only, no project on any row.
12. Click **Tab 2**. Its panels join the *same* notice under a **Tab 2** heading. No second notice.
13. Dismiss the notice, then visit a third tab (add one first). A **fresh** notice appears listing
    only the newly discovered panels.
14. Confirm the old per-tab notices are gone: no "Cannot open 2 files", no "Cannot open file".
15. Click a row and a tab heading in the list — nothing navigates.

## D — The shared banner (#236)

16. With the project still broken, look at an editor and a terminal side by side. Same banner shape,
    same controls — **Try again** and **Clear panel type** — in the same order. (Copy arrives in E.)
17. On the **editor**, press **Clear panel type**. The panel returns to panel-type selection, keeping
    its position and title — it is not deleted. (This is new; it was impossible before.)
18. Open each failed panel's own menu: Try again and Clear panel type are both there as commands.
19. Check the editor's banner still names the path it could not read.
20. Put the folder back. Press **Try again** on a panel — the banner goes with the condition.
21. Break it again and press **Try again** — the banner stays and says the retry failed.
22. Tab through a failed panel: both controls are reachable by keyboard.

## E — Copy (#238)

23. With the consolidated notice on screen and its list scrolled, press Copy. Paste into an editor
    panel: the whole list is there, tab groups intact, in displayed order, and unchanged by the paste.
24. Dismiss the notice. Press **Copy details** on a panel's banner. You get the headline, the panel as
    `Project — Tab — Panel`, the path and the system error — with no notice on screen.
25. Set every severity to **Never display** and repeat 24. Copy still works.
26. Now all three controls are present: Try again, Copy details, Clear panel type — in that order, all
    keyboard-reachable, and all three in the panel's menu.

## F — Accessibility

27. With a screen reader running, trigger the consolidated notice, then switch to Tab 2. Only the
    addition is announced ("Tab 2: 2 more panels affected") — the list is not read again.
28. Tab into the notice's list, scroll it with the keyboard, and tab out again.

## Automated equivalents

```bash
npm run lint && npm run typecheck
npm test                    # unit + integration + contract + both local E2E tiers
```

The E2E specs added by this feature must all be registered in
`packages/ui/tests/e2e/shard-plan.json`, and in `packages/ui/tests/e2e/parallel-plan.json`'s serial
list **where they open Preferences, drive a context menu, or run a real shell** — not blanket, since
the serial list already holds 103 entries and needless serialisation costs suite time.
`shard-plan.test.ts` fails the build if a spec is in no shard group.
