import { describe, expect, it } from 'vitest';
import { sanitiseSvg } from '@throng/core';

/**
 * 017 / #54 — pack icons are INLINED into the renderer's DOM, because that is the only way an SVG
 * can inherit `currentColor` from the page (inside an `<img>` it is an isolated document and
 * resolves to black — which is the bug).
 *
 * Inlining means markup from `%USERPROFILE%\.throng\icon-packs\` reaches the DOM. A pack is a
 * shareable artifact — the whole point of #55 is that people will pass them around — so it is
 * untrusted input on a script-injection path. It is sanitised ONCE, in the main process, before it
 * ever crosses IPC.
 */
describe('sanitiseSvg', () => {
  const svg = (inner: string, attrs = ''): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"${attrs}>${inner}</svg>`;

  describe('rejects what is not an icon', () => {
    it('returns null when the root element is not <svg>', () => {
      expect(sanitiseSvg('<html><body>hi</body></html>')).toBeNull();
      expect(sanitiseSvg('<div><svg></svg></div>')).toBeNull();
      expect(sanitiseSvg('not markup at all')).toBeNull();
      expect(sanitiseSvg('')).toBeNull();
    });
  });

  describe('strips the script-injection surface', () => {
    it('removes <script> elements and their contents', () => {
      const out = sanitiseSvg(svg('<script>alert(1)</script><path d="M0 0"/>'));
      expect(out).not.toBeNull();
      expect(out).not.toContain('script');
      expect(out).not.toContain('alert');
      expect(out).toContain('<path');
    });

    it('removes <foreignObject>, which can host arbitrary HTML', () => {
      const out = sanitiseSvg(svg('<foreignObject><body onload="x()"/></foreignObject><path d="M0 0"/>'));
      expect(out).not.toContain('foreignObject');
      expect(out).not.toContain('onload');
    });

    it('removes every on* event attribute, whatever its case', () => {
      const out = sanitiseSvg(
        svg('<path d="M0 0" onclick="steal()" ONMOUSEOVER="x()" oNlOaD="y()"/>'),
      );
      expect(out).not.toBeNull();
      expect(out!.toLowerCase()).not.toContain('onclick');
      expect(out!.toLowerCase()).not.toContain('onmouseover');
      expect(out!.toLowerCase()).not.toContain('onload');
      expect(out).toContain('d="M0 0"'); // the geometry survives
    });

    it('strips href / xlink:href unless it is a bare #fragment', () => {
      const bad = sanitiseSvg(svg('<a href="javascript:alert(1)"><path d="M0 0"/></a>'));
      expect(bad!.toLowerCase()).not.toContain('javascript:');

      const external = sanitiseSvg(svg('<use xlink:href="http://evil.example/x.svg#a"/>'));
      expect(external!.toLowerCase()).not.toContain('evil.example');

      const fragment = sanitiseSvg(svg('<use href="#gradient"/>'));
      expect(fragment).toContain('#gradient'); // legitimate internal reference survives
    });

    it('removes <style>, which can smuggle url() and @import', () => {
      const out = sanitiseSvg(svg('<style>@import url(http://evil.example/x.css)</style><path d="M0 0"/>'));
      expect(out).not.toContain('style');
      expect(out).not.toContain('evil.example');
    });
  });

  describe('preserves what makes the icon work', () => {
    it('KEEPS stroke="currentColor" and fill="currentColor"', () => {
      // This is load-bearing. currentColor is the entire mechanism by which a pack icon takes the
      // theme's colour (FR-004). A sanitiser that stripped it would "secure" the icon into
      // invisibility and silently defeat the feature.
      const out = sanitiseSvg(
        svg('<path d="M0 0" stroke="currentColor" fill="currentColor" stroke-width="2"/>'),
      );
      expect(out).toContain('stroke="currentColor"');
      expect(out).toContain('fill="currentColor"');
      expect(out).toContain('stroke-width="2"');
    });

    it('does not rewrite geometry', () => {
      const d = 'M3 7h18M3 12h18M3 17h18';
      const out = sanitiseSvg(svg(`<path d="${d}"/>`, ' width="24" height="24"'));
      expect(out).toContain(d);
      expect(out).toContain('viewBox="0 0 24 24"');
    });

    it('keeps the ordinary shape vocabulary', () => {
      const out = sanitiseSvg(
        svg('<g><circle cx="1" cy="2" r="3"/><rect x="0" y="0"/><line x1="0"/><polyline points="1,2"/></g>'),
      );
      expect(out).toContain('<circle');
      expect(out).toContain('<rect');
      expect(out).toContain('<line');
      expect(out).toContain('<polyline');
      expect(out).toContain('<g');
    });
  });

  describe('cannot be bypassed by malformed markup (adversarial review, 2026-07)', () => {
    // A regex sanitiser that RECONSTRUCTS via String.replace passes through anything it fails to
    // tokenise. An unbalanced quote (`title="`) makes the tag regex fail, so a naive implementation
    // emits the raw `<img onerror=…>` untouched — and the browser's lenient HTML parser still reads
    // it as a live element. The fix is to FAIL CLOSED: any `<` that does not begin a well-formed
    // ALLOWED tag is escaped, so no raw tag can ever survive.
    const attacks = [
      '<svg></svg><img src=x onerror=alert(1) title="',
      '<svg><desc><img src=x onerror=alert(1) title="></desc></svg>',
      '<svg><img src=x onerror=alert(1)></svg>',
      '<svg><title><img src=x onerror="alert(1)"></title></svg>',
      '<svg foo="bar"><img/onerror=alert(1) src=x></svg>',
      '<svg></svg><image href="javascript:alert(1)"/>',
      '<svg><a xlink:href="javascript:alert(1)"><rect/></a></svg>',
    ];
    for (const attack of attacks) {
      it(`neutralises: ${attack.slice(0, 48)}…`, () => {
        const out = sanitiseSvg(attack);
        if (out === null) return; // rejecting outright is a valid safe outcome
        const lower = out.toLowerCase();
        // The property that matters is that no LIVE tag survives — an escaped `&lt;img…&gt;` that
        // the browser renders as inert text is safe, even though the characters "onerror" appear in
        // it. So the assertions target unescaped tags and live attributes, not mere substrings.
        expect(lower).not.toMatch(/<\s*img/); // a real, unescaped <img> element
        expect(lower).not.toMatch(/<\s*image/);
        expect(lower).not.toMatch(/<[^>]*\bon\w+\s*=/); // an on* handler INSIDE a real tag
        expect(lower).not.toMatch(/<[^>]*javascript:/); // javascript: in a real attribute
        expect(lower).not.toMatch(/<\s*script/);
      });
    }

    it('escapes a raw < that does not begin an allowed tag, rather than passing it through', () => {
      const out = sanitiseSvg('<svg></svg><img src=x onerror=alert(1) title="');
      // Whatever survives the </svg> is inert text: the < is escaped, so the browser sees
      // literal characters, not an <img> element.
      expect(out).not.toBeNull();
      expect(out!).not.toContain('<img');
    });
  });

  describe('is idempotent', () => {
    it('sanitising an already-sanitised icon changes nothing', () => {
      const once = sanitiseSvg(svg('<path d="M0 0" stroke="currentColor" onclick="x()"/>'));
      expect(once).not.toBeNull();
      const twice = sanitiseSvg(once!);
      expect(twice).toBe(once);
    });
  });
});
