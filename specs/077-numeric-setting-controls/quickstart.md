# Quickstart: validating 077

Automated (run from the worktree):

- `td run --runner unit --scope file --target packages/core/tests/unit/slider-descriptors.test.ts` — every numeric
  setting: default on a stop, maximum reachable, unit and hard bounds declared (SC-001).
- `td run --runner unit --scope file --target packages/core/tests/unit/numeric-units.test.ts` — display, messages,
  clamp (contract [numeric-control.md](contracts/numeric-control.md)).
- `td run --runner integration --scope file --target <settings-upgrade-v37 test>` — upgrade and re-run (SC-006).
- `td run --runner component --scope file --target packages/ui/tests/component/number-control.test.ts` — slider, box,
  greyed state, inline message.

By hand (manual test plan groups, written at implementation):

1. Preferences → Editor → **Maximum file size**: drag the slider; type `12,345,678` in the box; the slider greys,
   `settings.json` holds `12345678`.
2. Type `999,999,999,999` in the same box: the message names the maximum while typing; Enter stores the maximum.
3. Start on a config root with `terminals.attention.quietSeconds: 30`: Preferences shows 30 s; the file holds
   `quietMs: 30000`.
4. Open an image over its limit: the notice names the limit in MB with its bytes.
5. Print dialog: type a scale above its maximum: the message shows; confirming clamps.
