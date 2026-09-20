# Quickstart: validating Clickable File Links

**Feature**: 045 | **Plan**: [plan.md](./plan.md)

How to prove this feature works, cheapest layer first. Types are in
[data-model.md](./data-model.md) and the rules in [contracts/](./contracts/); neither is repeated
here.

## Prerequisites

```bash
npm ci
npm run build
```

**The stale-dist trap.** Vitest resolves `@throng/core` to **source**; the Electron app loads
`packages/core/dist`. This feature is unusually exposed to it — the Key Bindings editor's **Scope**
column for `preview.followLink` is read from `dist`, and so are the settings descriptors. If an E2E
disagrees with a unit test about a scope, a default or a label, rebuild before debugging:

```bash
rm packages/core/tsconfig.tsbuildinfo && rm -rf packages/core/dist && npm run build
```

## 1. The layers, in the order to run them

Load the **running-tests** and **throng-testing** skills first. One test command on the machine at a
time. The commands below are a **sample per layer**; the complete list is the union of the Red
checkpoint tasks in `tasks.md`.

```bash
npm run lint
npm run typecheck
npx vitest run --project unit \
  packages/core/tests/unit/link-detect.test.ts \
  packages/core/tests/unit/link-resolve.test.ts \
  packages/core/tests/unit/link-targets.test.ts \
  packages/core/tests/unit/link-default-action.test.ts \
  packages/core/tests/unit/spawn-env-hyperlinks.test.ts \
  packages/core/tests/unit/keybindings-preview.test.ts \
  packages/core/tests/unit/settings-metadata.test.ts
npx vitest run --project component packages/ui/tests/component/link-*.test.ts
npx vitest run --project integration packages/ui/tests/integration/file-link-resolver.test.ts \
  packages/platform-windows/tests/integration/terminal-hyperlink-env.integration.test.ts
npx vitest run --project contract packages/platform-windows/tests/contract/windows-path-forms.contract.test.ts \
  packages/platform-windows/tests/contract/windows-executable-extensions.contract.test.ts \
  packages/ui/tests/contract/link-ipc.contract.test.ts
npx playwright test packages/ui/tests/e2e/terminal-link-once.e2e.ts packages/ui/tests/e2e/terminal-links.e2e.ts
```

Done-ness is `npm run gate`, dispatched to a hosted runner — never a local green bar:

```bash
gh workflow run gate.yml --ref feature/S045-I198-I394-terminal-and-file-links
gh run watch <run-id> --exit-status
gh run view <run-id> --json status,conclusion --jq '"\(.status)/\(.conclusion)"'
```

## 2. The fixture tree

Everything the acceptance scenarios need, under one temp project root
(`packages/ui/tests/fixtures/links/`):

```text
<root>/test.txt                      US1 s3 — five spellings of one file
<root>/src/foo.ts                    US1 s1, s5 — 100+ lines, so :42:7 is inside it
<root>/docs/a.md                     US3 — names ./b.md, packages/core/x.ts, src/foo.ts:10
<root>/docs/b.md
<root>/docs/My File.md               FR-005 — a quoted path with a space
<root>/packages/core/src/x.ts        US1 s2, US3 s2
<root>/packages/core/                US1 s8 — a terminal cwd for the relative-first rule
<root>/setup.exe  build.bat  deploy.ps1  shortcut.lnk    US4 s6, US5 s6/s7, SC-010
<root>/README.md                     US2 s2, US5 s2/s3 — the preview provider accepts it
<outside>/elsewhere.txt              US4 s3, US5 s5, SC-007 — outside every project root
prose.txt                            SC-003 — slashes, colons and dotted words naming nothing
```

`prose.txt` is the one that earns its keep: SC-003 asks for **0** underlined spans in ordinary log
and prose text, and it is the fixture that fails first if the grammar is loosened.

## 3. Proving each user story by hand

