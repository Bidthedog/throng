# Research: Defect Sweep — Icon Packs, Header Tooltips & a Flaky Pane Test

**Feature**: 017 | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

Every claim below was verified against the tree, not taken from the issue text. Line references are
to the state of the branch at `de85a9e`.

---

## 1. The icon defect (#54) — what is actually broken

### Two resolvers, and the app uses the wrong one

```ts
// packages/core/src/config/theme.ts:227
export function resolveIcon(theme: Theme, token: string): string {
  return theme.icons[token] ?? THRONG_THEME.icons[token] ?? '';
}
```

It never reads `theme.iconPack` or `theme.iconOverrides`, and its **return type is `string`** — so it
structurally *cannot* express an image, no matter what the pack contains. All 14 app call sites
go through it and render the result as a bare text child.

The correct resolver already exists, and is already unit-tested:

```ts
// packages/core/src/config/icon-pack.ts:68
export function resolveIconValue(theme, packs, token): IconValue   // override → pack → theme → default
```

It is called from **one** place: `preferences/icon-section.tsx:69`, the Preferences → Icons grid.

**Decision**: `resolveIconValue` is kept as the single authoritative resolver. `resolveIcon` is
**deleted**, not merely bypassed — FR-002 requires the pack-blind path to cease to exist. Every call
site migrates to a new shared component.

**Rationale**: The correct logic already exists and is tested; the defect is purely that nothing calls
it. Writing a third resolver would violate DRY (Principle VIII).

### Why the app *looks* fine today — the coincidence that hid the bug

`shipped-defaults.ts:65` ships the default theme with `iconPack: 'throng'`, and the seeded `throng`
pack's `pack.json` is a **byte-for-byte copy of `THRONG_THEME.icons`**. So the glyphs the pack would
resolve to are identical to the glyphs the pack-blind resolver returns by accident. Pack resolution
has been completely dead code in the app, and nothing looked wrong until someone selected the *other*
pack.

### An `<img>` can never be themed — this is the crux

The bundled pack art is authored `stroke="currentColor"` (`icon-pack-service.ts:93`), which is exactly
right. But `icon-section.tsx:71` renders it as `<img src="file:///…">`. **An SVG inside an `<img>` is
an isolated document**: its `currentColor` resolves against that document's own initial colour —
black — not against the host page. No CSS on the host can reach inside it.

So there are only three ways to give a pack icon the theme's colour:

| Option | Verdict |
|---|---|
| `<img src=file://…>` + CSS `filter` | **Rejected.** Recolouring by filter means computing a hue-rotate/brightness matrix per target colour. Fragile, unreadable, and cannot hit an arbitrary theme colour accurately. |
| CSS `mask-image: url(file://…)` + `background-color: currentColor` | **Rejected, narrowly.** It *works* and avoids inlining, but the browser fetches the file over `file://` on first paint — a disk read on the render path, which FR-006a forbids — and it silently degrades to an invisible element if the mask fails to load. |
| **Inline the SVG markup into the DOM** | **CHOSEN.** `currentColor` then binds to the host page's `color`, which is a theme token. No fetch on the render path. Satisfies FR-004 and FR-006a together. |

**Decision**: pack SVGs are **inlined**. Their markup is read from disk **once** in the main process
and delivered to the renderer as strings.

**Consequence (important)**: this means the renderer injects SVG markup that originates from a file in
the user's config directory. That is an untrusted-input path into the DOM, so the markup **must be
sanitised**. See §2.

### Is inlining SVG a constitutional violation?

The constitution (v3.12.0, Themeable icon controls) says icon colours "MUST NOT be hardcoded CSS or
**inline SVG**". Read in context, that prohibits a *component author* hardcoding an SVG literal in a
`.tsx` file — bypassing the theme. It is the opposite of what we are doing: the markup here comes
*from the theming system* (the pack), and its colour comes *from a theme token*. Inlining is the
mechanism that brings these icons **into** the theme rather than outside it.

