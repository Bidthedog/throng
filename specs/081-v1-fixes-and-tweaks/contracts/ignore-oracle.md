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
- Outside a repository (FR-073, amended): exit 128 asks again as
  `git --git-dir=<scratch> --work-tree=<project root> -C <folder> check-ignore -z --stdin`, where `<scratch>` is an
  empty bare repository made once per session in the OS temp folder (`git init --bare --template=`) and removed on
  exit. The project's `.gitignore` files apply from its root, and nothing is written into the project. Such a folder
  costs two git processes per listing.
- Directory paths are passed with a trailing `/` so directory-only patterns match.
- Empty `relPaths` → empty set without spawning.

## IPC: `throng:files:ignored`

Request `{ rootId, relPaths: string[] }` → response `{ ignored: string[] }`. Unknown root → `[]`. Batched per listing
by the renderer; never blocks the listing reply.
