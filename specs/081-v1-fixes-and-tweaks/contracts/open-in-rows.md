# Contract: shared Open In rows (US6, FR-050–FR-053)

```ts
// packages/ui/src/renderer/explorer/open-in-rows.ts
export interface OpenInTarget {
  absPath: string
  kind: 'file' | 'folder'
  inProject: boolean        // false → no editor, preview, terminal or search rows
  binary: boolean           // true → no editor rows (045 FR-170e)
  pending: boolean          // true → resolution-dependent rows drawn disabled (045 FR-170a/c)
}
export interface OpenInOps { /* the File Explorer's Open In performers, on absolute paths */ }
export function openInRows(target: OpenInTarget, ops: OpenInOps): MenuAction[]
```

- Groups, order, labels and icons are the File Explorer's today: OS (OS File Explorer, Open in OS Default Program),
  editor targets, preview targets, Terminal ▸, Search ▸.
- The File Explorer and the link menu both call this; neither builds Open In rows of its own.
- Core `buildLinkMenu` returns the target state (`pending`, `inProject`, `binary`, `kind`) instead of its old
  Open In / OS / Open Preview rows; Open Link, Find in File Explorer and Copy Link to Clipboard stay core rows.
