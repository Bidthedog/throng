/**
 * 067 T100 (FR-088 to FR-094) — links in a Markdown preview's front matter table.
 *
 * Web URLs, Markdown links, wikilinks and GitHub URLs inside a scalar value render as real links,
 * through the body's own inline pipeline and sanitiser, so a front matter link cannot drift from a body
 * link: same markup, same hover title, same destination resolution. Each item of a sequence is linked on
 * its own. A value with no link renders exactly as it did, keys stay plain, a scheme the body refuses
 * stays text, invalid YAML stays an unlinked code block, and with Show front matter off nothing changes.
 *
 * Shorthand `#123` references are linked only where the body resolves them (FR-090); the body resolves
 * none in the renderer, so none is linked here either, and that is asserted.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const COLD = { timeout: 10_000 };

const baseProps = (text: string, extra: Partial<PreviewBodyProps> = {}): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: 'D:/proj/README.md',
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true },
  initialViewState: undefined,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
  ...extra,
});

afterEach(() => vi.restoreAllMocks());

async function draw(text: string, extra: Partial<PreviewBodyProps> = {}): Promise<HTMLElement> {
  render(createElement(MarkdownBody, baseProps(text, extra)));
  const host = screen.getByTestId('preview-markdown-p1');
  await waitFor(() => expect(host.querySelector('table, pre, p, h1')).not.toBeNull(), COLD);
  return host;
}

const fm = (...lines: string[]): string => `---\n${lines.join('\n')}\n---\n\n`;
const table = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('table.preview-markdown__front-matter')!;
const cell = (host: HTMLElement, key: string): HTMLElement => {
  const th = [...table(host).querySelectorAll('th')].find((t) => t.textContent === key)!;
  return th.nextElementSibling as HTMLElement;
};
const attrs = (a: Element): Record<string, string | null> => ({
  link: a.getAttribute('data-throng-link'),
  target: a.getAttribute('data-throng-target'),
  title: a.getAttribute('title'),
  class: a.getAttribute('class'),
  rel: a.getAttribute('rel'),
});

describe('links in a scalar value (FR-088)', () => {
  it('links a bare web URL, and the link is the very one the body draws for the same text', async () => {
    const host = await draw(`${fm('home: https://example.com/start')}Body: https://example.com/start`);
    const inTable = cell(host, 'home').querySelector('a');
    const inBody = host.querySelector('p a');
    expect(inTable).not.toBeNull();
    expect(inTable!.textContent).toBe('https://example.com/start');
    expect(attrs(inTable!)).toEqual(attrs(inBody!));
  });

  it('links a Markdown link by its text', async () => {
    const host = await draw(fm('site: "[the docs](https://example.com/docs)"'));
    const a = cell(host, 'site').querySelector('a');
    expect(a?.textContent).toBe('the docs');
    expect(a?.getAttribute('data-throng-target')).toBe('https://example.com/docs');
  });

  it('links a GitHub URL', async () => {
    const host = await draw(fm('repo: https://github.com/owner/repo/issues/12'));
    expect(cell(host, 'repo').querySelector('a')?.getAttribute('data-throng-target')).toBe(
      'https://github.com/owner/repo/issues/12',
    );
  });

  it('links a wikilink and an aliased one as the body does, indexed in document order before the body’s', async () => {
    const resolveWikiTargets = vi.fn().mockResolvedValue({ resolved: [null, null, null] });
    const host = await draw(`${fm('see: "[[Note]]"', 'also: "[[Other|the alias]]"')}Body [[Third]]`, { resolveWikiTargets });
    const first = cell(host, 'see').querySelector('a');
    const second = cell(host, 'also').querySelector('a');
    expect(first?.textContent).toBe('Note');
    expect(second?.textContent).toBe('the alias');
    expect(first?.getAttribute('data-throng-wiki-index')).toBe('0');
    expect(second?.getAttribute('data-throng-wiki-index')).toBe('1');
    expect(host.querySelector('p a')?.getAttribute('data-throng-wiki-index')).toBe('2');
    await waitFor(() =>
      expect(resolveWikiTargets).toHaveBeenCalledWith([
        { path: 'Note', rooted: false },
        { path: 'Other', rooted: false },
        { path: 'Third', rooted: false },
      ]),
    );
  });

  it('links nothing for a #123 shorthand, because the body does not resolve one either', async () => {
    const host = await draw(`${fm('fixes: "#123"')}Body #123`);
    expect(cell(host, 'fixes').querySelector('a')).toBeNull();
    expect(host.querySelector('p a')).toBeNull();
  });
});

describe('a sequence value (FR-089)', () => {
  it('links each item that holds a link, and leaves the others as text', async () => {
    const host = await draw(fm('links:', '  - https://a.example/one', '  - just words', '  - "[b](https://b.example/two)"'));
    const items = [...cell(host, 'links').querySelectorAll('li')];
    expect(items).toHaveLength(3);
    expect(items[0]!.querySelector('a')?.getAttribute('data-throng-target')).toBe('https://a.example/one');
    expect(items[1]!.querySelector('a')).toBeNull();
    expect(items[1]!.textContent).toBe('just words');
    expect(items[2]!.querySelector('a')?.getAttribute('data-throng-target')).toBe('https://b.example/two');
  });

  it('keeps a sequence with no link exactly as before: its YAML source in a code block', async () => {
    const host = await draw(fm('tags:', '  - alpha', '  - beta'));
    const c = cell(host, 'tags');
    expect(c.querySelector('li')).toBeNull();
    expect(c.querySelector('pre code')?.textContent).toBe('- alpha\n- beta');
  });
});

describe('what stays plain (FR-092, FR-091)', () => {
  it('renders a value with no link as plain text, and keys as plain text even when they look like links', async () => {
    const host = await draw(fm('title: A plain *title*', '"https://example.com/key": value'));
    expect(cell(host, 'title').innerHTML).toBe('A plain *title*');
    expect(cell(host, 'title').querySelector('em')).toBeNull();
    const keys = [...table(host).querySelectorAll('th')].map((t) => t.textContent);
    expect(keys).toContain('https://example.com/key');
    expect(table(host).querySelectorAll('th a')).toHaveLength(0);
  });

  it('leaves a scheme the body refuses as text', async () => {
    const host = await draw(fm('evil: "[click](javascript:alert(1))"'));
    expect(table(host).querySelector('a')).toBeNull();
    expect(cell(host, 'evil').textContent).toContain('click');
  });
});

describe('invalid or non-mapping front matter (FR-093)', () => {
  it('stays an unlinked code block', async () => {
    const host = await draw(fm('key: [unclosed https://example.com'));
    expect(host.querySelector('table.preview-markdown__front-matter')).toBeNull();
    expect(host.querySelector('pre code')).not.toBeNull();
    expect(host.querySelector('pre a')).toBeNull();
  });

  it('keeps a front matter that is a sequence as a code block', async () => {
    const host = await draw(fm('- https://example.com', '- other'));
    expect(host.querySelector('pre a')).toBeNull();
    expect(host.querySelector('table.preview-markdown__front-matter')).toBeNull();
  });
});

describe('with Show front matter off (FR-094)', () => {
  it('draws no front matter at all, linked or not, and the body is unchanged', async () => {
    const host = await draw(`${fm('home: https://example.com/start')}# Title`, {
      providerSettings: { enabled: true, showFrontMatter: false },
    });
    await waitFor(() => expect(host.querySelector('h1')).not.toBeNull(), COLD);
    expect(host.querySelector('table')).toBeNull();
    expect(host.querySelector('a')).toBeNull();
  });
});

describe('relative targets (067 FR-123)', () => {
  it('links a Markdown link with a relative target as the body links the same one', async () => {
    const host = await draw(`${fm('spec: "[the spec](docs/spec.md)"')}[the spec](docs/spec.md)`);
    const inTable = cell(host, 'spec').querySelector('a');
    const inBody = host.querySelector('p a');
    expect(inTable?.textContent).toBe('the spec');
    expect(inTable?.getAttribute('data-throng-link')).not.toBeNull();
    expect(attrs(inTable!)).toEqual(attrs(inBody!));
  });

  it('links a bare scalar that is a relative path, by the path itself, as the body links it', async () => {
    const host = await draw(`${fm('plan: docs/plan.md')}[docs/plan.md](docs/plan.md)`);
    const inTable = cell(host, 'plan').querySelector('a');
    expect(inTable?.textContent).toBe('docs/plan.md');
    expect(attrs(inTable!)).toEqual(attrs(host.querySelector('p a')!));
  });

  it('links ./ and ../ paths, and a bare file name with an extension', async () => {
    const host = await draw(fm('a: ./notes/a.md', 'b: ../up/b.md', 'c: NOTES.txt'));
    for (const key of ['a', 'b', 'c']) expect(cell(host, key).querySelector('a'), key).not.toBeNull();
    expect(cell(host, 'c').querySelector('a')?.textContent).toBe('NOTES.txt');
  });

  it('takes a bare name whose extension is also a domain suffix for the file it names, not a web address', async () => {
    const host = await draw(`${fm('next: overview.md')}[overview.md](<overview.md>)`);
    const a = cell(host, 'next').querySelector('a');
    expect(a?.getAttribute('data-throng-target') ?? '').not.toMatch(/^https?:/);
    expect(attrs(a!)).toEqual(attrs(host.querySelector('p a')!));
  });

  it('links each item of a sequence that is a relative path', async () => {
    const host = await draw(fm('files:', '  - docs/one.md', '  - plain words', '  - two.txt'));
    const items = [...cell(host, 'files').querySelectorAll('li')];
    expect(items.map((li) => li.querySelector('a') !== null)).toEqual([true, false, true]);
  });

  it('leaves text that is not a path alone: whitespace, a version, a word, a number', async () => {
    const host = await draw(
      fm('a: has some words.txt', 'b: 1.2.3', 'c: draft', 'd: 42', 'e: "see docs/x.md"', 'f: v2.0', 'g: "a.1b"'),
    );
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) expect(cell(host, key).querySelector('a'), key).toBeNull();
  });

  it('does not take a web URL for a path, and leaves it as the web link it was', async () => {
    const host = await draw(fm('home: https://example.com/a/b.md'));
    const a = cell(host, 'home').querySelector('a');
    expect(a?.getAttribute('data-throng-target')).toBe('https://example.com/a/b.md');
  });

  it('does not look at the disk: a path to nothing is a link all the same', async () => {
    const host = await draw(fm('gone: no/such/file.md'));
    expect(cell(host, 'gone').querySelector('a')).not.toBeNull();
  });

  it('keeps keys plain, and a path in a key is not linked', async () => {
    const host = await draw(fm('docs/key.md: value'));
    expect(table(host).querySelectorAll('th a')).toHaveLength(0);
  });
});
