import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The renderer's Content-Security-Policy (044 T047, FR-082, FR-093, contracts/security-policy.md
 * Layer 3, research R8).
 *
 * Layer 3 is independent of the sanitiser on purpose: if a script, a frame or a remote stylesheet ever
 * survived sanitising, the engine still refuses it. So this pins the policy the way the contract states
 * it, directive by directive, rather than asserting a substring that a reordering or an extra source
 * would slip past.
 *
 * It reads the SOURCE `index.html`. Vite copies the meta through to `dist/renderer/index.html`
 * unchanged, and every renderer window — main, sub-workspace, preferences — loads that one file.
 */
const INDEX_HTML = fileURLToPath(new URL('../../src/renderer/index.html', import.meta.url));

type Policy = Map<string, string[]>;

/** Directives by name, in the browser's terms: the FIRST occurrence of a name wins, later ones are ignored. */
function parsePolicy(content: string): { policy: Policy; duplicates: string[] } {
  const policy: Policy = new Map();
  const duplicates: string[] = [];
  for (const raw of content.split(';')) {
    const [name, ...sources] = raw.trim().split(/\s+/).filter(Boolean);
    if (!name) continue;
    const key = name.toLowerCase();
    if (policy.has(key)) duplicates.push(key);
    else policy.set(key, sources);
  }
  return { policy, duplicates };
}

describe('renderer Content-Security-Policy (Layer 3)', () => {
  let html: string;
  let metas: string[];
  let policy: Policy;
  let duplicates: string[];

  beforeAll(() => {
    html = readFileSync(INDEX_HTML, 'utf8');
    metas = [...html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*"Content-Security-Policy"[^>]*>/gi)].map((m) => m[0]);
    const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(metas[0] ?? '')?.[1] ?? '';
    ({ policy, duplicates } = parsePolicy(content));
  });

  it('is declared by exactly one meta, before any script or stylesheet it has to govern', () => {
    expect(metas).toHaveLength(1);
    const metaAt = html.indexOf(metas[0]);
    for (const governed of ['<script', '<link']) {
      const at = html.indexOf(governed);
      if (at >= 0) expect(metaAt, governed).toBeLessThan(at);
    }
  });

  it('names no directive twice (a browser silently ignores the second)', () => {
    expect(duplicates).toEqual([]);
  });

  it('names exactly the Layer 3 directives and no others', () => {
    // Pinned as a set because each directive below is checked by value, and a directive nobody checks
    // is where a policy widens unnoticed: `script-src-elem`, `script-src-attr`, `style-src-attr` and
    // `worker-src` each override the directive this file pins for the resources they name.
    expect([...policy.keys()].sort()).toEqual(
      [
        'default-src',
        'script-src',
        'style-src',
        'font-src',
        'img-src',
        'object-src',
        'frame-src',
        'base-uri',
        'form-action',
      ].sort(),
    );
  });

  it("default-src 'self'", () => {
    expect(policy.get('default-src')).toEqual(["'self'"]);
  });

  it("script-src 'self', with no 'unsafe-inline'", () => {
    const scriptSrc = policy.get('script-src');
    expect(scriptSrc).toEqual(["'self'"]);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  /*
   * 'unsafe-inline' because CodeMirror and the theme provider mount style elements. 074 FR-072, FR-092 — plus the
   * asset route alone: the HTML preview's `srcdoc` frame INHERITS this policy, and its injected frame policy can only
   * narrow it, so without the route a page's own `<link rel="stylesheet">` (rewritten to `throng-preview://asset/…`)
   * never loads. The route serves `text/css` only to an HTML run, confined to the project.
   */
  /*
   * 074 FR-092a — an HTML Preview frame is same-origin (FR-074a) and so inherits this policy, which cannot follow a
   * user-edited safe list: `https:` is granted for styles and fonts here, and narrowed to each frame's own sources by
   * the frame's policy and the request filter, which still refuses both to every other document.
   */
  it("style-src 'self' 'unsafe-inline', the asset route and https: (FR-092a)", () => {
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'", 'throng-preview://asset', 'https:']);
  });

  it("font-src 'self' throng-preview: https: — no data:, no http: (FR-092a)", () => {
    expect(policy.get('font-src')).toEqual(["'self'", 'throng-preview:', 'https:']);
  });

  /*
   * 054 FR-049a — `blob:` joins for the diagram rasteriser (`preview/diagram/rasterise.ts`), which loads
   * the SANITISED diagram SVG from an object URL it mints itself to copy it as a PNG. Only this
   * document's own script can mint one, and the preview sanitiser's URI allowlist refuses a `blob:` src
   * in any rendered document, so no file can reach it. `data:` and `http:` stay out.
   */
  it("img-src 'self' https: throng-preview: blob: — no data:, no http:", () => {
    expect(policy.get('img-src')).toEqual(["'self'", 'https:', 'throng-preview:', 'blob:']);
  });

  // 074 FR-092 (research R6) — the ONE frame grant: the HTML preview's follow route, which answers 204 and serves
  // no document, so a plain click on a link in the sandboxed page navigates nowhere. Nothing else may be framed.
  it('frame-src admits the follow route alone', () => {
    expect(policy.get('frame-src')).toEqual(['throng-preview://follow']);
  });

  it.each(['object-src', 'base-uri', 'form-action'])("%s 'none'", (directive) => {
    expect(policy.get(directive)).toEqual(["'none'"]);
  });

  // Implied by the exact set above; kept so the R8 reason has a test that names it.
  it('leaves connect-src and media-src on default-src, so remote fetches and media are refused (R8)', () => {
    for (const directive of ['connect-src', 'media-src']) {
      expect(policy.has(directive), directive).toBe(false);
    }
  });
});
