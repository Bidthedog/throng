# Implementation Plan: Preferences grouping and ranked search

**Branch**: `feature/S079-I270-I319-preferences-grouping-and-search` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/079-preferences-grouping-and-search/spec.md`

## Summary

There are two changes, both inside the Preferences window's existing machinery:

1. **Ranked AND search (#270).** `settings-search.ts` switches its token rule from `some` to `every`. It
   also gains a pure ranking step, which scores each match by field tier, then exactness, then registry
   index. `filterFields` returns matches in **display order**: sorted by section rank, then subgroup
   rank, then subsection rank (alphabetical on ties), then field rank. The tabs' existing
   first-appearance grouping (`groupDescriptors`) therefore renders the ranked order with no change to
   the grouping helper. One Settings-tab call site that re-filters by registry order (067 FR-130's
   form-history row) moves onto the ranked list.
2. **One theme grouping convention (#319).** `theme-metadata.ts` stops encoding nesting as
   `"<Area> · <Sub>"` group strings and sets `subgroup` / `subsection` on the descriptor instead. The
   buttons nest as `General → Buttons → Confirm | Cancel | Destroy`. The sort that orders the registry
   keys on the heading path, so token rows keep today's order. The area guard reads `group` directly.

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 24, Electron renderer (React 19)

**Primary Dependencies**: none new

**Storage**: none. Fold state in `localStorage` is keyed by heading names; renamed headings fall back
to defaults under 056 FR-011a (no migration).

**Testing**: Vitest, with the `unit` project for `@throng/core` and the `component` project for the
tabs. Component tests are jsdom with Testing Library. One existing E2E assertion, a test id in
`preferences-row-actions.e2e.ts`, is updated.

**Target Platform**: Windows, Linux and macOS (no platform-specific code)

**Project Type**: desktop app (npm-workspaces monorepo)

**Performance Goals**: ranking a few hundred fields per debounced query stays well under one frame.
It is linear in fields × tokens, plus one sort.

**Constraints**: the search module stays pure (zero OS/DOM). No key, default or shipped-defaults change,
so `SHIPPED_DEFAULTS_VERSION` stays where it is.

**Scale/Scope**: three tabs; about 400 theme tokens, about 250 settings and about 150 key bindings.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Verdict |
|---|---|
| V Test-first | ✅ Each FR gets a failing unit test (core) or component test (tab rendering) before its code. The ranking ladder is unit-tested against the #270 worked examples. |
| VI Simple, discoverable UX | ✅ The best match comes first, and headings the user reads are searchable (040 FR-036's invariant kept, FR-010). |
| VIII SOLID/DRY/YAGNI | ✅ Ranking lives once, in the shared module (FR-012). `groupDescriptors` is unchanged, because it already honours first-appearance order. No options parameter is added to it. |
| IX DI & composition root | ✅ Pure functions only; nothing to wire. |
| X Externalised configuration | ✅ No setting, token or default changes (FR-017). |
| Configuration-editor completeness | ✅ Every token stays exposed. Only its heading changes. The completeness tests keep passing unchanged. |
| XII Responsive UI | ✅ Ranking runs in the existing debounced memo. The cost is linear and small (Performance Goals). |
| Documentation currency | ✅ `docs/preferences.md` line 18 ("matches any word") is updated in the same change. |
| Supersession | ✅ 007 FR-049, 021 FR-028 and 040 FR-037a/b are superseded in the spec (FR-020–FR-022), with notes added to those artifacts. |
| Incremental delivery | ✅ Closes #270 and #319 in full; nothing deferred. |

No violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/079-preferences-grouping-and-search/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── search-ranking.md
│   └── theme-grouping.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/config/
├── settings-search.ts         # AND matching, rankField(), display-order filterFields(), module header
└── theme-metadata.ts          # placementForToken() → {group, subgroup?, subsection?}; sort on the path;
                               # areaForToken() returns the area only; guard reads group; comments
packages/core/src/index.ts     # export rankField / SearchRank / orderRanked if the surface grows
packages/ui/src/renderer/preferences/
├── settings-tab.tsx           # 067 FR-130 form-history row merged into the ranked list, not registry order
└── themes-tab.tsx             # comment at :715 (sibling-string note) only
packages/core/tests/unit/
├── settings-search.test.ts    # OR cases invert; ladder, tiers, group ordering, SC-003 subset property
├── theme-metadata.test.ts     # sibling-string assertions → heading fields; row order unchanged
└── callout-theme-tokens.test.ts
packages/ui/tests/
├── component/*                # tests naming `settings-group-Editor · Syntax` etc. → subgroup test ids
├── unit/preview-surfaces-name-no-provider.test.ts
└── e2e/preferences-row-actions.e2e.ts   # Syntax heading test id
docs/preferences.md            # search wording
specs/007-…/spec.md, plan.md; specs/021-…/spec.md; specs/040-…/spec.md   # supersession notes
```

**Structure Decision**: Only existing files change. Ranking logic belongs to `@throng/core` (pure), and
the tabs keep consuming `filterFields`.

## Complexity Tracking

None.
