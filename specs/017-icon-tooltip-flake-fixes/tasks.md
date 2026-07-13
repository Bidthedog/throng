# Tasks: Defect Sweep — Icon Packs, Header Tooltips & a Flaky Pane Test

**Feature**: 017 | **Branch**: `017-icon-tooltip-flake-fixes` | **Date**: 2026-07-12

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md) · [research.md](./research.md) ·
[data-model.md](./data-model.md) · [contracts/](./contracts/) · [quickstart.md](./quickstart.md)

---

## Test strategy (read before writing any test)

This repo has **no jsdom / component test layer** — `jsdom`, `happy-dom`, `@testing-library/*` and
`@vitest/browser` are absent from every `package.json`, and all three vitest projects run
`environment: 'node'`. **A React component's rendered output cannot be asserted in a unit test here.**

| What is being proven | Layer |
|---|---|
| Icon precedence, SVG sanitisation, asset resolution | **unit** (node) — pure functions in `@throng/core` |
| "No call site bypasses the shared icon component" | **unit source-guard** — reads `.tsx` off disk, scans the **whole directory**, never a hand-listed set |
| Icons change in the app; tooltips show titles; panes don't flake | **E2E** — the only layer with a DOM, and mandated by the constitution for every user-facing UI change |

Test-first is non-negotiable (Principle V). Every **RED** task MUST be run and observed failing *for
the right reason* before its **GREEN** task begins.

## The baseline changed the shape of this work

A retries-disabled baseline run found **10 tests failing on their first attempt** — all currently
laundered green by `retries: 2`. The flake population is at least **eleven**, not one. The gate
(FR-014) therefore **cannot be armed until they are dealt with**, or the suite goes red on arrival.
Phase 1 is ordered accordingly.

## Implementation order ≠ priority order

US3 is P3 by *user value* but is built **first**: US1 and US2 must ship E2E coverage, and that
coverage would otherwise land in a suite that hides its own failures.

---

## Phase 1: Foundational — make the instrument honest (BLOCKING)

- [x] T001 [P] Add `settle(win: Page)`, `geom(locator: Locator)` **and `viewport(win: Page)`** to `packages/ui/tests/e2e/harness.ts` per `contracts/e2e-harness.md` §2. `viewport()` is **not optional**: T007 cannot be written without it, because `panes.e2e.ts` measures the gap between a button and the **window edge**, which a bounding box alone cannot express — banning the raw read without supplying a legal alternative would just push someone back to `querySelector`. `settle` asserts the window's **root** is visible (a **positive** settle). It MUST take the root selector (or a window kind) rather than hardcode `.throng-shell`: that root exists only in the main and sub-workspace windows, while the **Preferences** window's root is `.prefs-root` (`preferences-app.tsx:160`) and 13 specs drive it. Hardcoding one root would make the helper fail confusingly the first time a Preferences test needs it. `geom` uses `locator.boundingBox()` (auto-waits) and **throws** if the element never appears — it must not return null and let a `NaN` comparison silently pass.
- [x] T002 Triage the **10 first-run failures** found at baseline (`context-menu:105`, `destroy-cascade:83`, `performance:72`, `persistence-restore:87`, `persistence-restore:137`, `phase9:107`, `phase9:136`, `projects:144`, `terminal-altscreen-parity:104`, `terminal-slow-start:20`). For each: reproduce with `THRONG_E2E_RETRIES=0`, find the root cause, and **fix it** if it is the race class (unguarded read, vacuous settle, sleep-instead-of-condition). Do **not** adjust an assertion to match observed behaviour without establishing which of the test or the code is wrong.
- [x] T003 Any first-run failure that is **not** fixable as a race — a genuinely load-sensitive budget, an external-process timing assumption — MUST be **quarantined by an enumerable mechanism**: tag it `@quarantine`, exclude it via `grepInvert`, and give it a written justification in the audit report (T012). **Not** `test.skip`/`test.fixme` — a skip scatters the loss through the source, so nobody can answer "what are we not testing?" without reading every spec. See `contracts/e2e-harness.md` §4a and FR-013b. Quarantining is the **last** resort, after a genuine attempt to fix.
- [x] T003a **Quarantine needs its own independent toggle — do NOT fold it into the `@admin` ternary.** `playwright.config.ts:58` is currently `grepInvert: process.env.THRONG_E2E_INCLUDE_ADMIN ? undefined : /@admin/`, and `scripts/test-e2e-admin.mjs:28` sets `THRONG_E2E_INCLUDE_ADMIN=1`. Folding `@quarantine` into that ternary would set `grepInvert` to `undefined` in the elevated runner, so **quarantined tests would run there** — and with the gate armed (T005) they would redden the elevated suite. Compose an **array** instead, one flag each:
  ```ts
  const excluded: RegExp[] = [];
  if (!process.env.THRONG_E2E_INCLUDE_ADMIN)      excluded.push(/@admin/);
  if (!process.env.THRONG_E2E_INCLUDE_QUARANTINE) excluded.push(/@quarantine/);
  // grepInvert: excluded.length ? excluded : undefined
  ```
  The enumeration command FR-013b and SC-008 depend on is therefore **`THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list`** — a bare `--grep @quarantine` returns **zero tests**, because a CLI `--grep` does not clear a config `grepInvert`. A quarantine you cannot list is exactly the invisible coverage loss FR-013b exists to prevent.
