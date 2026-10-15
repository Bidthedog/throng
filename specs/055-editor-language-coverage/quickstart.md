# Quickstart: validating spec 055

## Automated

From the repository root:

```bash
npx vitest run --project unit packages/core/tests/unit/languages.test.ts \
  packages/core/tests/unit/language-detect.test.ts packages/core/tests/unit/language-precedence.test.ts \
  packages/ui/tests/unit/language-loaders.test.ts
npx vitest run --project unit packages/ui/tests/unit/grammars
npm run typecheck && npm run lint
```

Expected: the registry holds 55 descriptors with no overlapping extensions or filenames; every row of
[the detection contract](contracts/language-detection.md) resolves as listed; every loader key matches a
registry id; the Batch, Dotenv and Ignore file tokenizers produce the tags their fixtures expect, each of
them styled.

## By hand (the app)

1. `npm run build`, then start throng and open a project.
2. Create `tsconfig.json` with a `// comment` line, `.env` with `export KEY="v" # note`, `Dockerfile`
   with `FROM node:24`, `build.cmd` with `@echo off` and `REM x`, and `change.patch` with `+added` and
   `-removed` lines. Open each.
3. Each shows highlighting, and the status bar names *JSON with Comments*, *Dotenv*, *Dockerfile*,
   *Batch* and *Diff*. The `tsconfig.json` comment has no error marker.
4. Open the language picker: the 24 new languages are listed.
5. Switch theme: the new files repaint and stay readable.
