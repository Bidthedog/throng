# Contract: E2E Harness & the Flake Gate

**Feature**: 017 | Governs FR-012…FR-015

The rule this encodes, in one line: **a test may not measure the interface before the interface exists.**

---

## 1. The two defects, precisely

### (a) A negative assertion is not a settle point

```ts
// panes.e2e.ts:38 — the FIRST statement of the test
await expect(win.getByTestId('pane-rail-left')).toHaveCount(0);   // "the rail is absent"
const expanded = await buttonGeom(win, 'pane-hide-left', 'left'); // …now measure something
```

`toHaveCount(0)` is satisfied by a DOM **that has not rendered anything at all**. It passes instantly,
proves nothing, and reads to the next author like a wait. The raw read that follows then measures an
element that may not exist (`TypeError`) or is not yet styled (wrong geometry).

**Rule**: the first assertion of a test MUST be **positive** — something that is *present*. Assert
absence only *after* you have proven the page is there.

### (b) A raw read does not auto-wait

```ts
await win.evaluate(() => document.querySelector('…')!.getBoundingClientRect())
```

`evaluate` runs immediately, whatever the state of the page. No retry, no null guard.

**Rule**: geometry comes from a **locator**, which auto-waits and retries.

---

## 2. Harness helpers (NEW — `packages/ui/tests/e2e/harness.ts`)

### `settle(win: Page, root = '.throng-shell'): Promise<void>`

A single positive assertion that the window's root has rendered. MUST be the first statement of any
test that subsequently takes a raw read.

```ts
export async function settle(win: Page, root = '.throng-shell'): Promise<void> {
  await expect(win.locator(root)).toBeVisible();
}
```

**The root MUST be a parameter, not a constant.** `.throng-shell` exists only in the main and
sub-workspace windows; the **Preferences** window's root is `.prefs-root` (`preferences-app.tsx:160`),
and **13 specs drive it**. A hardcoded root would make `settle()` fail — confusingly, and in a helper
whose entire purpose is to stop confusing failures — the first time a Preferences test needed it.

### `geom(locator: Locator): Promise<{x,y,w,h}>`

Geometry via `locator.boundingBox()`, which **auto-waits** for the element to be attached, visible and
stable.

**MUST**
- throw a clear error if the element never appears (rather than returning `null` and letting a
  `NaN` comparison silently pass)
- never be reached through `page.evaluate` + `querySelector`

**This helper is the fix.** It deletes the whole class of unguarded geometry reads rather than
patching each occurrence — which is what FR-013a asks for, and what #59 failed to do.

### `viewport(win: Page): Promise<{ width: number; height: number }>`

**Why this exists.** `panes.e2e.ts` does not measure an element in isolation — it measures the *gap*
between a button and the **window's outer edge**, and it deliberately captures the element rect and
`window.innerWidth` in **one** `evaluate` so both come from a consistent snapshot while the window is
still settling. `geom()` returns only a box; it has nowhere to put the viewport width. Banning the raw
read without supplying this would leave the implementer no legal way to write the test — so the
contract would be unimplementable, and someone would quietly reintroduce the `querySelector`.

**Clarification, so no one has to guess**: `win.evaluate(() => window.innerWidth)` is **not** an
element geometry read. It touches no element, so it cannot race with one rendering, and it is
**permitted**. What is banned is reaching *through* `evaluate` to find an element and measure it —
because that is the read that does not wait.

**Composition**: take `geom(locator)` first (which auto-waits, and so *establishes* that the layout has
settled), then read the viewport. The ordering is what makes the pair consistent — the wait happens
before either value is taken.

---

## 3. The audit (FR-013a)

Scope: the shared harness **and every E2E spec**.

| Pattern | Disposition |
|---|---|
| `win.evaluate(() => document.querySelector(…).getBoundingClientRect())` | **Fix** — replace with `geom(locator)`. |
| A negative assertion (`toHaveCount(0)`, `not.toBeVisible()`) as a test's **first** assertion | **Fix** — prepend `settle(win)`, keep the negative assertion after it. |
| `waitForTimeout(n)` where a deterministic condition exists | **Fix** — replace with the assertion on the condition (`expect(...).toHaveCount(n)`, `toBeVisible()`, `expect.poll`). |
| `waitForTimeout(n)` awaiting real output from a spawned process (PTY/shell) | **Keep, annotate, and report.** There may be no condition to poll. It MUST carry a comment naming the condition it stands for, and appear in the report below. |
| `win.evaluate(() => window.innerWidth)` | **Legitimate.** It touches no element, so it cannot race with one rendering. Prefer the `viewport(win)` helper. Do **not** strip it while sweeping this table — the pane tests need it. |
| `app.evaluate(...)` against the **main** process | **Legitimate.** Not a DOM read; leave alone. |

**Anything left in place MUST appear in a report.** FR-013a: what was *not* fixed must be visible, not
silent. The report lives at `specs/017-icon-tooltip-flake-fixes/e2e-audit.md` and lists every surviving
sleep with its justification.

Measured starting point: **106** `waitForTimeout` across 39 files; **205** `.evaluate(` across 78 files.
These are occurrences, not defects — the triage above decides which are which.

---