- [x] T004 Resolve CI's dependency on retries: `.github/workflows/ci.yml:154-157` states "the elevated de-elevation path is **absorbed by retries**" — a code path whose CI coverage *relies* on a retry converting failure into a pass. **The correct disposition is almost certainly an environment guard, not a quarantine** (FR-013c): this is a *privilege-dependent* test, and the constitution (v3.7.0) **requires** such tests to be elevation-gated — the repo already ships `skipIfElevated()` (`packages/ui/tests/e2e/admin.ts:52`) for exactly this. Gate it so it runs where it can actually pass (the dedicated elevated runner) rather than being retried into a pass where it cannot. Quarantine only if it flakes *within* its own runner. Record the decision in T012's report. **Blocks T005.**
- [x] T004a **`THRONG_E2E_RETRIES` does not survive the elevation hop — fix that first, or T005a lies.** `scripts/test-e2e-admin.mjs` re-launches through `Start-Process -Verb RunAs` (UAC), and an elevated process **does not inherit the caller's environment block** — which is exactly why the script already has to re-set `$env:THRONG_E2E_INCLUDE_ADMIN='1'` *inside* its encoded script (`:28`). So `THRONG_E2E_RETRIES=0 npm run test:e2e:admin` runs at the config default `retries: 2`, and T005a's "observe zero first-attempt failures" would pass **vacuously** — a green bar bought by a retry, which is the precise laundering FR-014 exists to abolish. Forward `THRONG_E2E_RETRIES` (and `THRONG_E2E_INCLUDE_QUARANTINE`) into the encoded elevated script. Also note `:20` defaults the target to the single spec `terminal-admin-integrity.e2e.ts` — name the target T005a is to run, so "the elevated entry point" means a suite and not one file.
- [x] T003b **Prove the quarantine mechanism works** — do not merely configure it. Pass 4 found that the obvious implementation *silently defeats itself*, so the mechanism earns the same treatment as the gate (T006). Tag one throwaway test `@quarantine`, then observe all three properties:
  1. `npx playwright test --list` **omits** it (excluded from the default run);
  2. `THRONG_E2E_INCLUDE_ADMIN=1 npx playwright test --list` **also omits** it — it must not leak into the elevated runner, which is the exact bug the single-ternary approach would have caused;
  3. `THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list` **names** it.
  Property 3 *is* FR-013b — "answerable with a command". Untested, it is a claim, not a mechanism. Remove the throwaway test afterwards (Principle V).
