# Contract: one running throng per user

**Feature**: 058 | Implemented by `packages/ui/src/main/instance-guard.ts` (boundary) over
`packages/core/src/config/instance-identity.ts` (pure). Research D5–D8.

## Namespace

A process's namespace is the daemon pipe name it resolved (`instancePipeName`):

| Launch | Namespace |
|---|---|
| Any installed or extracted copy — setup, MSI, portable, archive, any scope | the user's default pipe (`defaultPipeName(userToken)`) |
| A development build run from source (`!app.isPackaged`) | default pipe + `.dev` |
| Any launch with `THRONG_PIPE_NAME` set (tests, `verify-installer.mjs`) | that name |

The portable build no longer has a namespace of its own (research D6).

## Lock

- The instance lock is a named pipe: `<namespace>.instance`.
- The first launch in a namespace **listens** on it; that launch is the running instance.
- A launch whose `listen` fails with `EADDRINUSE` **connects**, writes one line of JSON —
  `{"execPath":"<process.execPath>","version":"<product version>"}` — and quits with exit `0`.
- A running instance that cannot be reached within 2 s (a crashed holder cannot hold a pipe, so this
  is a hung one) is not overridden; the new launch quits and logs the timeout.

## Legacy lock (FR-018b)

The running instance also holds Electron's `requestSingleInstanceLock()` (keyed to its userData
folder), because that is the only lock releases before this feature hold.

| Running | Launched | Outcome |
|---|---|---|
| new copy | new copy | pipe message → bring forward; notice if different copy |
| new copy | pre-058 copy | the old copy loses Electron's lock and exits; the new copy receives `second-instance` and treats `argv[0]` as `execPath` → bring forward; notice (different copy) |
| pre-058 copy | new copy | the new copy holds the pipe but loses Electron's lock → releases the pipe and exits; the old copy brings its window forward; **no notice** |
| none | any | starts |

## Running instance's response to a launch

1. Bring the main window forward (existing behaviour: restore, move onto a visible display, show,
   focus).
2. If the launch's install root differs from its own: show the different-copy notice. Same install
   root: nothing more (FR-018).

## The different-copy notice

Inline, in the main window, dismissible, one at a time:

> **throng is already running** from `{runningRoot}` (version {runningVersion}). To open the copy at
> `{launchedRoot}`, close this one first.

A further different-copy launch while it is visible re-flashes it and updates `{launchedRoot}`.

## What is not affected

- Development and test runs (FR-018a): their namespace differs, so they never meet the installed
  copy's lock or daemon.
- The daemon: still one per namespace (020 FR-010), now shared by every copy (FR-021). A daemon of a
  different build in the namespace is replaced on start (FR-021a, research D7).
