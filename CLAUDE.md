<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/030-failure-presentation/plan.md
<!-- SPECKIT END -->

## Specialist agents

`.claude/agents/` holds eleven repo-local subagents, one per area of this codebase — core/DI, daemon
and persistence, terminals and PTY, renderer, editor, config and preferences, explorer and file ops,
failure presentation, E2E harness, spec governance, build and release. Each carries that area's file
map, the constitutional rules that bind it, and the traps it has already produced. Delegate to the
owning agent rather than re-deriving an area from scratch; see `.claude/agents/README.md` for the
routing table and how they defer to skills.

## E2E on CI

**Run it locally before you push it.** The full E2E suite takes about 10 minutes locally
(`npx playwright test`) against roughly 12 minutes per shard on CI, three shards in parallel. Pushing
to find out whether something works spends other people's runner minutes to learn what one local
command would have told you — and CI is slower to answer, not faster.

There is exactly one thing local runs cannot tell you, and it is worth knowing precisely: **a
developer machine is normally NOT elevated, and GitHub's runners always are.** So anything whose
behaviour depends on administrator rights — the `skipIfElevated()` specs, the `@admin` suite, the
de-elevation path — behaves differently in the two places, and only CI can settle it. Everything
else must be green locally first.

### Testing something that only CI can answer

Put **`[ci-admin-only]`** anywhere in the commit message. The three E2E shards and the merged report
are skipped; lint, the unit layers and `E2E (@admin, elevated)` still run. That turns a ~36
runner-minute round trip into about 4.

```
git commit -m "fix(025): de-elevated agent keeps the panel's cwd [ci-admin-only]"
```

Skipping is opt-IN on purpose. Forgetting the marker costs runner minutes; forgetting to ask for the
full suite would let a branch merge unverified, which is the more expensive mistake.

**Run the full suite before merging** — drop the marker (or push any commit without it) so all three
shards run, and let them go green before the PR comes out of draft.

### Shards are planned, not sorted

CI does not use Playwright's `--shard`. That splits by test COUNT in file order, so the alphabet
chose the split and every `terminal-*` spec landed in one third — measured at 3.7, 8.3 and 36
minutes, the last killed by a job timeout. `packages/ui/tests/e2e/shard-plan.json` assigns files to
groups from measured durations instead (9.2 minutes each).

**Adding a spec file means adding it to that plan.** `packages/ui/tests/unit/shard-plan.test.ts`
fails if a spec is missing, duplicated or stale, because a spec in no group runs nowhere and does so
silently.

### Two tiers locally, three shards on CI

`npm run test:e2e` runs the parallel tier at several workers, then the serial tier
at one — about 21 minutes, against ~35 for the old single-worker arrangement.

**Adding a spec that opens the preferences window or drives a context menu means
adding it to `packages/ui/tests/e2e/parallel-plan.json`.** `shard-plan.test.ts`
fails the build if you don't: such a spec steals focus, and throng closes menus on
blur, so it would make some *unrelated* test flake. The same applies to a spec that
drives a long-running real shell, which starves at high worker counts.

CI is deliberately different — one worker per shard, no tiers. See `docs/testing.md`.

### A shared app per file, where the tests allow it

Every `runApp()` is an Electron launch, a daemon and often a real shell — around two seconds on CI.
Where a file's tests do not seed state *before* the app starts, share one app via `openApp()` in
`beforeAll`; see `docs/testing.md`. A test that needs a seeded config root or database keeps its own
app and says so with `runOwnApp`.
