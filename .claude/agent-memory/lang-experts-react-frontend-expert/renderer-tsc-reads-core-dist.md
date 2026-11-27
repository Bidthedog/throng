---
name: renderer-tsc-reads-core-dist
description: tsc on packages/ui/tsconfig.renderer.json resolves @throng/core from packages/core/dist, so new core exports show as errors until core is rebuilt
metadata:
  type: project
---

`npx tsc --noEmit -p packages/ui/tsconfig.renderer.json` type-checks the renderer against `packages/core/dist`, not core's
source (vitest resolves source). A field or export just added in `packages/core/src` reads as "does not exist" there
until core is rebuilt, and rebuilding writes `dist`, which a running worktree app and other sessions share.

**Why:** seen in spec 081 (US6): `LinkMenuItem.openIn` and `nonBlankSyncLine` both errored in the renderer pass while
`tsc --noEmit -p packages/core` was clean.

**How to apply:** after a core change, filter renderer tsc errors that name brand-new core symbols as stale-dist noise,
type-check core on its own, and name the rebuild + renderer typecheck as a heavy run for whoever owns the gate.
Related: [[renderer-test-typecheck-gap]].
