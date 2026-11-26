# Contract: IgnoreOracle (US8, FR-070–FR-073)

```ts
// @throng/core
export interface IgnoreOracle {
  /** Which of `relPaths` (posix, relative to `root`) git ignores. Never rejects. */
  ignored(root: string, relPaths: readonly string[]): Promise<ReadonlySet<string>>
}
```

- Implementation (platform-node): `git -C <root> check-ignore -z --stdin`, paths NUL-separated on stdin, run off the
  main loop. Exit 0 → the printed paths; exit 1 → empty; any other exit, spawn failure or missing git → empty, and
  one debug log line per root per session (XIII).
- Directory paths are passed with a trailing `/` so directory-only patterns match.
- Empty `relPaths` → empty set without spawning.

## IPC: `throng:files:ignored`

Request `{ rootId, relPaths: string[] }` → response `{ ignored: string[] }`. Unknown root → `[]`. Batched per listing
by the renderer; never blocks the listing reply.
