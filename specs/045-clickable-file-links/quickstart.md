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