- [x] T005 Arm the gate: set **`failOnFlakyTests: true` in `playwright.config.ts`** — **not** a `--fail-on-flaky-tests` flag on the npm script. The suite has **three** entry points: `npm run test:e2e` (and CI), `npm run test:e2e:admin` (which shells out to `npx playwright test` directly, never touching the script), and a developer typing `npx playwright test <spec>` (which `quickstart.md` itself instructs). A flag on the script covers only the first, leaving the elevated `@admin` suite and every ad-hoc run still absorbing flakes — and FR-014a says *no environment in which a flake is tolerated*. Config-level enforcement covers every entry point by construction (FR-014, FR-014a). **Must come after T002–T004** or the suite is red on arrival.
- [x] T005a **Prove the suite is clean before arming the gate**: re-run the **full** E2E suite with `THRONG_E2E_RETRIES=0` and observe **zero** first-attempt failures (excluding `@quarantine`). Do this *before* setting `failOnFlakyTests: true`. Without it, an **eleventh** undiscovered flake would first surface at T037 — tangled up with the US1/US2 changes, where a red run is ambiguous between "a regression I just introduced" and "a flake I never found". The baseline found ten; assuming T002/T003 caught every one of them is exactly the assumption this feature exists to distrust. **Also run the elevated entry point**: `THRONG_E2E_RETRIES=0 npm run test:e2e:admin`. Config-level `failOnFlakyTests` arms *that* runner too — which is the entire stated reason for putting the gate in the config — so leaving it unmeasured would arm a gate over a suite nobody has checked. If elevation is unavailable, record that as an explicit **stated gap** in `e2e-audit.md` rather than an assumed pass (FR-013a: what is unverified must be visible).
- [x] T006 Prove the gate bites: add a temporary probe spec that fails on its first attempt and passes on retry, run `npm run test:e2e`, confirm the run exits **non-zero** rather than reporting "flaky" and exiting 0 (SC-007). **Delete the probe afterwards** — Principle V forbids leaving generated test artifacts behind.

**Checkpoint**: a green E2E run now means every test passed on its **first** attempt.

---

## Phase 2: User Story 3 — A green test run means the tests actually passed (P3, built FIRST)

**Independent test**: `THRONG_E2E_RETRIES=0 npx playwright test panes.e2e.ts`, 20 consecutive runs, all green.

- [x] T007 [US3] Rewrite `packages/ui/tests/e2e/panes.e2e.ts` onto `settle()`/`geom()`: delete the `toHaveCount(0)`-as-first-assertion at `:38` (a DOM that has not rendered satisfies it), delete the three `waitForTimeout(300)` sleeps at `:43`/`:61`/`:71`, and replace the three unguarded `win.evaluate(() => document.querySelector(…).getBoundingClientRect())` reads at `:19-27`/`:72-78`/`:90-98` with `geom(locator)`. **The right-edge gap needs `geom()` + `viewport()` together**: `buttonGeom` (`panes.e2e.ts:18-27`) computes `window.innerWidth - r.right`, which a bounding box alone cannot express. Take `geom(locator)` **first** — it auto-waits, and so establishes that the layout has settled — then read `viewport(win)`. Without this, an implementer following the task literally hits a wall, and the predicted failure mode is that they quietly reintroduce the `querySelector` (FR-012, FR-013).
- [x] T008 [US3] Verify determinism: run `panes.e2e.ts` **20 consecutive times** with `THRONG_E2E_RETRIES=0`. Any single failure means it is not fixed (SC-004).
- [x] T009 [P] [US3] Audit sweep (a): across **every** file in `packages/ui/tests/e2e/`, replace unguarded DOM geometry reads (`page.evaluate` + `querySelector` + `getBoundingClientRect`) with `geom(locator)`. Leave `app.evaluate(...)` against the **main** process alone — it is not a DOM read (FR-013a(a)).
- [x] T010 [P] [US3] Audit sweep (b): find every test whose **first** assertion is negative (`toHaveCount(0)`, `not.toBeVisible()`) and prepend `settle(win)`, keeping the negative assertion after it (FR-013a(b)).
- [x] T011 [US3] Audit sweep (c): replace `waitForTimeout(n)` with an assertion on the real condition wherever a deterministic one exists. Starting point: **106 occurrences across 39 files**. A sleep genuinely awaiting output from a spawned PTY/shell may have no condition to poll — those are **kept and annotated with the condition they stand for** (FR-013a(c)).
- [x] T012 [US3] Write `specs/017-icon-tooltip-flake-fixes/e2e-audit.md`: every sleep and raw read deliberately left in the suite, every quarantined test (T003) and the CI disposition (T004), each with its justification. FR-013a requires what was *not* fixed to be **visible**, not silent (SC-008).

