# Contract: Pipe Endpoint (per-user)

**Traces**: FR-013; SC-006; edge case "two installations on one machine".

## `core` API (`packages/core/src/config/pipe-endpoint.ts`)

```ts
/** Stable per-user token (account SID via the OS abstraction; sanitised username fallback). */
export function userToken(deps: { sid?: string; username: string }): string;

/** The default per-user pipe name, derived from the token. One source for both boundaries. */
export function defaultPipeName(deps: { sid?: string; username: string }): string;
// → "\\\\.\\pipe\\throng.<token>.daemon"
```

## Behavioural requirements

- **B1** The daemon composition root (`packages/daemon/src/composition-root.ts`) and the UI settings
  (`packages/ui/src/main/ui-settings.ts`) both take their default pipe name from `defaultPipeName(...)` —
  the literal constant is removed from both (DRY; FR-013).
- **B2** For the **same** user token, both boundaries derive the **same** name; for **different** tokens,
  **different** names (FR-013 — no cross-user collision).
- **B3** `THRONG_PIPE_NAME` still overrides the derived default (tests depend on unique per-test pipes).
- **B4** The derived name is a valid Windows pipe name (no illegal characters; token sanitised).

## Tests (test-first)

- **unit** — `defaultPipeName` is deterministic per token; different tokens → different names; sanitises an
  awkward username; SID preferred over username when present.
- **contract** — the daemon-side default and the UI-side default are byte-equal for one user token and
  differ across tokens (the collision the spec forbids cannot occur).