Launch with the **throng-testing** skill (never a bare `npm start`), open the fixture project.

| Story | Do this | Expect |
|---|---|---|
| **US2** | `printf '\e]8;;file:///%s\e\\the project\e]8;;\e\\\n' "$PWD"` in a terminal, then Ctrl+click it | the OS file manager opens on that folder, **once** |
| **US1** | `echo src/foo.ts:42:7` then Ctrl+click | `foo.ts` opens, caret at line 42 column 7 |
| **US1** | `echo "see src/foo.ts."` then hover | only `src/foo.ts` is underlined — the full stop is not |
| **US1** | `cd packages/core && echo src/x.ts` then Ctrl+click | `packages/core/src/x.ts`, not the root's |
| **US3** | open `docs/a.md`, Ctrl+click `./b.md`; put the caret inside `src/foo.ts:10` and press Ctrl+Enter | `docs/b.md` opens; then `foo.ts` at line 10 |
| **US3** | put the caret at the end of any other line, press Ctrl+Enter | a blank line is inserted, as today |
| **US4** | right-click each of: an in-project `.ts`, `README.md`, `<outside>/elsewhere.txt`, a folder | the item sets in [contracts/menus-and-gestures.md](./contracts/menus-and-gestures.md) §1 |
| **US5** | Ctrl+click `setup.exe` | the OS file manager opens with it **selected** — it does not run |
| **US5** | choose **Open in OS Default Program** on the same link | it runs |
| **US6** | turn *Detect file links in terminals* off, hover a path | no underline, no menu items — and a web link and an OSC 8 `file:` link still work |
| **US7** | `echo $FORCE_HYPERLINK` in a **new** terminal | `1` |

## 4. The elevated cases (FR-038, `@admin`)

Meaningless in an ordinary run and must not assert a hollow baseline there (Principle V). A
developer machine is normally not elevated and GitHub's runners always are, so **CI is what answers
these** — they are `@admin`, not `skipIfElevated()`.

```bash
npm run test:e2e:admin
```

By hand, from an elevated throng: choose **Open in OS Default Program** on a `.txt` link and check
the launched editor's process integrity level in Process Explorer. It must be Medium, not High.

*Note 2026-09-18 (third round) — expect this to FAIL until T218 lands (D4).* The app's only
construction of `ElectronShellIntegration` (`main.ts:934`) supplies no de-elevating launcher, so an
elevated throng launches at High today. `npm run test:e2e:admin` and the `@admin` integration case can
both pass meanwhile, because they supply their own launcher; this hand check is the one that shows the
defect, and it is the check to repeat after T218.

## 5. The performance numbers (SC-004) — measured, not asserted

A wall-clock bound on a shared hosted runner is a flake by construction, so nothing asserts one.
Record the measurement here instead, in the same change:

```bash
# in a throng terminal, on the fixture project, with the switch on and then off
Measure-Command { Get-Content .\big-50k.log }
```

Expect no more than 5% between the two, and no perceptible change in typing latency. The structural
guarantee — that **no existence check runs at all** while output arrives — is what the unit test
asserts (FR-072).

Also record: the FR-073 visible-range scan cost on the largest fixture document (Open item O6).

### Measured 2026-09-18, commit `3cb9c18c`, Windows 11 workstation

A program streaming **50,000 lines** into a `windows-powershell` panel, every line carrying four path
shapes (`src/pkg/fileN.ts:L:7`, a workspace path, a `D:/…` absolute and a `./` relative) — the worst
case for a detector, since every line holds candidates. Timed from the keystroke that starts the
program to its completion marker appearing, driven through the app.

| Detection | Run 1 | Run 2 |
|---|---|---|
| **On** | 5730 ms | 5216 ms |
| **Off** | 5237 ms | 5221 ms |

Within noise of each other — the spread between the two *on* runs is larger than the gap between on
and off — so SC-004 holds: streaming output costs the same with file links on.

