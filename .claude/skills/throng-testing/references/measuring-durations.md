# Measuring per-file durations, and filtering safely

Read before quoting what a spec file costs, redrawing the tier boundary, or starting any long Playwright run with a positional filter.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## Getting the measurement: per-file durations

Every claim on this page about what a spec file costs comes from one command, and it is the same
command whether you are re-drawing the tier boundary, deciding whether a file is worth sharing an
app, or checking that a published figure is still true:

```sh
THRONG_E2E_JSON_OUT=e2e-report.json npm run test:e2e
node scripts/e2e-durations.mjs e2e-report.json
```

The first line is the run you were doing anyway — `THRONG_E2E_JSON_OUT` only asks Playwright to
write its JSON report alongside the usual live log, so the measurement costs nothing extra. The
second prints one row per spec file, most expensive first, with a running share of the total. The
shape, with the numbers left out deliberately — they are whatever your run measured, and quoting
someone else's here is how the figures on this page drifted to half the truth in the first place:

```
<n> spec files, <n> tests, <n> retried
<n> minutes of test time (retries included)

    mins   tests  share  file
    ....       ..    ..%  packages/ui/tests/e2e/<the dearest file>.e2e.ts
    ....       ..    ..%  packages/ui/tests/e2e/<the next one>.e2e.ts
    …
```

Three things about the numbers, because each has misled someone:

- **Retries are included.** A file that passes on its second attempt cost the suite both attempts.
  Reporting only the winning attempt would make the flakiest files look like the cheapest, which is
  exactly backwards for a number used to decide tier assignment.
- **The share column is cumulative**, so it answers "how few files do I have to fix to matter?"
  directly. In this suite the answer has consistently been "about fifteen".
- **It measures test time, not wall-clock.** At six workers the wall-clock is far lower than the
  total; the two tiers run at different worker counts, so only a whole-run stopwatch gives the
  figure quoted in [tiers-and-workers.md](tiers-and-workers.md).

It works on a partial run too — `npx playwright test some-spec.e2e.ts` with the same env var — which
is the cheap way to check whether one file got faster without paying for the suite.

## Keep the `.e2e.ts` on the filter, or you run all 207 files

**A positional filter that drops the suffix silently selects the ENTIRE suite.** Measured on
2026-08-26 with `--list`, so nothing had to be run to find it:

| Command | Selects |
|---|---|
| `npx playwright test editor-status-bar` | **573 tests in 207 files** — the whole suite |
| `npx playwright test editor-status-bar.e2e.ts` | 2 tests in 1 file |
| `npx playwright test packages/ui/tests/e2e/editor-status-bar.e2e.ts` | 2 tests in 1 file |

The failure is quiet in the worst way: the command is accepted, the run starts, and the only symptom
is that it takes eighteen minutes instead of twenty seconds. It cost a full 25.8-minute run in the
session that found it — a run whose *result* was meaningless, because it was answering a question
nobody had asked.

**So always pass the suffix, and prefer the full path.** `--list` settles it in seconds and launches
nothing, which makes it the cheap habit worth having before any long run:

```bash
npx playwright test <your filter> --list | tail -1     # "Total: N tests in M files"
```

If that line says 207 files, the filter did not do what you think.
