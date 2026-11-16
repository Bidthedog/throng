---
name: shell-platform-landmines
description: Shell constraints in throng's CI and release scripts across Windows Git Bash, Ubuntu and hosted macOS runners
metadata:
  type: project
---

CI runs bash on three platforms: Windows (Git Bash on windows-2022), Ubuntu, and hosted Apple silicon macOS (spec 070).
macOS ships bash 3.2 at /bin/bash, so any script or workflow `run:` block that may reach a Mac must avoid bash 4+
features (associative arrays, `mapfile`) and must not expand an empty array as `"${arr[@]}"` under `set -u`; use
`${arr[@]+"${arr[@]}"}`.

**Why:** a release-pipeline step that works on Linux fails only on the macOS runner, where nobody can reproduce it locally.

**How to apply:** write `scripts/*.sh` and macOS job steps 3.2-safe; check with `bash -n` and ShellCheck (no
`.shellcheckrc` in the repo, so defaults apply). macOS `ps -o comm=` is a full path that can contain spaces, so a
single `ps` call with `comm` before `args` cannot be split; `scripts/process-table.mjs` reads two calls and joins on pid.
Tests for `scripts/*.mjs` live in `packages/ui/tests/unit` and import them by relative path.