**Decision**: not a violation. Recorded in the Constitution Check, and the existing source-text guard
(`preferences-icons.test.ts`) — which forbids `<svg>` literals in component source — is **kept and
must continue to pass**, because it polices exactly the thing that is still forbidden.

### PNG packs

`isImageFilename()` accepts `.png` as well as `.svg`. A raster image cannot take a colour from the
theme.

**Decision**: `.svg` tokens are inlined and themed. `.png` tokens render as an `<img>` and keep their
own colours. The spec's FR-004 ("pack icons take their colour from the active theme") is satisfied for
every icon it is *possible* to satisfy it for; a raster icon is out of the theming system by its own
nature. No bundled pack uses PNG. Documented rather than silently ignored.

### Packs do not reach the renderer, and cannot update live

`ConfigPayload` is `{ settings, theme, keybindings }` (`config-watcher.ts:23`) — **no packs**. The only
way a renderer gets packs today is a one-shot `window.throng.config.listIconPacks()` that
`icon-section.tsx` calls for itself on mount. So even after fixing resolution, an icon-pack change
could not propagate live (FR-005).

**Decision**: add `iconPacks` to the hot-reloaded config payload, so packs arrive by the same channel,
at the same time, as the theme that selects them. A pack change and the theme change that references
it then land in one atomic render — which is also what prevents a flash of mismatched icons.

**Alternatives rejected**: (a) a second, independent packs IPC subscription — two channels racing to
update one visual result, which is how you get a frame where the theme is new and the pack is old;
(b) leaving `listIconPacks` as the only source and re-fetching on theme change — same race, plus an
IPC round-trip on the render path.

---

## 2. Security: inlining untrusted SVG

Pack files live in `%USERPROFILE%\.throng\icon-packs\` — user-writable, and a pack could be
downloaded from anywhere. Injecting their markup into the renderer's DOM without sanitising is a
script-injection path.

**Decision**: sanitise **in the main process, at load time, once** — before the markup ever crosses
IPC. A pure `sanitiseSvg()` function in `@throng/core`:

- Parse-free, allowlist-based: permit only known-safe SVG element names and attributes.
- Strip `<script>`, `<foreignObject>`, and every `on*` event attribute.
- Strip `href`/`xlink:href` values that are not plain fragment references.
- Reject markup whose root element is not `<svg>` — a pack file that is not an SVG is treated as an
  unreadable token (per-token fallback, FR-003).

**Rationale for main-process, load-time**: it is done **once per pack**, not per render (FR-006a); the
renderer then only ever holds already-safe strings; and being a pure string→string function it is
**unit-testable in the node-only test layer** we actually have (see §5), which a DOM-based sanitiser
would not be.

**Alternatives rejected**: sanitising in the renderer (repeats work on every pack change, and puts the
untrusted string in the renderer before it is safe); trusting the input because "it's the user's own
config directory" (a pack is a shareable artifact — the whole point of #55 is that people will pass
them around).

---

## 3. The tooltip defect (#57)

```tsx
// panel-placeholder.tsx:298  — on the header, swallowing the title beneath it
title="Click: Activate · Drag: Move · Double-click: Rename · Right-click: Menu"
// panel-placeholder.tsx:456  — the title itself has NO tooltip
<span className="panel-box__title">{panel.title}</span>
```

Same shape in `tab-group.tsx:93` / `:117`. `.panel-box__title` **is** ellipsized
(`theme.css:658`), so the tooltip is the only way to read a long panel name — and it is occupied.
`.tab-chip__label` is **not** ellipsized; a long tab grows and the strip scrolls.

**Decision**: the header/chip `title` becomes the **title text**; the instruction string is deleted
outright (not moved to a child). The interactions remain discoverable via the right-click menu, which
is where the spec puts them.

**Rationale**: putting the title on the inner `<span>` while leaving the instructions on the parent
would "work" when hovering the text and show instructions when hovering two pixels to its right —
an incoherent tooltip that changes meaning as the pointer moves. One element, one tooltip.

Precedent for both the pattern and its assertion already exists in-repo (`panel-box__cwd` carries its
own content `title`; `editor-basics.e2e.ts:46` asserts `toHaveAttribute('title', …)`).

`data-testid`s do not currently exist on either title element and must be added to make them
assertable.

---

## 4. The flaky test (#66) — and the size of the class

`panes.e2e.ts` manages to contain all three anti-patterns in 103 lines:

1. **`toHaveCount(0)` as the opening assertion** (`:38`) — an absent-element check that a **not yet
   rendered DOM satisfies trivially**. It settles nothing, but reads like it does.
2. **Three raw `win.evaluate(() => document.querySelector(…).getBoundingClientRect())`** (`:19-27`,
   `:72-78`, `:90-98`) — `evaluate` does **not** auto-wait, and there is no null guard, so the read
   either throws or measures an unstyled element.
3. **Three `waitForTimeout(300)`** (`:43`, `:61`, `:71`) standing in for "the animation finished".

This is the same class `#59` closed in the panel-add helpers, which is why FR-013a scopes the fix to
the class rather than the instance.

