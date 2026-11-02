# Measuring per-file durations, and filtering safely

Read before quoting what a spec file costs, or before any Playwright run with a positional filter.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## Getting the measurement: per-file durations

Measure when a decision needs the number — whether a file is worth sharing an app, or whether it
belongs in the serial tier — and do not write the figure into an instruction afterwards. A duration
in a doc nobody re-measures goes stale silently.

`THRONG_E2E_JSON_OUT` asks Playwright to write its JSON report alongside the usual live log, and
`scripts/e2e-durations.mjs` turns that report into one row per spec file, most expensive first, with
a cumulative share of the total. The CI and release lanes already set the variable. On the
workstation, use it on the single spec you are allowed to run there:

```sh
THRONG_E2E_JSON_OUT=e2e-report.json npx playwright test packages/ui/tests/e2e/<spec>.e2e.ts --workers=1
node scripts/e2e-durations.mjs e2e-report.json
```

`td rank` reads the telemetry `td` records for the vitest projects and Playwright, which is often
enough without a fresh run.

Three things about the numbers, because each has misled someone:

- **Retries are included.** A file that passes on its second attempt cost the suite both attempts.
  Reporting only the winning attempt would make the flakiest files look like the cheapest, which is
  exactly backwards for a number used to decide tier assignment.
- **The share column is cumulative**, so it answers "how few files do I have to fix to matter?"
  directly.
- **It measures test time, not wall-clock.** With several workers the wall-clock is far lower than
  the total.

## Keep the `.e2e.ts` on the filter, or you run the whole suite

**A positional filter that drops the suffix silently selects the ENTIRE suite.**
`npx playwright test editor-status-bar` selects every spec file; `editor-status-bar.e2e.ts`, or the
full path, selects one. The command is accepted and the run starts, so the only symptom is a run
that never ends when it should.

**So always pass the suffix, and prefer the full path.** `--list` settles it in seconds and launches
nothing:

```bash
npx playwright test <your filter> --list | tail -1     # "Total: N tests in M files"
```

If that line names more than the one file you meant, the filter did not do what you think.
