# Quarantine

Read before tagging a test `@quarantine`, or when asked what the suite is not testing.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## Quarantine

A test that genuinely cannot be made deterministic is tagged **`@quarantine`** and excluded from the
default run. It is **not** deleted and **not** `test.skip`-ped, because lost coverage must stay
*visible* — you have to be able to answer "what are we not testing?" with a command:

```bash
THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list
```

(A bare `--grep @quarantine` lists nothing: a CLI `--grep` does not clear a config `grepInvert`.)

Every quarantined test carries a written justification in
`specs/017-icon-tooltip-flake-fixes/e2e-audit.md`.

**A quarantine is not an environment guard.** `@admin` / `skipIfElevated()` skip a test because the
environment *cannot run it*, and its coverage lives elsewhere — a dedicated elevated runner verifies
it for real. Quarantine means the coverage lives **nowhere**. One routes coverage; the other admits
defeat. Only the second needs counting.
