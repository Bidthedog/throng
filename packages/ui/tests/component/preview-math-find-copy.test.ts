import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownRenderer } from '../../src/renderer/preview/providers/markdown/markdown-renderer.js';
import { typesetMath } from '../../src/renderer/preview/providers/markdown/math-typeset.js';
import { createHtmlExporter } from '../../src/renderer/preview/providers/markdown/sanitise.js';
import { buildPreviewTextModel } from '../../src/renderer/preview/preview-search-model.js';
import { captureSelection, copyCapturedSelection, selectAllIn } from '../../src/renderer/preview/copy.js';

/**
 * 075 FR-049, FR-050 — find leaves typeset equations out; copy puts the equation in its place: its source with
 * delimiters as plain text, the typeset equation (its MathML) as rich text.
 *
 * Layer: component — the subject is the DOM the typesetter draws, and what find and copy read from it (jsdom).
 */
const BASE = { panelId: 'p', docPath: '/proj/a.md', projectRoot: '/proj', remoteImages: false };

let mounted: HTMLElement[] = [];
afterEach(() => {
  for (const el of mounted) el.remove();
  mounted = [];
});

async function draw(text: string, typeset = true): Promise<HTMLElement> {
  const root = document.createElement('div');
  root.append(createMarkdownRenderer().render(text, { ...BASE, typesetMath: typeset }).fragment);
  document.body.append(root);
  mounted.push(root);
  if (typeset) await typesetMath(root, () => Promise.resolve());
  return root;
}

describe('find (FR-049)', () => {
  it('does not match inside a typeset equation', async () => {
    const model = buildPreviewTextModel(await draw('Area $x^2$ of a square.\n'));
    expect(model.text).toContain('Area');
    expect(model.text).toContain('of a square.');
    expect(model.text).not.toContain('x');
  });

  it('matches the source as today when Typeset math is off', async () => {
    expect(buildPreviewTextModel(await draw('Area $x^2$.\n', false)).text).toContain('$x^2$');
  });
});

describe('copy (FR-050)', () => {
  it('puts the source with its delimiters in plain text', async () => {
    const root = await draw('Area $x^2$ and\n\n$$\ny\n$$\n');
    selectAllIn(root);
    const captured = captureSelection(root);
    expect(captured?.text).toContain('Area $x^2$ and');
    expect(captured?.text).toContain('$$y$$');
    expect(captured?.text).not.toContain('x2');
  });

  it('puts the typeset equation, as MathML, in rich text', async () => {
    const root = await draw('Area $x^2$.\n');
    selectAllIn(root);
    const captured = captureSelection(root);
    if (captured === null) throw new Error('nothing captured');
    const writeRich = vi.fn(async (_entry: { text: string; html: string }) => undefined);
    const exporter = createHtmlExporter();
    await copyCapturedSelection(captured, 'rich', { writeRich }, async (fragment) => exporter(fragment));
    const html = writeRich.mock.calls[0][0].html;
    expect(html).toMatch(/<math[^>]*>/);
    expect(html).toContain('<msup>');
    expect(html).not.toContain('class=');
    expect(writeRich.mock.calls[0][0].text).toContain('$x^2$');
  });

  it('keeps refusing MathML the document wrote itself', () => {
    const exporter = createHtmlExporter();
    const holder = document.createElement('div');
    holder.innerHTML = '<p>a<math><mi>z</mi></math>b</p>';
    const fragment = document.createDocumentFragment();
    fragment.append(...holder.childNodes);
    expect(exporter(fragment)).not.toContain('<math');
  });
});
