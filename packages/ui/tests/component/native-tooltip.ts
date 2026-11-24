/**
 * The text the OS would draw as a native tooltip over `el`, as Chromium chooses it (`HitTestResult::Title`): walk up
 * from the hovered node, and the first element whose own title is not null decides. An HTML element's own title is
 * its `title` attribute; an SVG element's is its first `<title>` child's text (the SVG `title` attribute is ignored).
 * An empty string means "no tooltip", and stops the walk. `null` means nothing on the way up had one.
 *
 * Constitution UX "One popup style": under a resting pointer this must be `''` or `null` everywhere in throng.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

export function nativeTooltipAt(el: Element): string | null {
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (node.namespaceURI === SVG_NS) {
      const title = [...node.children].find((c) => c.namespaceURI === SVG_NS && c.localName === 'title');
      if (title !== undefined) return title.textContent ?? '';
      continue;
    }
    const attr = node.getAttribute('title');
    if (attr !== null) return attr;
  }
  return null;
}