**The collapse animation is a red herring.** The measured button is `position: absolute; top: 5px;
left: 5px; width: 22px; height: 22px` inside the sidebar (`panes.css:70-94`), so the 180 ms
`grid-template-columns` transition (`theme.css:88`) **cannot move it**. The geometry is constant in
both states. The sleep was never load-bearing; the missing settle was.

**Decision**: introduce three harness helpers and migrate to them.

- `settle(win)` — a single positive assertion that the workspace has rendered, to be the first
  statement of any test that subsequently reads raw state.
- `geom(locator)` — geometry via **`locator.boundingBox()`**, which *auto-waits* for the element to be
  attached and stable. This deletes the entire class of unguarded `querySelector` reads rather than
  patching each one.
- `viewport(win)` — the window's dimensions. **Not optional**: `panes.e2e.ts` measures the *gap* between
  a control and the **window edge** (`window.innerWidth - rect.right`), which a bounding box cannot
  express. Banning the raw read without supplying a legal alternative would leave the next author no
  way to write the test, and they would quietly reintroduce the `querySelector`. A contract that cannot
  be complied with is not a contract.

**Scale of the audit (measured, not estimated)**: `waitForTimeout` appears **106 times across 39
files**; `.evaluate(` **205 times across 78 files**. Not all are defects — an `app.evaluate()` against
the *main* process is legitimate, and a sleep waiting on real PTY output from a spawned shell may have
no condition to poll.

**Decision**: fix (a) every unguarded geometry read, (b) every negative-assertion-as-settle, and (c)
every sleep for which a deterministic condition exists. Sleeps genuinely waiting on external process
output are **kept, annotated with the condition they stand for, and listed in a report** —
FR-013a explicitly requires that what is *not* fixed be visible rather than silent.

### Making a flake fail the run (FR-014)

Playwright **1.61.1** is installed and supports `--fail-on-flaky-tests` (added in 1.44). It is used
nowhere. CI runs `retries: 3`; local runs `retries: 2`. A test that fails twice and passes on the
third attempt is reported "flaky" and the job exits **0** — precisely how #66 survived.

**Decision**: set **`failOnFlakyTests: true` in `playwright.config.ts`**. Retries stay for their
diagnostic value.

**Alternative rejected — `--fail-on-flaky-tests` on the `test:e2e` npm script.** This was the original
decision and it is **wrong**, because the suite has **three** entry points and the script is only one
of them:

| Entry point | Covered by a flag on the script? |
|---|---|
| `npm run test:e2e` (and CI, which calls it) | yes |
| `npm run test:e2e:admin` → `scripts/test-e2e-admin.mjs` shells out to `npx playwright test` directly | **no** |
| a developer typing `npx playwright test <spec>` — which `quickstart.md` itself instructs | **no** |

