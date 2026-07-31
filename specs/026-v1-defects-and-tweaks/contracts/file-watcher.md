# Contract: `IFileWatcher` gains a failure signal

**Owner**: `packages/core/src/…` (seam) · `packages/ui/src/main/node-file-watcher.ts` (implementation)
**Drives**: FR-006, FR-007, FR-010, FR-010a, FR-010b, FR-011

## Why the contract has to change

FR-010a requires that an unrecoverable watch failure reaches the user. The seam today carries a
changed path and nothing else:

```ts
watch(dir: string, onChange: (path: string) => void): Disposable
```

There is no channel on which "I can no longer watch this" can be expressed, so the requirement is not
implementable without widening it. Everything else in this feature fits the existing shape.

## The change

```ts
interface WatchOptions {
  /** Called once, when the watch has failed and cannot be re-established. */
  onFailed?: (reason: string) => void;
}

watch(dir: string, onChange: (path: string) => void, options?: WatchOptions): Disposable
```

**Optional and trailing**, so both existing call sites compile untouched. A caller that does not pass
`onFailed` gets exactly today's behaviour minus the silent death.

## Behavioural contract

| # | Requirement | Observable |
|---|---|---|
| C1 | A change is reported no more than **1000 ms** after it occurs, however continuously events arrive | FR-006 · integration test |
| C2 | A burst still coalesces — 40 rapid changes produce fewer than 10 reports | FR-007 · integration test |
| C3 | On a runtime `'error'`, the watch is re-established; changes keep arriving afterwards | FR-010 · unit test (mocked `node:fs`) |
| C4 | Re-establishment is bounded; on exhaustion `onFailed` is called exactly once | FR-010a |
| C5 | `dispose()` stops the timer, cancels any pending retry, closes the handle, and prevents any later `onChange` or `onFailed` | FR-011 · unit test |
| C6 | Every failure, retry and escalation writes a diagnostic record | FR-010b |

## Parameters

Constructor arguments with defaults, matching the existing `debounceMs` precedent (Principle X):

| Name | Default | Meaning |
|---|---|---|
| `debounceMs` | 100 (150 for the explorer) | trailing quiet period — unchanged |
| `maxWaitMs` | 1000 | ceiling from the burst's first event to its report |
| `maxRetries` | 5 | re-establish attempts before `onFailed` |
| `retryBaseMs` | 250 | backoff base; delay grows per attempt |

## Timing rule (the whole of C1/C2)

```
on event:
  if no burst is open:  burstStartedAt = now
  clear the pending timer
  if now - burstStartedAt >= maxWaitMs:   fire immediately, close the burst
  else:                                    schedule fire in debounceMs
on fire:
  close the burst, call onChange(lastPath)
```

A quiet burst therefore reports once, `debounceMs` after it stops; a burst that never stops reports at
least every `maxWaitMs`.

## What must NOT change

- `onChange` still receives a path, still coalesced. This is not a change to the event payload.
- No polling. #186's acceptance criteria explicitly forbid working around the cause with a refresh
  loop, and C1 must be met by bounding the existing debounce.
- Non-Windows builds must keep compiling: nothing here is platform-specific.
