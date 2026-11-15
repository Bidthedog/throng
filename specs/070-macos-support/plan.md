# Implementation Plan: macOS Support

**Branch**: `feature/S070-I22-macos-support` | **Date**: 2026-11-15 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

**Input**: Feature specification from `specs/070-macos-support/spec.md`

## Summary

throng gains a third platform implementation set. A new `@throng/platform-macos` package implements every seam in
`PlatformServices` (`packages/platform/src/index.ts`), and `selectPlatform('darwin')` returns it instead of refusing.
POSIX code Linux and macOS share moves into `@throng/platform-node`, the existing shared leaf, and Linux re-exports it
unchanged. macOS process facts (tree, start time, argv, cwd, CPU, memory, I/O) come from `libproc` and `sysctl` through
koffi, the FFI already loaded on every platform. Pure core rules gain the macOS facts they need through host traits:
case-insensitive paths with case-sensitive volume roots, NFC normalisation, and the Cmd modifier. The UI main process
gains a macOS window chrome (native traffic lights), an application menu, Dock-resident close, a quit flow routed through
`before-quit`, folder opening from the Dock and Finder, a translocation refusal and an **Install 'throng' command**
action. Packaging adds an Apple silicon `.dmg` and `.zip`, ad-hoc signed at build time. CI, the gate and the release
pipeline gain macOS jobs on the current and previous macOS releases, named once in `.github/macos-runners.json`. Principle
II is amended so every later per-OS feature ships all three platforms.

## Technical Context

**Language/Version**: TypeScript 7 (`@typescript/native`), Node ≥ 22.12 (CI 24), Electron 45.

**Primary Dependencies**: node-pty 1.1 (ships `darwin-arm64` prebuilds with `spawn-helper`), better-sqlite3 13.1
(prebuildify, ships `darwin-arm64`), koffi 3.3 (ships `darwin_arm64`), xterm.js 6, InversifyJS 8, electron-builder. No new
runtime dependency: macOS facts come from `libproc.dylib` and `sysctl` through koffi, `osascript -l JavaScript` for the two
Cocoa calls that have no C API (font families, trash with resulting URL), and Electron's `shell`, `app` and `Menu`.

**Storage**: SQLite at `~/Library/Application Support/throng[-dev]/throng.db`; settings at
`~/Library/Application Support/throng[-dev]/settings`; logs at `~/Library/Logs/throng[-dev]` (FR-014, R5).

**Testing**: vitest (`unit`, `unit-isolated`, `component`, `integration`, `contract`); Playwright-Electron E2E with the
`@core` and `@extended` lanes and a new `@macos` category tag; a new asserting mode of `terminal-load.measure.ts` for
FR-050.

**Target Platform**: macOS, current and previous release, Apple silicon. CI: GitHub-hosted arm64 runners named in
`.github/macos-runners.json` (today `xcode-27` on macOS 27 and `macos-26`, R25). No Intel build.

**Project Type**: Electron desktop application, npm-workspaces monorepo.

**Performance Goals**: SC-012 / FR-050, p95 typed-character latency ≤ 100 ms with 10 terminals, asserted in the macOS gate
lane. libproc sampling stays inside 055's collector budget (one `proc_listallpids` plus two `proc_pidinfo` calls per
relevant process per sample).

**Constraints**: FR-039 (Windows and Linux unchanged, byte-identical CI jobs), FR-011 (no OS branch in core logic),
Principle III (no orphans), Principle V (lowest layer owes the assertion), best endeavours (no manual test on a Mac: every
macOS behaviour is proved by an automated test on a hosted runner, or listed in the known differences).

**Scale/Scope**: 26 `PlatformServices` entries get macOS implementations; about 8 Linux classes move to `platform-node` as
POSIX shared code; about 40 `process.platform` / `os` branches are audited (research R32), and the 7 that misroute darwin
are fixed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: unchanged.*