**One measurement trap, recorded because it produced a confident wrong answer first.** The completion
marker must be unique per run. With a fixed marker, the previous run's copy is still on screen and
the wait returns immediately, which read as 626 ms against 4539 ms and looked exactly like a 7×
regression. The alternation across runs — fast, slow, fast — is the tell.

### Re-measured 2026-09-19, commit `5bb5230d`, Windows 11 workstation (T295)

Round four replaced the idle scan with a throttled view pass over the rows in view (T237, T262), so
SC-004 was measured again on the same shape: the same 50,000 lines, the same four path shapes per
line, the same `windows-powershell` panel, timed from the Enter that starts the program to a marker
unique to that run. The producer is a Node program that pre-builds the lines and then writes them in
500-line chunks, yielding between chunks — a single giant write arrives as one burst and the view
pass runs only a handful of times, which would understate what detection costs a real stream.
`editor.links.detectInTerminals` is switched through `config.writePatch`, the same write the
preferences form performs, and the two modes alternate.

| Detection | Batch A (3 runs) | Batch B (5 runs) |
|---|---|---|
| **On** | 852, 957, 914 ms | 862, 908, 1411, 932, 920 ms |
| **Off** | 843, 836, 836 ms | 839, 1347, 1355, 1353, 1348 ms |

**SC-004 holds, and the distribution is why the arithmetic is not the answer.** The sixteen samples
sit in two clusters — about 0.85–0.95 s and about 1.35–1.41 s — and BOTH modes appear in both
clusters: batch A's slowest run is detection *on*, batch B's four slowest are detection *off*. A
mean-over-mean reading of batch A alone would have said +8%, over a ceiling of 5%, from a gap of
70 ms that the next eight samples reverse. What the two clusters are was not chased: the point of the
measurement is whether detection is visible in the cost of streaming, and it is not — it is smaller
than a factor neither mode controls.

Absolute times are about six times faster than the `3cb9c18c` figures because the producer is
different (a Node program writing chunks, rather than a shell printing lines one at a time), so the
terminal rather than the producer is the bottleneck here. That makes the comparison *stricter*, not
looser: a per-line detector cost would have more room to show.

**A second measurement trap, in the same family as the one above.** Pass the marker to the program in
TWO halves and let it print them joined. Passed whole, it appears in the command line the shell
echoes, so the wait is met by the echo before the program has printed anything — measured at 9 ms
against 6 ms, which reads as a suspiciously perfect result rather than an obvious error.

## 6. The one thing only a hands-on session can answer

**Does Claude Code emit OSC 8 in a throng terminal under `FORCE_HYPERLINK=1`?** That is a property
of Claude Code on this Windows build, not of throng — no test in this repository can assert it.

```text
1. Start a NEW terminal panel (the setting applies at spawn, FR-080c).
2. Run `claude` and let the status line render.
3. Hover the project-folder reference in the status line.
4. It should underline as a link; one Ctrl+click opens that folder in the OS file manager (SC-005).
5. Turn the setting off, start ANOTHER new terminal, repeat: the reference is now plain text —
   and it must STILL be a link, because detection (US1) catches it either way.
```

Step 5 is the important one: it is the check that US1 and US7 are independent, which is the whole
reason the spec carries both.

## 7. The change request of 2026-09-18 by hand (US8, US9)

What no test here can show is OS Explorer actually opening on a file on a real share, and the feel
of an offline share. Run on the maintainer's own shares (T154):