---

## Phase 3: User Story 1 — An icon pack changes the icons I actually see (P1)

**Independent test**: select `throng-svg`; explorer, panel chrome, tabs, menus and toolbars all change, without restart, legible on both a dark and a light theme.

### Core (pure, node-testable)

- [x] T013 [P] [US1] **RED**: `packages/core/tests/unit/svg-sanitise.test.ts` per `contracts/icon-assets.md` §1 — `<script>`, `<foreignObject>`, `<style>` and every `on*` attribute stripped; a non-`<svg>` root returns `null`; `href`/`xlink:href` that is not a bare `#fragment` stripped; **`stroke="currentColor"` / `fill="currentColor"` SURVIVE** (destroying them defeats FR-004); geometry (`d`, `viewBox`) untouched; idempotent. Run it; confirm it fails because the module does not exist.
- [x] T014 [US1] **GREEN**: implement `packages/core/src/config/svg-sanitise.ts` — pure, allowlist-based, no DOM and no parser dependency. Export from the `@throng/core` barrel.
- [x] T015 [P] [US1] **RED**: extend `packages/core/tests/unit/icon-pack.test.ts` for the `IconAsset` model — a `missing` asset falls back **down the chain** to the theme glyph (FR-003), never a hole; a partial pack yields a fully-populated interface.
- [x] T016 [US1] **GREEN**: add `IconAsset` and asset resolution to `packages/core/src/config/icon-pack.ts`. `resolveIconValue` remains the single authoritative resolver.

### Main process (all disk I/O lives here)

