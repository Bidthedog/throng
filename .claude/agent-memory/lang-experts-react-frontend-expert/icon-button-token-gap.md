---
name: icon-button-token-gap
description: icon-tokens-exist.test.ts only checks static `<Icon token="…">`, not `<IconButton token="…">` — a missing theme token on an IconButton passes every test
metadata:
  type: project
---

`packages/ui/tests/unit/icon-tokens-exist.test.ts` matches `/<Icon\b[^>]*?\btoken="([^"]+)"/g` over the
renderer, so `<IconButton token="x">` call sites are never checked against the shipped theme
(`packages/core/src/config/theme.ts`). A new IconButton with an undefined token renders an empty icon and
every unit and component test stays green.

**Why:** found in 059 round 2, when the View Whitespace toggle used token `whitespace` before core defined it.

**How to apply:** when adding an IconButton with a new token, confirm the token exists in core's theme
(adding one is a core change: theme.ts, theme-copy.ts, a shipped-defaults theme version bump) rather than
trusting the suite. Related: [[renderer-test-typecheck-gap]].