```text
Network paths (US9)
1. New PowerShell terminal. `cd \\<server>\<share>\<dir>`, then `dir`.
2. Hover a listed name: it underlines. Ctrl+click it: an in-project file opens in throng, anything
   else opens OS Explorer with it selected (FR-110).
3. Hover `\\<server>\<share>\<dir>` inside the prompt (`FileSystem::` form, FR-003g): a folder link.
4. Type `..\` + a sibling's name and Enter (so it is printed); Ctrl+click it: it stays on the share.
5. Open a file that lives on the share in an editor; Ctrl+click a relative path in it.
6. Disconnect the share (or unplug), hover the same text: no underline, the hover gives up within
   the existence-check timeout, and saving a local file at the same moment is not delayed.
7. Reconnect; after the back-off, hovering underlines again with no restart.

One link model (US8)
8. Put `https://example.com`, `src/foo.ts:42:7`, an out-of-project path, a folder, and an in-project
   `deploy.ps1` in an editor and print the same line in a terminal. Hover, Ctrl+click, right-click
   each in both: the tooltips, outcomes and menus match pairwise, and nothing runs or opens in
   another program — except by choosing Open in OS Default Program.
9. Settings: no "Default link action"; "Existence-check timeout" sits under Editor · Links.
```

## 8. The second hands-on round, by flavour (US10, US11, D2)

The corpus is the maintainer's own script, `D:\git\throng_tests\test 1\links-test.sh` (106 lines in
*working* and *broken* sections). It is **not** copied into this repository; run it from where it
lives. Git Bash runs it directly; for the other flavours, run it through Git Bash's `bash.exe` from
that flavour's prompt so the output lands in that flavour's terminal (T192).

```text
For each installed flavour — Command Prompt, Windows PowerShell, PowerShell 7, Git Bash, WSL if set up:
1. New terminal. `cd` into a subfolder of the project.
2. Run the corpus. Without hovering: every line in the *working* section is marked (dashed
   underline) once output stops; nothing in the *broken* section is.
3. Narrow the panel until long links wrap. Every row of each is marked; Ctrl+click the SECOND row:
   the whole target opens, once.
4. Ctrl+click `test.md:3:5` (D2): an editor opens at line 3, column 5 — with the Markdown provider's
   default open action at Preview and at Editor, and with test.md already open.
5. Hover a web link, a path and an OSC 8 link side by side: identical at rest, identical on hover,
   hand pointer only with Ctrl held.
6. Record the outcome per section and per FR-145 cell. A flavour not installed is "not run".
```

*Note 2026-09-18 (third round):* "WSL if set up" means a **user-defined** WSL flavour (025 FR-011) —
WSL is not a built-in flavour and is not offered in the picker until one is configured (T220). In
step 2, the *working* rows that name Git Bash's own paths (`/usr/…`, `/etc/…`, `/tmp`) are expected to
be marked only once FR-151 lands, and never in a WSL flavour.

## 9. The third round, by hand (US12, D3, D4)

The probe that produced [research.md](./research.md) O11 was temporary and is not committed. T219
re-runs it; this is the hand version of the same checks, on the corpus
(`D:\git\throng_tests\test 1\links-test.sh`, not copied in) and on the fixture tree, which gains
`<root>/with space/notes.md` (T201).

```text
Spaces (FR-150)
1. In a terminal and in an editor, print / type `<root>\with space\notes.md`, `/x/…/with space/notes.md`
   (Git Bash drive form) and `/mnt/x/…/with space/notes.md:3`. Each is marked as ONE link, ending at
   `notes.md`; Ctrl+click opens it in throng, the last at line 3.
2. `see <root>\with space\notes.md for details`: the link ends at `notes.md`; "for details" is text.
3. `C:\Windows\win.ini C:\Windows\notepad.exe` on one line: two links, never one joined link.
4. Open fixture `prose.txt`: still nothing marked (SC-003).

Git Bash paths (FR-151, FR-152) — Git for Windows installed
5. Ctrl+click `/usr/bin/bash.exe` and `/etc/hosts` in each built-in flavour and in an editor: OS
   Explorer opens under the Git install with the file selected.
6. Ctrl+click `/tmp`: OS Explorer opens on your user temp folder — not `\tmp` on the current drive.
7. In a WSL flavour (if configured): the same three are not links through Git (T220).

