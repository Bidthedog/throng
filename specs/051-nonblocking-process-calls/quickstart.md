# Quickstart: seeing 051 work

## Automated

- `npx vitest run --project unit packages/core/tests/unit/conhost-assignment.test.ts packages/core/tests/unit/escalation-targets.test.ts packages/daemon/tests/unit/terminal-end-outcomes.test.ts packages/daemon/tests/unit/blocking-process-ban.test.ts`
- `npx vitest run --project integration packages/daemon/tests/integration/unload-then-switch.integration.test.ts` — #468 (FR-022): fails on `master`, passes here.
- `npx vitest run --project integration packages/daemon/tests/integration/terminal-responsiveness.integration.test.ts` — FR-021.
- `npm run lint` — fails if a synchronous process call is added to `packages/daemon/src` or `packages/platform-windows/src` (SC-006).
- Process hygiene: `terminal-no-orphans.e2e.ts` (CI) stays green.

## By hand (dev build)

1. Open projects A and B. In A, open four terminals, each running `ping -t localhost`.
2. With A active, choose **Unload Project and End Terminals**, then click B at once. B opens with no error (SC-001).
3. In B, run `for /l %i in (1,0,2) do @echo %time%` in one terminal; in another project open five terminals, then
   unload it with End Terminals. The printing terminal never pauses visibly (SC-002).
4. Close throng with ten terminals open, choose **Terminate all**. Task Manager shows no `cmd.exe`, `pwsh.exe`,
   `bash.exe` or `conhost.exe` left from those terminals (SC-004).
