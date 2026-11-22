# Contract: printing

## Provider seam

Core descriptor: `print?: 'document' | 'pages'` (data-model). Renderer view:

```ts
interface PreviewProviderView {
  // …existing
  /** FR-060 — the printable output for what `body` shows now. Required when the descriptor declares `print`. */
  printable?(body: HTMLElement, context: { title: string }): Promise<PrintableOutput>;
}
```

`provider-views.test.ts` fails when a descriptor declares `print` and its view has no `printable`.

## Command

`preview.print` — label **Print…**, scope `{ preview }`, Windows/Linux `Ctrl+P`, macOS `Cmd+P`. Menu item in
the preview header menu and body menu (in the group with Copy / Select All's neighbours: its own group,
last before Close). Disabled with hover "This preview type cannot be printed." when the provider has no
`print`. Running it: `window.throng.print.open({ title, output })`.

## IPC (preload `throng.print`)

| Call | From | Answer |
|---|---|---|
| `open(request: PrintJobRequest)` | a preview window | `{ opened: boolean }` — `false` when a Print Preview window was already open (it is focused) |
| `job(jobId)` | Print Preview app | `{ title, settings: PrintSettings, printers: PrinterChoice[], fit }` |
| `render(jobId, settings)` | Print Preview app | `{ pageCount, pdf } \| { error }` — lays the pages out again; the app draws them from `pdf` with PDF.js, one at a time (FR-068a) |
| `printers(jobId)` | Print Preview app | `PrinterChoice[] \| null` — the OS's printers now; the app asks every 3 s while open (FR-068b) |
| `print(jobId, settings, sheet: PrintSheet)` | Print Preview app | `{ ok: true } \| { ok: false, cause }` — on ok the window closes. `sheet` is every page shown, drawn at 300 dpi as a PNG (`{ widthMm, heightMm, pages }`); refused unless it holds exactly the pages laid out with `settings` (FR-068d) |
| `close(jobId, settings)` | Print Preview app | — saves settings, closes |

## Engine port (core `abstractions/print-engine.ts`)

```ts
interface IPrintEngine {
  printers(): Promise<readonly PrinterInfoLike[]>;
  load(document: PrintableOutput): Promise<PrintHostHandle>;
  pdf(handle: PrintHostHandle, options: PdfOptions): Promise<Uint8Array>;
  print(handle: PrintHostHandle, options: PrintOptions): Promise<{ ok: true } | { ok: false; cause: string }>;
  dispose(handle: PrintHostHandle): void;
}
```

`print` is given a host loaded from `printSheetHtml(sheet)` — one image per sheet of paper — with `toPrintOptions`:
the printer, the paper and the copies, `margins: { marginType: 'none' }`, `scaleFactor: 100` and no page range.
The pages were laid out once, by `pdf`; printing never lays them out again (FR-068d).

`RecordingPrintEngine` (core testing) records every call; the controller test proves `print` is never
called for a job whose Print Preview was not shown (SC-012).

## Failure

A failed `print` returns its cause; the Print Preview app shows it inline in the window (one notice, Retry
by pressing Print again) and main logs it (`logCaught('print: send job', …)`). A user who closes the
window raises nothing.