file: spellings (FR-153)
8. `file:///c/Windows/win.ini` as text, and OSC 8 hyperlinks to `file:///mnt/c/Windows/win.ini` and
   `file://localhost/C$/Windows/win.ini`: each Ctrl+click shows win.ini in OS Explorer.

Dead hyperlinks (FR-154)
9. OSC 8 hyperlinks to `file:///C:/does/not/exist.txt`, `file://nonexistent-host-xyz/share/file.txt`
   and `notascheme:foo`: no underline at rest or on hover, no hand pointer, no tooltip, the ordinary
   menu on right-click, and no notice on Ctrl+click.

The click rule, re-checked (FR-110, FR-111)
10. Ctrl+click an out-of-project `win.ini`, a `.dll` and a `.md` in both panel types: OS Explorer,
    never the default program.

D3
11. In an editor, Ctrl+click the FIRST character of several decorated links at column 1, including
    straight after following the previous line's link: every one follows; none adds a cursor.

D4 — elevated throng only
12. §4's Process Explorer check. Medium, not High, after T218.
```

### Corrections to earlier sections (third round; no behaviour change)

- **§3, the two US5 rows** use the fixture's `setup.exe`, which sits **inside** the project root. Under
  FR-114 an in-project executable opens in throng **as its text** on Ctrl+click; it is revealed in OS
  Explorer only outside the project. Use an out-of-project executable (for example
  `C:\Windows\System32\calc.exe`) to see the reveal; the second row (Open in OS Default Program runs
  it) is unchanged.
- **§1's integration sample** names `packages/ui/tests/integration/file-link-resolver.test.ts`; the
  file is `file-link-resolver.integration.test.ts`.

## 10. Round four by hand (US13 – US16, D5)

Prerequisites as above; the fixture tree from §2; Claude Code installed for D5. Run the `echo` rows in a **PowerShell** terminal (Git Bash eats unquoted backslashes; quote the path there). Each row names the
automated test that already holds it — the hands-on row checks what only a person sees.

| # | Do | Expect | Held by |
|---|---|---|---|
| 1 | `echo D:\no\such\file.md` in a terminal | marked at rest, hand pointer without Ctrl, no delay | `terminal-link-view-marks.test.ts` |
| 2 | Plain-click that link | the hint at its bottom-right, "Ctrl+Click to show in OS Explorer"; the click still selects/places as before | `link-hint.test.tsx` |
| 3 | Ctrl+click it | OS Explorer on `D:\no\such` (or its own "cannot find"); throng raises nothing | `file-link-resolver` integration |
| 4 | `echo src/does-not-exist.ts`, Ctrl+click | one notice naming the path; nothing opens | `file-link-resolver.integration.test.ts`, `link-failure-notice.test.ts` |
| 5 | `echo mailto:a@example.com`, Ctrl+click | the mail handler opens | `external-link-uri.test.ts` |
| 6 | Add `ms-msdt` to *Editor · Links · Protocol allowlist*; `echo ms-msdt:x` | not a link; nothing opens | `link-resource-class.test.ts`, `refused-schemes-client.test.ts`, contract |
| 7 | Right-click each fixture link in a terminal, an editor and a Markdown preview | the same Link menu, FR-170's items, "Copy Link to Clipboard" last | `link-menu.test.ts`, component menus |
| 8 | Hover a link with the status bar shown, then hidden | full target bottom-left; nothing when hidden | `link-target-readout.test.tsx` |
| 9 | Run Claude Code full-screen; let the spinner run; hover a path it prints | marked at rest, solid on hover, hand pointer; exit to the normal screen — no stale marks | D5's RED test, E2E alternate-screen case |
| 10 | Add `foo` to *Known file extensions · Added*; `echo "D:\my dir\a.foo"` (quoted — PowerShell prints one argument per line) | one link across the space, no restart | `link-detect-spaces.test.ts`, `known-extensions.test.ts` |
| 11 | Put the hint at the window's right and bottom edges (a link in the last column/row) | fully on screen | `link-hint.test.tsx` clamp cases |

*§7 rows 6 – 7 superseded 2026-09-19 by FR-155 and FR-122a: an offline share's path is underlined as soon
as it is drawn; a Ctrl+click on it waits out the timeout once, and a second Ctrl+click within
`LINK_ROOT_BACKOFF_MS` (30 s) answers at once. What the user then sees depends on where the link lies: outside
the project it goes straight to OS Explorer on its parent and throng raises no notice (FR-158a); inside the
project it raises FR-124's "did not answer" notice. Row 12 below checks the first; row 13 the second.*

| # | Do | Expect | Held by |
|---|---|---|---|
| 12 | Disconnect a share, `echo \\server\share\x.txt` (outside the project), Ctrl+click twice within 30 s | underlined at once; the first click waits the timeout, the second goes to OS Explorer on `\\server\share` with no wait in throng; no throng notice either time | `file-link-resolver-network.test.ts` (FR-122a, FR-158a) |
| 13 | Open a project that lives on that share, disconnect it, Ctrl+click an in-project file link twice within 30 s | the first click raises "did not answer" after the timeout; the second raises it at once | `file-link-resolver-network.test.ts`, `link-actions-router.test.ts`, `link-failure-notice.test.ts` (FR-122a, FR-124) |

## 11. Round five by hand (FR-169a – FR-184, D6)

Prerequisites as above. Create a folder whose last segment contains a space —
`D:\git\throng_tests\test 1` in the maintainer's setup — and open a terminal in it per flavour.

| # | Do | Expect | Held by |
|---|---|---|---|
| 1 | Hover any link in a terminal, an editor and a Markdown preview | **one** popup: the OS's own tooltip showing the link's full target and nothing else. No throng-drawn tip, at any pause | `terminal-link-affordance.test.ts`, `link-decorations.test.ts`, `preview-links.test.ts` (FR-169a) |
| 2 | Hover a link with the status bar shown | the status bar and the tooltip say the **same** string | `link-target-readout.test.tsx` (FR-169a(ii)) |
| 3 | Plain-click a link | the bottom-right hint, unchanged, with FR-168's wording | `link-hint.test.tsx` (FR-165) |
| 4 | Look for *Link hover tooltip delay* in Preferences → Terminal | it is not there | `settings-metadata-links.test.ts` (FR-169b) |
| 5 | Turn *Detect links in terminals* off; print a path, a URL, `mailto:a@b.c` and an OSC 8 hyperlink | **none** of the four is marked, hovered, hinted or followable; a Ctrl+click reaches the program as over plain text. Turn it on: all four return, with no restart — including at an idle prompt | `link-detection-switches.test.ts`, `link-setting-live.test.ts` (FR-180) |
| 6 | The same for *Detect links in editors*, with a web link in the document | the web link goes dark too; Ctrl+click and Ctrl+Enter keep their editor meanings | `editor-web-links.test.ts` (FR-180) |
| 7 | Preferences → Editor → Links | five settings, adjacent: the two switches, **Link resolution timeout**, the protocol allowlist, and **File extensions that end a spaced path** showing the real extensions | `settings-metadata-links.test.ts` (FR-180b, FR-181, FR-182) |
| 8 | Remove an extension from that list, then Reset to Defaults | it stops ending a spaced path at once, and comes back on reset. Clear the list entirely: **no** extension ends a spaced path | `link-setting-live.test.ts`, `app-settings.links.test.ts` (FR-182, FR-182d) |
| 9 | Open a `settings.json` written before round five, holding `knownFileExtensions: { added, removed }`; start throng and change any setting | the list reads as those edits resolved to, and the old keys are gone from the file afterwards | `app-settings.links.test.ts` (FR-182a) |
| 10 | In PowerShell, cmd and Git Bash, sitting in `…\test 1`, look at the prompt's path | the link covers the whole folder, `1` included; Ctrl+click opens that folder | `terminal-link-prompt-cwd.test.ts`, `link-detect-known-directory.test.ts` (D6, FR-183) |
| 11 | Run Claude Code in that folder and look at its header | the same — the folder link keeps its space | as row 10 (FR-183f) |
| 12 | In an editor, type `D:\git\throng_tests\test 1\x.md` in a document | the link still ends at `x.md`'s extension, and prose after a path is still prose: an editor has no working directory to be told about | `link-detect-spaces.test.ts`, unchanged (FR-183e) |
| 13 | Look at any link at rest, then hover it, in a light and a dark theme | the resting underline is visibly fainter; the hovered one is solid | `link-decorations.test.ts`, `terminal-link-affordance.test.ts` (FR-184) |
| 14 | Type `someone@example.com` in an editor, `echo someone@example.com` in a terminal, and put it in a Markdown preview | all three make it a **mail** link: the hover title reads `mailto:someone@example.com`, and Ctrl+click opens the mail handler. **Nothing** offers to open a file beside the panel's directory (D7) | `link-bare-email.test.ts` (FR-185) |
| 15 | Remove `mailto` from *Editor · Links · Allowed link protocols*, then repeat row 14 in the editor and the terminal | the address is plain text — no mark, no hover title, no menu — and **still** not a path: Ctrl+click offers no file (the Markdown preview keeps 044 FR-091's own `mailto:`, S6 addendum) | `link-bare-email.test.ts` case 6 (FR-186) |
| 16 | `echo D:\p\a.b@c.com\x.ts` and `echo @scope/pkg` | both are read as before — a path and a path candidate, never addresses | `link-bare-email.test.ts` control cases (FR-185b) |
| 17 | Hover `/tmp` and `/etc/hosts` in all three surfaces, read the title and the status bar, **then** Ctrl+click | the title and the status bar show `/tmp` and `/etc/hosts` **as written** — never `<project>\tmp` — and the click opens the temp folder and Git's `etc\hosts`. Nothing claims a place the click does not go (D8) | `link-readout-truth.test.ts`, `link-target-readout.test.ts` (FR-187) |
| 18 | The same for a rooted path that **is** in the project (`/src`), and for `/help` | both also read as written: the renderer cannot tell them from `/tmp`, and naming the root for one would mean naming it for all | `link-readout-truth.test.ts` case 3 (FR-187b) |
| 19 | The same for `D:\git\x.ts`, `/d/git/x.ts`, `src/foo.ts` and an OSC 8 hyperlink | each still **names its location**: the drive, the drive form's drive, the base directory joined, and the declared target | `link-by-name-readings.test.ts` (FR-187a) |
| 20 | **Known gap, expected to fail**: plain-click `/tmp` and read the hint | it says "Ctrl+Click to open in throng active editor" while the click reveals a folder. Reported, not fixed — the wording is the maintainer's to choose (FR-187's known gap) | — |

### Corrections to earlier sections (round five; the rows above are the current behaviour)

- **§3's US6 row** ("no underline, no menu items — and a web link and an OSC 8 `file:` link still
  work") is superseded by FR-180: with the switch off, **nothing** is a link in that panel type. Use
  §11 row 5.
- **§9 row 9** ("no … tooltip") and **§7's tooltip expectations** describe throng's deleted tip. A dead
  OSC 8 target is still not a link and still gets **no** title, because no link is hovered; what changed
  is that a *valid* link's hover is a native title, not a tip (FR-169a).
- **§9 item 7's** "Settings: … 'Existence-check timeout' sits under Editor · Links" reads **Link
  resolution timeout** (FR-181), and the block now holds five settings.
- **§10 row 10** ("Add `foo` to *Known file extensions · Added*") reads: add `foo` to **File extensions
  that end a spaced path** (FR-182).