## 4. The flake gate (FR-014 / FR-014a)

Playwright **1.61.1** is installed. Currently no gate exists, and CI runs `retries: 3` — so a test that
fails twice and passes on the third attempt is reported "flaky" and the job exits **0**. That is the
mechanism that hid #66.

**The gate MUST live in `playwright.config.ts` (`failOnFlakyTests: true`), NOT in the npm script.**

This matters, and it is not a style preference. There are **three** ways this suite gets run:

| Entry point | Would a `--fail-on-flaky-tests` flag on `test:e2e` cover it? |
|---|---|
| `npm run test:e2e` (and CI, which calls it) | yes |
| `npm run test:e2e:admin` → `scripts/test-e2e-admin.mjs` shells out to `npx playwright test` directly | **NO** — it never touches the npm script |
| a developer typing `npx playwright test <spec>` (which `quickstart.md` itself instructs) | **NO** |

A flag on the script would leave the elevated `@admin` suite — and every ad-hoc run — still absorbing
flakes on `retries: 2`. FR-014a says "local and continuous-integration runs alike… no environment in
which a flake is tolerated", and a gate with two holes in it does not deliver that. **Config-level
enforcement covers every entry point by construction**, which is the only version of this that is
actually true.

**MUST**
- `failOnFlakyTests: true` in `playwright.config.ts`
- retries stay configured, for their **diagnostic** value: the first failure's assertion, diff and
  trace are still captured

## 4a. Quarantine — the mechanism (FR-013b)

Up to **10 baseline failures** may need quarantining. "Quarantine" must therefore stop being a word
and become a mechanism, because the options behave very differently:

| Mechanism | Verdict |
|---|---|
| Delete the test | **No.** Coverage vanishes with no record. |
| `test.skip()` / `test.fixme()` | **No.** Skips are scattered through the source; you cannot answer "what are we not testing?" without reading every spec. |
| **`@quarantine` tag + `grepInvert`, on its OWN toggle** | **CHOSEN.** A quarantined test is **enumerable** — it can be listed and counted by command. |

**MUST**
- a quarantined test is tagged `@quarantine` and excluded via `grepInvert`
- `grepInvert` MUST be composed as an **array with one flag per concern** — **never** by folding
  `@quarantine` into the existing `@admin` ternary:

  ```ts
  const excluded: RegExp[] = [];
  if (!process.env.THRONG_E2E_INCLUDE_ADMIN)      excluded.push(/@admin/);
  if (!process.env.THRONG_E2E_INCLUDE_QUARANTINE) excluded.push(/@quarantine/);
  grepInvert: excluded.length ? excluded : undefined,
  ```

  **Why this matters**: today `grepInvert` is `THRONG_E2E_INCLUDE_ADMIN ? undefined : /@admin/`, and
  `scripts/test-e2e-admin.mjs:28` sets `THRONG_E2E_INCLUDE_ADMIN=1`. Folding quarantine into that
  ternary would make `grepInvert` `undefined` in the **elevated** runner — so quarantined tests would
  run there, and with the gate armed they would redden it. One flag per concern, always.
- the enumeration command is **`THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list`**.
  A bare `--grep @quarantine` returns **zero tests**: a CLI `--grep` does **not** clear a config
  `grepInvert`. A quarantine you cannot list is the invisible coverage loss FR-013b exists to prevent.
- every quarantined test carries a written justification in `e2e-audit.md`
- quarantining is the **last** resort, after a genuine attempt to fix

The point of FR-013b is that lost coverage stays *visible*. A retry hides a defect; a skip hides a
gap; a tag admits one.

### Quarantine is NOT an environment guard (FR-013c)

`skipIfElevated()` and the `@admin` tag are **environment guards**, and they are **legitimate** — the
constitution (v3.7.0) *requires* privilege-dependent tests to be elevation-gated. Do not sweep them up
as "skips".

The difference is where the coverage goes. An environment guard **routes** coverage to a runner that
can honour it — the elevated suite verifies it for real. A quarantine **forfeits** coverage: nothing,
anywhere, is checking that behaviour any more. One preserves the test; the other admits defeat. Only
the second needs counting.

What *is* banned is skipping a test because it **flakes** and calling that an environment problem.

**Accepted cost** (stated in the spec, not discovered later): a genuinely transient infrastructure
fault now fails a run. The remedy is to fix or quarantine the test — never to relax the gate.

**Verification**: a green run means every test passed on its **first** attempt.

---

## 5. Coverage this feature must add

| Requirement | E2E |
|---|---|
| FR-001/004/005 (packs apply app-wide, themed, live) | `icon-packs.e2e.ts` — extended to assert icons **in the main window** (explorer, panel chrome), not only the Preferences grid. The absence of exactly this assertion is why #54 went unnoticed. |
| FR-004a (failed pack surfaced) | seed a corrupt pack; assert the app starts, icons fall back, and the picker shows it unavailable **with a reason**. |
| FR-007/008/009 (tooltips) | `panel-tooltips.e2e.ts` — assert `title` equals the panel/tab title, and that the instruction string is **gone**. |
| FR-012 (the flake) | `panes.e2e.ts` passes with `THRONG_E2E_RETRIES=0`, repeatedly. |
