# Signing and reproducibility

Two deliberate choices about what a release does and does not promise. Neither is an omission to
fix.

## Signing — why there is a checksum instead

throng's release artifacts are **not code-signed**. Code signing was considered and dropped for a
solo open-source project: it needs a paid, identity-validated publisher certificate held in hardware,
and (for the affordable automatable route) admits individual developers only in a limited set of
countries. See the decision record in
[`spec.md`](../../../../specs/020-application-packaging/spec.md) and
[research D7](../../../../specs/020-application-packaging/research.md). The open issue that would
revisit it is [#118](https://github.com/Bidthedog/throng/issues/118).

In its place, every release publishes a **SHA-256 checksum** so a downloader can confirm the file
arrived intact. A checksum proves **integrity**, not **identity** — and, unlike a signature, it does
**not** remove the operating system's "unrecognised app" warning, which will appear on every
download. The release notes therefore **explain that warning and how to verify against the
checksum**, and never tell anyone to disable a security feature. What the user sees, and what to do
about it, is
[Installation → the unrecognised-app warning](../../../../docs/installation.md#the-unrecognised-app-warning).

## Reproducibility (SC-008)

A release records the two inputs that pin what it built: the **exact source revision** (the commit
SHA, written into the GitHub Release notes by the publish job) and the **exact bundled-runtime
version** (`resources/runtime/RUNTIME_VERSION.json`, stamped by `scripts/stage-runtime.mjs` from the
Node build that ran the packaging). A rebuild from that revision, on that runtime, produces the same
installed component set.

This is a *component-set* reproducibility claim exercised as a CI / real-hardware boundary — not a
byte-for-byte determinism guarantee (installer timestamps and compression differ run to run).
