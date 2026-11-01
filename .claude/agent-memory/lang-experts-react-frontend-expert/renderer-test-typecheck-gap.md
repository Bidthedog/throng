---
name: renderer-test-typecheck-gap
description: packages/ui tests are covered by NO tsconfig — tsc -b and typecheck:renderer never see them; type errors in tests are silent
metadata:
  type: project
---

`packages/ui/tsconfig.json` includes only `src/main` + `src/preload`; `packages/ui/tsconfig.renderer.json`
includes only `src/renderer`. Nothing typechecks `packages/ui/tests/**` (component, unit, e2e), and vitest
strips types without checking them.

**Why:** a test can call a function with the wrong shape (or cast `as unknown as X`) and stay green; the
gate's typecheck stage will not catch it.

**How to apply:** when a test leans on a type (bridge payloads, `toHaveBeenCalledWith` argument shapes),
check the shape against the source type by hand or with the LSP; do not read a green `npm run typecheck`
as covering tests. Renderer check: `npx tsc -p packages/ui/tsconfig.renderer.json`. Component tests:
`npx vitest run --project component <path-substring> --maxWorkers=2`.
