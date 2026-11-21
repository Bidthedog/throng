/**
 * What a print host may load (075 FR-079): its own document, the remote images its preview had loaded, the `data:`
 * URLs a printable inlines its pictures as, the preview's own `throng-preview:` route, and the app's bundled assets.
 * Nothing else — a `blob:` URL belongs to the preview's window and never loads here, which is why a printable inlines
 * every picture drawn from one (the maintainer, 2026-11-20: "SVG Print preview does not show anything").
 *
 * Electron-free, so the decision is tested on its own; `electron-print-engine.ts` applies it to the print partition.
 */
export function printRequestAllowed(
  url: string,
  host: { readonly fileUrl: string; readonly allowed: ReadonlySet<string> },
  isBundledAsset: (url: string) => boolean,
): boolean {
  return url === host.fileUrl || host.allowed.has(url) || url.startsWith('data:') || url.startsWith('throng-preview:') || isBundledAsset(url);
}
