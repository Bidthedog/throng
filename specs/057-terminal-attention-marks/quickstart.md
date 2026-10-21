# Quickstart: validating attention marks

**Feature**: [spec.md](./spec.md) · **Contracts**: [contracts/](./contracts/)

## Automated

```bash
npx vitest run --project unit packages/core/tests/unit/attention-scan.test.ts packages/core/tests/unit/attention-model.test.ts
npm run test:unit
npm run test:component
npm run test:integration     # daemon emission, ledger, SC-004 throughput
npm run test:contract        # notifier and badge ports, daemon RPCs
```

Run the one E2E spec narrowly, in the serial tier, per the `throng-testing` skill:
`attention-marks.e2e.ts`.

## By hand (dev build)

Use a PowerShell terminal. A delayed bell is `Start-Sleep 5; [Console]::Write([char]7)`. A delayed
notification is ``Start-Sleep 5; Write-Host -NoNewline "`e]9;Tests passed`a"``.

1. **Project row** (US1): two projects open. Run the delayed bell in project A, switch to B. A's row
   shows the Attention mark within a second, and the taskbar badge reads 1. Switch to A and click the
   terminal: the mark and badge clear.
2. **Tab and panel** (US2): split a tab. Run the bell on the right, click into the left. The right
   header and the tab chip mark. Hovering either names the panel and "bell".
3. **Notifications** (US3): run the delayed notification and switch to another application. A
   Windows notification names the project, the panel and "Tests passed". Clicking it brings throng
   forward on that panel, cleared. Repeat with throng focused on another project: a toast appears
   instead, and its link does the same.
4. **No self-marking** (FR-004): ring the bell while typing in the terminal. Nothing marks.
5. **Command finished** (US5): `Start-Sleep 10`, switch tabs. The tab marks within two seconds of
   the end.
6. **Exit** (US6): `Start-Sleep 5; exit 1`, switch projects. The row marks Failed.
7. **Preferences** (US4): switch Bell off, repeat step 1, and nothing marks. Switch terminal
   attention off, and existing marks clear.
8. **Next marked** (US7): mark panels in two projects and press Ctrl+Shift+Alt+G twice. Each press
   lands on one and clears it.
9. **Restore** (FR-038a, FR-066): close throng with a background terminal running
   `Start-Sleep 20; [Console]::Write([char]7)`, wait, reopen. The panel is marked, with no toast and
   no Windows notification.