| Principle | Result | How |
|---|---|---|
| I Project-first | Pass | No project model change. |
| II Platform-abstracted core; per-OS code delivered together | **Pass after amendment** (FR-002) | Every macOS service sits behind an existing seam or one new seam (`ICommandLineInstall`, `privacyProtectedRoots`), each with Windows and Linux implementations. The amendment makes macOS a supported target, MINOR bump to 6.6.0 (R29). |
| III Terminal hygiene | Pass | macOS process-tree end and orphan reap proved by contract and integration tests against `libproc` (R2, R10). |
| IV Keyboard belongs to the terminal | Pass | Terminals keep Ctrl chords; app chords move to Cmd, which a shell never receives. Each macOS default is checked against both reserved tiers and the macOS-reserved list (R21). |
| V Test layering | Pass | Contract suites per seam on macOS; component tests for chrome and menu; E2E only where a real window is under test (`@macos`). New specs pay into the E2E ratchet. |
| VI Reachability | Pass | Every new action (Install/Uninstall command) is in the application menu and the key bindings list. Absent capabilities (right-click Finder item, OS properties dialog) hide their control. |
| VII Change review | Pass | No change to review tooling. |
| VIII SOLID/DRY/YAGNI | Pass | Shared POSIX code moves to `platform-node` rather than being copied. No Intel build, no universal binary. |
| IX DI and composition root | Pass | macOS services enter through the same `PlatformServices` factories. Host traits stay the recorded 062 exception, unchanged in kind. |
| X Externalised configuration | Pass | `terminals.macOptionIsMeta` is a setting with editor metadata, `onlyOn: 'macos'`. The runner list is a committed file. |
| XI Dockable workspace | Pass | No layout model change. |
| XII Responsive UI | Pass | FR-050 asserts typing latency in CI on macOS. libproc reads are synchronous but bounded (R2). |
| XIII Every failure leaves a trace | Pass | Translocation, privacy-denied folders, command install failures and trash-restore failures each raise one notice and log. |

Governing requirements searched before writing: 062 FR-049/FR-050 (seams, refusal), 016 FR-017e (platform-keyed editor
chords), 024 FR-019c (Cmd+click), 046 FR-104 (tier-1 Meta decline), 063 FR-009/FR-010/FR-013/FR-017/FR-018 (upgrade,
notice, removal, verification), 067 FR-022/FR-023/FR-036 (open folder, file-manager item), 055 FR-010/FR-012 (collector,
accuracy), 061 SC-002 (typing latency, reference hardware). The spec's Supersessions list the ones replaced; this plan adds
046 FR-104's Meta clause (macOS only) and `keybindings-platform.test.ts`'s "no macOS chord is guessed" (016), both recorded
in research R21.

## Project Structure

### Documentation (this feature)

