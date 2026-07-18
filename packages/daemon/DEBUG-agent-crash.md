# Debugging the de-elevated PTY agent crash (#94 follow-up)

**Symptom:** On a real **elevated** machine, opening a *non-elevated* ("de-elevated")
terminal from an admin throng shows `[throng] the terminal agent stopped unexpectedly`
and no terminal appears.

**What we already know:** that message comes from `pty-agent-host.ts` `sock.on('close')`
*after* `connected=true` — i.e. the de-elevated agent process **launches and connects
back** to the daemon, then **dies shortly after**. So the launch and the token handoff
work; the crash is in the agent itself, most likely when it spawns its first ConPTY.

Until now the agent's crash output went **nowhere**: it runs detached at medium
integrity, with `CREATE_NO_WINDOW` and no stdout/stderr redirection. This build adds a
**durable agent-side log** so the crash becomes observable.

## What to do (elevated machine)

1. Start throng **elevated** (Run as administrator), as you normally reproduce this.
2. Open a **non-elevated** terminal (a normal, not "as admin", terminal) so the daemon
   launches the de-elevated agent. Wait for the `[throng] the terminal agent stopped
   unexpectedly` message to appear.
3. Open `%TEMP%` (paste `%TEMP%` into Explorer's address bar, or `echo %TEMP%` in a
   shell — typically `C:\Users\<you>\AppData\Local\Temp`).
4. Find the **newest** file named `throng-agent-<pid>.log`. Sort by *Date modified*; the
   one written at the moment you opened the terminal is the one we want. (There may be
   several — one per agent launch. Newest wins.)
5. **Send the full contents of that file.** That log is what pins the crash cause — do
   not summarise it; paste it verbatim.

## How to read the log (what each ending means)

The agent logs its whole lifecycle. The **last lines** tell the story:

- Ends at `agent start …` then nothing → it died before loading node-pty (unlikely,
  since it connects). Check `execPath`, `node=` and `ELECTRON_RUN_AS_NODE` on that line.
- `FATAL constructing NodePtyHost: …` → the native **node-pty module failed to load**
  in the borrowed-token/medium-integrity context. The stack follows.
- Reaches `listening on pipe …` and `daemon connected on pipe`, then
  `cmd start …` and `about to pty.start (native ConPTY spawn) …` **and stops there with
  no `started`/`exit`/`error` line and no `process exit` line** → the crash is **inside
  the native ConPTY spawn** (an access violation that kills the process below the JS
  layer — it cannot be caught or printed, so its signature is this silent stop).
- `ERROR pty.start threw …` → node-pty threw a *catchable* error (e.g. a bad
  `file`/`cwd`); the message + stack are on that line.
- `FATAL uncaughtException: …` / `unhandledRejection: …` → an async failure; stack follows.
- `daemon pipe closed → shutdown` / `watchDaemon: daemon pid … vanished` → the agent
  exited **deliberately** because the daemon went away — not a crash (look at what
  happened on the daemon side instead).

Lines prefixed `[stdout]` / `[stderr]` are the agent's own console output teed into the
log. NOTE: a **native** crash banner is written below the JS layer and will **not**
appear here — that is exactly why the silent stop after `about to pty.start` is the
signal to watch for.

## Log location contract

`os.tmpdir()/throng-agent-<pid>.log` — see `src/pty-agent-log.ts`. Chosen because it is
reachable across the integrity boundary and written with synchronous appends, so the
line before a hard crash is flushed to disk before the crash can lose it.
