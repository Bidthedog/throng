# Temp files

Read when a run leaves a `throng_e2e_<runhash>` folder behind, or when adding scratch directories to a test.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## Temp files

Every test scratches to `os.tmpdir()`. For a run, all of that is consolidated
under a single folder:

```
%TEMP%/throng_e2e_<runhash>/
   throng-e2e-XXXXXX/     (one per app launch)
   throng-ud-XXXXXX/      (per-launch Electron user-data)
   throng-cfg-XXXXXX/     (per-launch config root)
   throng-<layer>-XXXXXX/ (integration/contract scratch)
   ...
```

`scripts/run-tests.mjs` generates one `<runhash>` at the start of `npm run test`
and points `TEMP`/`TMP`/`TMPDIR` at the folder, so **all four layers and all
their workers** land in the *same* parent. Running a single layer directly (e.g.
`npm run test:e2e`) falls back to a per-invocation folder via the runner's
globalSetup, so the one-parent invariant always holds.

**Lifecycle.** Per-test cleanup is unchanged — the E2E harness / helpers still
remove each sub-dir as its test finishes (Constitution Principle V). When the run
finishes normally and the folder is empty, the owner removes the parent too, so a
clean run leaves nothing behind. If a test **crashes or hangs** before its own
cleanup runs, the owner's teardown is skipped (or finds the folder non-empty) and
the parent is **kept**, with its path printed — so you can inspect exactly what
the failing run left behind.