```text
specs/070-macos-support/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── platform-services-macos.md
│   ├── app-lifecycle-macos.md
│   ├── keybindings-macos.md
│   ├── packaging-and-release-macos.md
│   └── ci-lanes-macos.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
packages/
├── platform-macos/              NEW  one class per seam; libproc/sysctl FFI; JXA helpers
│   ├── src/{macos-proc-table,macos-process-metrics,macos-process-cwd,macos-process-identity,macos-pty-host,
│   │        macos-orphan-processes,macos-trash,macos-user-directories,macos-volume-roots,macos-file-list-codec,
│   │        macos-font-enumeration,macos-file-attributes,macos-file-access-info,macos-installed-version,
│   │        macos-command-line-install,macos-simple-services,macos-host,index}.ts
│   └── tests/{unit,contract,integration}/
├── platform-node/src/posix/     NEW  shared POSIX code moved from platform-linux (elevation, directory lock, refusal,
│                                     path forms, shell detection core, owner-only dir, node-pty half, signal escalation)
├── platform-linux/              re-exports the moved code under its old names; behaviour unchanged
├── platform/src/index.ts        MACOS set; selectPlatform('darwin'); refusal kept for any other platform
├── core/src/platform/host-traits.ts   macosHostTraits; PathTraits gains caseSensitiveRoots + unicodeForm; primaryModifier
├── core/src/fs/path-id.ts       reads the two new traits; Windows and Linux values leave results unchanged
├── core/src/config/keybindings.ts     MACOS_BINDINGS derived Ctrl→Cmd + MACOS_BINDING_OVERRIDES; KeyEvent.meta
├── core/src/abstractions/       ICommandLineInstall (new); IUserDirectories.logDir (optional, defaulted)
├── core/src/config/release-artifacts.ts  platform 'darwin', roles 'dmg' and 'macarchive', MACOS_PACKAGE_STEPS
├── core/src/config/settings-metadata.ts  terminals.macOptionIsMeta (onlyOn macos)
├── daemon/src/                  composition root os typing; reap-orphans adopter rule via the seam
└── ui/src/
    ├── main/{main.ts,app-menu.ts,window-chrome.ts,mac-lifecycle.ts,command-line-install-ipc.ts,installed-copy.ts}
    ├── preload/preload.cts      exposes full host traits, not only osName
    └── renderer/{configure-host.ts,title-bar/*,config/chord-key.ts,terminal/use-terminal.ts,editor/*}
packaging/macos/{after-sign.cjs,throng-cli.sh,entitlements.plist?}   NEW (R23; entitlements only if R23's probe needs one)
scripts/
├── ci-macos-setup.sh            NEW  fish, fonts, display check
├── verify-macos-package.mjs     NEW  063 FR-017 steps for the .dmg and .zip
├── clear-dev-state.mjs, playwright-global-*.mjs, gate.mjs   darwin process listing via ps
├── artifact-set.mjs, stage-runtime.mjs, release-notes.mjs   darwin platform
└── packages/ui/tests/measure/terminal-load.measure.ts       THRONG_MEASURE_ASSERT_P95_MS
.github/
├── macos-runners.json           NEW  the one place naming macOS runner labels (FR-037)
├── actions/install-electron/action.yml   ~/Library/Caches/electron
└── workflows/{ci.yml,gate.yml,release.yml}   macOS jobs added; Windows and Linux jobs byte-identical
docs/{install-macos.md,macos.md}  NEW; installation.md, README.md, quick-start.md, CONTRIBUTING.md, architecture.md,
                                  key-bindings.md, preferences.md, testing.md, releasing.md, environment.md updated
.specify/memory/constitution.md   Principle II amendment, 6.6.0
```

**Structure Decision**: extend the 062 pattern. `platform-macos` never imports `platform-linux`; both depend on
`platform-node` for POSIX code, so neither platform package sees the other and selection stays in `@throng/platform`.

## Delivery order

1. **Governance**: Principle II amendment (FR-002), so the rest of the branch is built to the amended rule.
2. **Foundation**: `platform-node/posix` move (Linux green at each commit), `platform-macos` skeleton, `MACOS` set,
   macOS host traits, data and log folders, IPC directory, vitest three-way platform filter and guards.
3. **Process facts**: libproc/sysctl proc table, then PTY host, cwd, identity, orphans, metrics (#551).
4. **Files**: path identity (case roots, NFC), trash and restore, clipboard codec, attributes, access info, volumes,
   privacy notice.
5. **App lifecycle**: chrome, menu, Dock close, quit flow, open-file, translocation refusal, root refusal, Install command.
6. **Keyboard**: KeyEvent meta, Cmd defaults and overrides, resolver change, editor and link modifiers, Option-as-Meta.
7. **Packaging**: electron-builder `mac`, per-platform native filters, ad-hoc signing and verify, artifact set roles.
8. **CI and release**: runner file, macOS CI and gate jobs, typing-latency assertion, release build, verify, publish.
9. **Docs**, known differences, README badge, release body.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| A fourth platform package (`platform-macos`) | Principle II keeps each OS's code behind its own implementation set | Folding macOS into `platform-linux` as "posix" makes Linux code change for macOS reasons and breaks FR-039's byte-identical guarantee for Linux tests. |
| FFI (koffi) for macOS process facts in daemon and collector | `ps`/`lsof` per sample cost a process spawn each and break 055's collector budget; `/proc` does not exist | A native addon needs a compiler and signing per build; koffi is already a shipped dependency. |
| FR-048's website clause is met later | The website does not exist yet: 064 deferred it to [#554](https://github.com/Bidthedog/throng/issues/554), which stays open | Building a website here widens the branch into #554's scope; the release body (T059) carries the download now, and #554 records the requirement |
| `osascript -l JavaScript` for the font list | `NSFontManager` has no C API; the Trash call, first JXA too, moved in process through the Objective-C runtime (R6) | A compiled helper adds a build step and a second signed binary per release for two calls. |