A script-level flag would leave the elevated `@admin` suite and every ad-hoc run still absorbing flakes
on `retries: 2`. FR-014a requires "no environment in which a flake is tolerated", and a gate with two
holes in it does not deliver that. **Config-level enforcement covers every entry point by
construction** — it is the only version of this claim that is actually true.

**Alternative rejected — `retries: 0`.** It throws away the first-failure trace, and makes a genuinely
transient infrastructure fault indistinguishable from a flake by destroying the evidence that would
tell them apart.

### Quarantine (FR-013b)

With up to 10 baseline failures possibly needing it, "quarantine" must be a mechanism, not a word.

**Decision**: a **`@quarantine` tag excluded via `grepInvert`**, on its **own independent toggle**
(`THRONG_E2E_INCLUDE_QUARANTINE`), with `grepInvert` composed as an array — one flag per concern.

**Do not mirror the `@admin` ternary.** It is tempting (`grepInvert: INCLUDE_ADMIN ? undefined :
/@admin/`) but wrong: `scripts/test-e2e-admin.mjs:28` sets `THRONG_E2E_INCLUDE_ADMIN=1`, so folding
quarantine into that ternary sets `grepInvert` to `undefined` in the **elevated** runner — quarantined
tests would run there and, with the gate armed, redden it.

Enumeration is therefore `THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine
--list`. A bare `--grep @quarantine` lists **nothing**, because a CLI `--grep` does not clear a config
`grepInvert` — a trap worth stating, since a quarantine you cannot enumerate is precisely the
invisible coverage loss FR-013b forbids.

**Alternatives rejected**: deleting the test (coverage vanishes with no record); `test.skip` /
`test.fixme` (the loss is scattered through the source, so nobody can answer "what are we not testing?"
without reading every spec). A retry hides a defect; a skip hides a gap; a tag admits one.

---

## 5. Test layers — a hard constraint on how this can be tested

**There is no component/DOM test layer.** `jsdom`, `happy-dom`, `@testing-library/*`,
`@vitest/browser` and `react-test-renderer` are absent from every `package.json` in the repo. All
three vitest projects (`unit`, `integration`, `contract`) run `environment: 'node'`.

**Consequence**: React rendering behaviour — a `title` attribute, an inline `<svg>` versus a glyph —
**cannot** be asserted in a unit test. It must be asserted in **E2E**.

**Decision**: three test strategies, chosen per requirement:

| What | Layer | Why |
|---|---|---|
| Icon resolution precedence, SVG sanitisation, pack parsing | **unit** (node) | Pure functions in `@throng/core`. Fast, exhaustive. |
| "No renderer file bypasses the shared icon component" | **unit source-guard** | Precedent: `preferences-icons.test.ts` reads `.tsx` files off disk and asserts on their text. Crucially it **scans a whole directory** rather than a hand-listed few — a guard shaped like the requirement, not like the change. |
| Icons actually change in the app; tooltips show titles; panes don't flake | **E2E** | The only layer that can see the DOM. Also mandated by the constitution: every user-facing UI change ships E2E coverage. |

**Do not plan React component tests.** They would be tasks that cannot be executed.

The source-guard is the highest-value test in the feature: it is what catches a *fourteenth* call site
that nobody remembered, and it is what stops `resolveIcon` creeping back.

---

## 6. Pre-existing failures (not caused by this feature)

Recorded here so a later reader does not attribute them to 017.

- **`terminal-reattach.integration.test.ts:91`** — "closeIdle closes an idle shell but keeps a busy
  one" fails under a full parallel run and **passes in isolation**. A race between marking a shell busy
  and asserting it. Plus a Windows `EPERM` on temp-dir teardown. This is an **integration** test and so
  sits outside FR-013a's end-to-end scope. Tracked in Complexity Tracking; an issue could not be filed
  automatically (external-write permission denied) and is flagged for the user.
