# Idempotent migrations — constitution detail

Binding: constitution Technology & Architecture Constraints (`.specify/memory/constitution.md`, *Technology & Architecture Constraints*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1. This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## Idempotent data migrations

- **Idempotent data migrations:** Every schema or data migration MUST be idempotent.
  Re-running a migration, or running it against a store that is already at (or past)
  the target version, MUST be safe and MUST converge on the same end state — it MUST
  NOT error, and MUST NOT duplicate, corrupt, or double-apply data. Migrations MUST
  therefore be written defensively (e.g. guard against columns/tables/rows that
  already exist, use create-if-not-exists / additive operations, and key changes off
  the recorded schema version) so that an interrupted, partially-applied, or repeated
  run heals to the correct state rather than failing or diverging.
