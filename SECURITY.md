# Security Policy

## Supported versions

throng is pre-1.0 and under active development. Only the latest `master` receives
security fixes; there are no back-ported patch releases yet.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/Bidthedog/throng/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab). Include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if you have one),
- affected version / commit, and OS.

You can expect an initial acknowledgement within a few days. Once a fix is available it
will be released on `master` and the advisory published with credit to the reporter (unless
you prefer to remain anonymous).

## Scope

throng runs real shells and reads and writes files on the local machine by design. Reports
are most useful when they show a way to **escape a project's confinement** (act outside its
root folder), **run code the user did not intend**, **read data across project boundaries**,
or **escalate privilege** beyond the explicit run-as-administrator flow. Findings in bundled
third-party dependencies are welcome too — include the advisory or CVE where possible.
