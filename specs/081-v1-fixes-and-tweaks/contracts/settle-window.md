# Contract: external-delete settle window (US2, FR-013/FR-013a/FR-014)

```ts
// packages/ui/src/main/external-delete-settle.ts
/** 081 FR-013a. Not the timer 019 FR-011 forbids: an outside delete followed by a write cannot be bracketed. */
export const EXTERNAL_DELETE_SETTLE_MS = 500
```

| Event | Behaviour |
|---|---|
| Watched path read fails (outside throng) | Start or restart the document's settle timer. No `markDeleted`, no relay. |
| Timer fires, path readable | Existing `res.ok` path: reload or changed-on-disk choice. Nothing reported. |
| Timer fires, path unreadable | `markDeleted` once (editor), or `deleted` notice (standalone preview). |
| `beginMove` / in-app delete | No timer; existing bracket and `markDeleted` paths unchanged. |
| Dispose | Timer cleared. |
