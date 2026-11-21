# Every failure leaves a trace — constitution detail

Binding: constitution Principle XIII (`.specify/memory/constitution.md`, *XIII. Every Failure Leaves a Trace*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1. This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## The five rules

- **Every process is watched.** Every process throng starts MUST have its startup failure, its abnormal
  exit and the reason for both recorded in the diagnostic log — by the process itself where it can, and
  by its parent always. A process that fails while resolving its imports cannot log anything; only its
  parent saw it go. An exit throng asked for is not a failure.
- **Every caught error is logged.** An error reported by a child, or caught and not re-thrown, MUST be
  logged. A failure the code expects in normal operation is logged at `debug` with the reason it is
  expected, stated at the site; any other at `warn` or above. A catch that only discards is a
  violation, whatever it guards.
- **A crash is fatal.** The log has a `fatal` level above `error`. The crash of any component — a
  process throng starts, a window, a panel — is logged at it, and fatal records are written whatever
  log level is configured. A panel that throws while rendering, or is torn down by a failure rather
  than by the user, has crashed.
- **The log is where the user can find it.** Every process writes into the one logs folder the
  application opens for the user — never a temporary folder — and logging never crashes or stalls the
  process doing it.
- **Enforced by the build.** A new silent catch or an unwatched process start fails the unit layer,
  naming the file and line. A process start the parent deliberately does not watch says why at the site;
  nothing else is exempt.