- [x] T017 [US1] **RED**: unit-test that a pack load reads each asset **exactly once** (spy/count the fs reads), that a broken pack yields `error` rather than throwing, and that an unreadable token yields `missing` — the measurable half of SC-009 (FR-006a, FR-004a). Run it; confirm it fails for the right reason before the *behaviour* exists. **Note the service itself already exists** — `packages/ui/src/main/icon-pack-service.ts` (~190 lines) already exports `IconPackInfo { name, assetBase, tokens }` and `listIconPacks()`. T018 **extends** it (add `assets` and `error`; stop exposing `assetBase` to the renderer); it does not create it. Do not write a parallel module. *(Test before implementation — Principle V is NON-NEGOTIABLE, and this task list's own preamble says so.)*
- [x] T018 [US1] **GREEN**: **extend the existing** `packages/ui/src/main/icon-pack-service.ts` (do not replace it) so it loads every pack's assets **once, into memory** — each `.svg` read and passed through `sanitiseSvg` → `{kind:'svg', markup}`; `.png` → `{kind:'raster', dataUri}`; unreadable → `{kind:'missing'}`. Set `IconPackInfo.error` when the **pack** cannot be loaded, and **never throw** — a broken pack degrades, it does not crash the app. Preserve the existing `isSafeAssetFilename` path-traversal confinement. Do **not** expose `assetBase` to the renderer.
- [x] T019 [US1] Add `iconPacks: IconPackInfo[]` to `ConfigPayload` (`config-watcher.ts`) and update `config-write-ipc.ts`, `preload.cts`, `renderer/global.d.ts`. Packs MUST travel on the **same** `throng:config` channel as the theme that selects them, so no frame can pair a new theme with an old pack's icons (FR-005).

### Renderer

- [x] T020 [US1] Carry packs through `renderer/config/config-store.tsx` (`ConfigProvider`); add `useIconPacks()`, mirroring `useActiveTheme()`.
- [x] T021 [P] [US1] **RED**: source-guard asserting `renderer/common/icon.tsx` contains no `useEffect`, no `fetch`, and no `file://` — the structural half of SC-009 and the whole of FR-006b. A component that cannot reach the disk cannot be slow because of it, and cannot pop in after its row. Run it first; it fails because the file does not exist. *(Test before implementation — Principle V.)*
- [x] T022 [US1] **GREEN**: create the single shared `<Icon token=… />` at `renderer/common/icon.tsx` per `contracts/icon-assets.md` §3: resolve via `resolveIconValue`; render a glyph as text, an `svg` asset as **inlined markup** (so `currentColor` binds to the theme — FR-004), a `raster` as `<img>`, and `missing` by falling back down the chain. **`aria-hidden`**, with no `alt`/`title`/`aria-label` of its own (FR-006c). Renders **synchronously** (FR-006b). The existing themeable-icon guard (`preferences-icons.test.ts`, which forbids `<svg>` literals in component source) MUST be observed **still passing** afterwards — it polices the thing that is still forbidden, and this task is the closest the feature comes to that pattern (FR-006).
- [x] T023 [P] [US1] **RED**: source-guard `packages/ui/tests/unit/icon-call-sites.test.ts` — walk **every** `.tsx` under `packages/ui/src/renderer/` (never a hand-listed set) and fail if any file references the banned resolver. **The match MUST be word-bounded**: `resolveIcon` is a **substring of `resolveIconValue`**, which is the resolver `<Icon>` is *required* to call (T022) and which `preferences/icon-section.tsx` already imports. A naive `.toContain('resolveIcon')` — the shape of the existing `preferences-icons.test.ts` precedent — would fail on the very component this feature introduces, making the guard unsatisfiable and T026 uncompletable. Use `/\bresolveIcon\b(?!Value)/` (or equivalent). **This is the highest-value test in the feature**: it catches the call site nobody remembered, and it is what discharges SC-001's claim of 100% coverage (FR-002).
- [x] T024 [US1] Migrate every `resolveIcon` call site (8 modules) to `<Icon>`: `common/icon-button.tsx`, `common/folder-picker.tsx`, `explorer/toolbar.tsx`, `explorer/tree-node.tsx`, `search/find-bar.tsx`, `terminal/terminal-panel.tsx`, `workspace/context-menu.tsx`, `workspace/panel-placeholder.tsx`. Note `find-bar` and `context-menu` currently pass the resolved **string** around — they must render the component instead. Also update the stale `resolveIcon` reference in the `terminal.css:71` comment.
- [x] T025 [US1] Update `packages/core/tests/unit/theme.test.ts` — it **imports and asserts on `resolveIcon`** (`:2`, `:15`), which T026 deletes. Fold its precedence coverage into `icon-pack.test.ts`. **Without this the build breaks**, and the renderer-only guard (T023) would never have caught it.
- [x] T026 [US1] **DELETE** `resolveIcon` from `packages/core/src/config/theme.ts` and the `@throng/core` barrel. FR-002 requires the pack-blind path to cease to exist — leaving it exported is what lets the bug return. T023 must now pass.
- [x] T027 [US1] Rewrite `renderer/preferences/icon-section.tsx` to render previews through the **same** `<Icon>` component instead of its private `<img>` path (the grid rendering icons differently from the app is the root of #54), and show a pack whose `error` is set as **unavailable, with the reason** (FR-004a).

### E2E

- [x] T027a [US1] **Rewrite `icon-packs.e2e.ts:99-107`, do not preserve it.** It currently asserts the Icons grid renders `img.icon-cell__img` with a `src` matching `/throng-svg\/folder\.svg$/` — i.e. it *pins in place* the private `<img>` + `file://` path that T027 exists to delete and that the contract forbids (the renderer no longer receives `assetBase`). After T024/T027 this test **cannot** pass. Rewrite it to assert an **inlined `<svg>`**, moving the 24px sizing assertion onto the inlined element; `.icon-cell__img` (`preferences.css:836`) becomes dead CSS and should go. **Read SC-006 correctly**: it protects *behaviour*, not the tests that assert a removed implementation. An implementer who takes "every existing test continues to pass" literally here would keep the `<img>` and thereby defeat FR-004 — the exact bug this feature exists to fix.
- [x] T028 [US1] Extend `packages/ui/tests/e2e/icon-packs.e2e.ts` to assert packs change the **main window** — explorer tree/toolbar, panel and tab chrome, a menu, a toolbar button — not merely the Preferences grid. **The absence of exactly this assertion is why #54 shipped unnoticed.** Cover: switching pack changes app icons live, without restart (FR-001, FR-005); icons follow the theme after switching to Light (FR-004, SC-002); reverting to the default pack restores the default icons.
- [x] T029 [US1] E2E: icons are **decorative** — icon elements are `aria-hidden`, and an icon button's accessible name still comes from its own title, so a screen reader hears the action once and never the glyph (FR-006c, SC-010).
- [x] T030 [US1] **FR-006d — no icon may be the sole carrier of meaning.** Making icons `aria-hidden` (T022) *creates* this risk, and there is a live instance: `explorer/tree-node.tsx:119` renders a **symlink marker** whose only job is to convey "this is a symlink". Audit information-bearing icons (symlink marker, unsaved dot, panel-type icon, folder-vs-file) and give each an accessible name or text carrier on its row/control. Assert in E2E.
- [x] T031 [US1] E2E: seed a **corrupt/missing** pack (remove its `pack.json`), then assert the app **starts normally**, icons fall back to the theme's glyphs, and the Preferences → Icons picker shows that pack as unavailable **with a reason** — nothing blank, nothing silent (FR-004a, SC-011).

---

## Phase 4: User Story 2 — Hovering a header tells me what I am looking at (P2)

**Independent test**: rename a panel so its title truncates; hover the header; the full title appears.

- [x] T032 [P] [US2] **RED**: `packages/ui/tests/e2e/panel-tooltips.e2e.ts` — the panel header's `title` equals the panel's title; a tab chip's `title` equals the tab's title; the instruction string (`Click: Activate · Drag: Move · …`) appears **nowhere**; a rename updates the tooltip (FR-007, FR-008, FR-009, FR-011). Run it; confirm it fails against current behaviour.
- [x] T033 [US2] **GREEN**: `workspace/panel-placeholder.tsx:298` — replace the instruction `title` on `.panel-box__header` with `title={panel.title}`; add a `data-testid` to the title element. Do **not** merely add a title to the inner span while leaving the instructions on the parent — the tooltip would change meaning as the pointer moved two pixels (research §3).
- [x] T034 [US2] **GREEN**: same in `workspace/tab-group.tsx:93` — `title={tab.title}` on `.tab-chip`, instruction string deleted, `data-testid` added.
- [x] T035 [US2] Confirm the tooltips that already show **content** are untouched: panel-type icon, terminal cwd, editor path chip, unsaved dot, owning project (FR-010). Existing E2E (`editor-basics.e2e.ts:46`, `panel-type-form.e2e.ts:55`) must still pass.

---

## Phase 5: Polish & Cross-Cutting

- [x] T036 **Documentation currency (NON-NEGOTIABLE)** — every doc that this change makes untrue must move *in this change*:
  - `docs/testing.md` §"Flaky-under-load retries" currently teaches the **exact policy FR-014 abolishes** ("Retries absorb those… a genuinely flaky test is reported as `flaky`"). Rewrite it: retries are kept for their **diagnostic** value; **any** flaky result fails the run.
  - `.github/workflows/ci.yml` — the `THRONG_E2E_RETRIES` comment ("allow an extra retry so an occasional load-transient flake still recovers") and the de-elevation comment (T004) say the same thing. Fix both.
  - `playwright.config.ts:61-66` — its own comment teaches the abolished policy ("a genuinely flaky one is surfaced as 'flaky' in the report"). This is the same defect class, surviving in one more file.
  - `CONTRIBUTING.md` — the testing bar changed (a flake now fails the run; new E2E must use `settle()`/`geom()`; quarantine is `@quarantine`, not `skip`).
  - `README.md` / `ROADMAP.md` — icon packs go from decorative-only to working: a user-facing capability change.
- [x] T037 Run the **full** gates, unfiltered, capturing complete output once: `npm run lint` (zero errors — a lint error is a build failure), `npm run typecheck`, `npm test`, `npm run test:e2e`. E2E green now means every test passed on its **first** attempt (SC-005). "Unfiltered" means *not piped through a grep that discards the failure detail* — it does **not** mean the default suite runs `@admin`/`@quarantine`, which are excluded **by design** and are both enumerable by command. **Expect exactly one known failure in `npm test`**: the pre-existing `terminal-reattach.integration.test.ts` flake that SC-005 names as an explicit, tracked exception — recognise it, do **not** re-diagnose it and do **not** chase it into scope. Confirm the existing `preferences-icons.test.ts` themeable-icon guard still passes (FR-006).
- [x] T038 Delete every temporary artifact created during this work (the T006 probe, scratch files). A green bar MUST NOT leave orphaned generated files behind (Principle V).

---

## Dependencies

```
Phase 1 (T001–T006)   the instrument.
        │             T002, T003, T003a, T003b, T004, T004a MUST all precede T005/T005a
        │             (arming the gate) or the suite is red on arrival.
        │
        │             T004a ──► T005a  (NON-NEGOTIABLE ORDER)
        │               THRONG_E2E_RETRIES does not survive the UAC hop. If T005a runs
        │               before T004a forwards it, the elevated check executes at
        │               retries:2 and its "zero first-attempt failures" is a green bar
        │               bought by a retry — the exact laundering FR-014 abolishes.
        ├─► Phase 2 / US3 (T007–T012)
        ├─► Phase 3 / US1 (T013–T031)   ─┐ independent of each other
        └─► Phase 4 / US2 (T032–T035)   ─┘ once Phase 1 lands
                    └─► Phase 5 (T036–T038)
```

**Critical ordering inside US1**: `T025` (fix `theme.test.ts`) and `T024` (migrate call sites) MUST
both precede `T026` (delete `resolveIcon`), or the build breaks. `T023`'s guard is what proves the
migration was *complete* rather than merely plausible.

## Parallel opportunities

- **T009** ‖ **T010** — different anti-patterns (run sequentially if edits collide).
- **T013** ‖ **T015** ‖ **T023** — three independent RED tests in three different files.
- **US1 (Phase 3)** ‖ **US2 (Phase 4)** — fully independent once Phase 1 lands.

## MVP scope

**Phase 1 + Phase 2** is a coherent, shippable increment: it makes the suite honest and fixes a defect
the constitution forbids absorbing. It delivers no user-visible change — which is exactly why it is P3
by value, and exactly why it must be built first.

The smallest increment a *user* would notice is **Phase 3**: the icon-pack setting starts working.

## Phase 6: Convergence

- [ ] T044 [US1] Backfill test coverage for **FR-006d** (an icon may not be the sole carrier of meaning) per FR-006d / T030 (partial). The symlink marker's accessible name is implemented (`explorer/tree-node.tsx` — `role="img" aria-label="Symbolic link"`), but no test asserts it. There is no jsdom/component layer, and creating a real symlink on Windows needs `SeCreateSymbolicLinkPrivilege` (elevation), so the coverage should be an **`@admin`-gated** E2E that seeds a symlinked entry and asserts (a) the marker exposes an accessible name and (b) the `<Icon>` inside it remains `aria-hidden`. Until it lands, this is a tracked deferral, not a silent gap — the behaviour is shipped and correct; only its automated verification is outstanding.
