import type { IRefusedUriSchemes } from '@throng/core';

/**
 * The Windows half of FR-159's refused set (045; Principle II seam; research R27).
 *
 * Each of these is a protocol whose registered Windows handler has been, or can be, driven by a crafted
 * link into running something — so no entry in `editor.links.protocolAllowlist` may make one a link.
 * The OS-neutral half (`javascript`, `data`, `vbscript`, `about`, `blob`) is core's own constant and is
 * not repeated here.
 *
 * | Scheme | Why it is refused |
 * |---|---|
 * | `ms-msdt` | The Microsoft Support Diagnostic Tool — CVE-2022-30190 ("Follina"): a crafted `ms-msdt:` URI ran arbitrary PowerShell. |
 * | `search-ms` | Windows Search — a crafted query opens a remote WebDAV share in Explorer showing attacker files dressed as local results (the 2022 search-ms abuse, often chained with Follina). |
 * | `search` | The older alias of `search-ms`, handled by the same component. |
 * | `ms-officecmd` | Office's launcher — CVE-2021-42294 / the 2021 ms-officecmd research: argument injection into Office and Teams, leading to code execution. |
 * | `ms-appinstaller` | App Installer — abused through 2023 to install signed-looking malicious MSIX packages from a link; Microsoft disabled the handler by default in December 2023. |
 * | `ms-cxh`, `ms-cxh-full` | The Cloud Experience Host — reached from a link, it opens the account and out-of-box setup flows with system privilege surfaces a link has no business starting. |
 *
 * Curated, and reviewable in one place, rather than read from the handler registrations: a scheme's
 * name does not say whether its handler executes a file (plan round four, Complexity Tracking). The
 * list is frozen and the same set is returned every call — the renderer asks once per window.
 */
const REFUSED: ReadonlySet<string> = new Set([
  'ms-msdt',
  'search-ms',
  'search',
  'ms-officecmd',
  'ms-appinstaller',
  'ms-cxh',
  'ms-cxh-full',
]);

export class WindowsRefusedUriSchemes implements IRefusedUriSchemes {
  refusedSchemes(): ReadonlySet<string> {
    return REFUSED;
  }
}
