/**
 * 067 T139 (FR-132, SC-015; defect against FR-123 and FR-090) — a front matter value that is wholly a link
 * the editor's grammar recognises renders as a link and follows as the editor follows it.
 *
 * The fixture copies every front matter value of the maintainer's hand-test file (`link-types.md`, MT-14
 * checks the real one) so this stays honest about the forms in use. Before this, `./test.ts:3`,
 * `./test.ts:3:5` and `./research.md:10-20` drew an `<a>` with no destination, `./test.ts(3,5)` named a
 * file called `test.ts(3,5)`, and a home, rooted, absolute or `file:` path, `tel:`, `slack:` and a
 * same-document `#anchor` drew no link at all.
 *
 * The forms the table already linked (web, mailto, plain relative paths, wikilinks) keep exactly the
 * link they had; the body is not touched.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { EditorOpenListener } from '../../src/renderer/editor/editor-open.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { COLD, ROOT, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const LINK_TYPES_FRONT_MATTER = `# Web (http/https)
web_https: "https://example.com"
web_http: "http://example.com"
web_path_query_fragment: "https://developer.mozilla.org/en-US/docs/Web/HTTP?x=1#see_also"
web_balanced_parens: "https://en.wikipedia.org/wiki/Bash_(Unix_shell)"
loopback_localhost: "http://localhost:5173/"
loopback_ipv4: "http://127.0.0.1:8080/"

# GitHub
github_repo: "https://github.com/microsoft/vscode"
github_issue: "https://github.com/microsoft/vscode/issues/1"
github_pull: "https://github.com/microsoft/vscode/pull/11"
github_file_line: "https://github.com/microsoft/vscode/blob/main/README.md#L1"
github_style_line_anchor: "./test.ts#L3"
github_style_line_range: "./test.ts#L2-L5"

# Protocol (default allowlist: mailto, tel, slack)
mailto: "mailto:someone@example.com"
bare_email: "someone@example.com"
tel: "tel:+441234567890"
slack: "slack://open"

# Local paths, relative to this file
relative_bare: "research.md"
relative_dot: "./mermaid.md"
relative_subfolder: "sample-documents/sample.pdf"
relative_parent: "../UPPER TEST/test.md"
rooted_project: "/syntax-showcase2.md"
home_relative: "~/.bashrc"
absolute: "/data/storage/git/throng_tests/UPPER TEST/test.ts"
file_uri: "file:///data/storage/git/throng_tests/UPPER%20TEST/test.mmd"

# Local paths with a position
path_line: "./test.ts:3"
path_line_column: "./test.ts:3:5"
path_line_range: "./research.md:10-20"
path_paren_position: "./test.ts(3,5)"

# Local, binary / non-text targets
image: "sample-documents/sample.png"
office: "sample-documents/sample.docx"
media: "sample-documents/sample.mp4"
html: "sample-documents/sample.html"

# Wikilinks (Obsidian) — quoted so YAML keeps them as strings
wikilink: "[[research]]"
wikilink_extension: "[[test.ts]]"
wikilink_heading: "[[mermaid#2. System Context]]"
wikilink_alias: "[[research|Research notes]]"
wikilink_heading_alias: "[[mermaid#4. Checkout Flow|Checkout]]"
wikilink_block_ref: "[[research#^block]]"
wikilink_rooted: "[[/syntax-showcase2]]"
wikilink_subfolder: "[[sample-documents/sample.html]]"
wikilink_same_doc_heading: "[[#Wikilinks]]"
embed: "![[sample-documents/sample.png]]"

# Same-document anchor
heading_anchor: "#local-links"`;

const PROJECT_FILE = 'D:/proj/UPPER TEST/link-types.md';
const BODY = 'Body tel:+441234567890 and slack://open and ./test.ts:3 and ~/.bashrc and /syntax-showcase2.md';

const baseProps = (text: string, extra: Partial<PreviewBodyProps> = {}): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: PROJECT_FILE,
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

async function draw(text: string, extra: Partial<PreviewBodyProps> = {}): Promise<HTMLElement> {
  render(createElement(MarkdownBody, baseProps(text, extra)));
  const host = screen.getByTestId('preview-markdown-p1');
  await waitFor(() => expect(host.querySelector('table, pre, p, h1')).not.toBeNull(), COLD);
  return host;
}

const doc = (...lines: string[]): string => `---\n${lines.join('\n')}\n---\n\n`;
const cell = (host: HTMLElement, key: string): HTMLElement => {
  const th = [...host.querySelectorAll('table.preview-markdown__front-matter th')].find((t) => t.textContent === key)!;
  return th.nextElementSibling as HTMLElement;
};
const linkIn = (host: HTMLElement, key: string): Record<string, unknown> | null => {
  const raw = cell(host, key).querySelector('a')?.getAttribute('data-throng-link');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

afterEach(() => vi.restoreAllMocks());

describe('every whole-value link form of the editor is a link (FR-132, SC-015)', () => {
  const editor = (text: string, extra: Record<string, unknown> = {}) => ({ kind: 'editor', text, ...extra });

  it.each([
    // The defect: drawn as an <a> with no destination, or as the wrong file.
    ['path_line', editor('./test.ts', { position: { line: 3 } })],
    ['path_line_column', editor('./test.ts', { position: { line: 3, column: 5 } })],
    ['path_line_range', editor('./research.md', { position: { line: 10 } })],
    ['path_paren_position', editor('./test.ts', { position: { line: 3, column: 5 } })],
    // Drawn as plain text.
    ['relative_parent', editor('../UPPER TEST/test.md')],
    ['rooted_project', editor('/syntax-showcase2.md')],
    ['home_relative', editor('~/.bashrc')],
    ['absolute', editor('/data/storage/git/throng_tests/UPPER TEST/test.ts')],
    ['file_uri', editor('file:///data/storage/git/throng_tests/UPPER%20TEST/test.mmd')],
    ['tel', editor('tel:+441234567890', { protocol: true })],
    ['slack', editor('slack://open', { protocol: true })],
    ['github_style_line_anchor', editor('./test.ts', { position: { line: 3 } })],
    ['heading_anchor', { kind: 'heading', fragment: 'local-links' }],
  ])('%s', async (key, expected) => {
    const host = await draw(`${doc(LINK_TYPES_FRONT_MATTER)}${BODY}`);
    expect(linkIn(host, key)).toEqual(expected);
  });

  it('a link that has a destination names it on hover, as the editor’s hover does', async () => {
    const host = await draw(doc(LINK_TYPES_FRONT_MATTER));
    const a = cell(host, 'path_line').querySelector('a')!;
    expect(a.textContent).toBe('./test.ts:3');
    expect(a.getAttribute('title')).toBe('./test.ts:3');
    expect(a.getAttribute('role')).toBe('link');
    expect(a.getAttribute('tabindex')).toBe('0');
  });

  it('the forms the table already linked keep the link they had', async () => {
    const host = await draw(doc(LINK_TYPES_FRONT_MATTER));
    for (const key of ['web_https', 'web_http', 'web_path_query_fragment', 'loopback_localhost', 'github_repo']) {
      expect(linkIn(host, key)?.kind, key).toBe('external');
    }
    expect(linkIn(host, 'mailto')?.kind).toBe('external');
    for (const key of ['relative_bare', 'relative_dot', 'relative_subfolder', 'image', 'office', 'media', 'html']) {
      expect(linkIn(host, key)?.kind, key).toBe('file');
    }
    for (const key of ['wikilink', 'wikilink_alias', 'wikilink_heading']) {
      expect(cell(host, key).querySelector('a'), key).not.toBeNull();
    }
  });

  it('a sentence, or a value with spaces that does not start like a path, stays text', async () => {
    const host = await draw(
      doc(
        'a: "see ./test.ts:3 for details"',
        'b: has some words.txt',
        'c: "see docs/x.md"',
        'd: "open ~/.bashrc please"',
        'e: "tel:+441234567890 is my number"',
        'f: "../up/a note.md and more"',
      ),
    );
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) expect(cell(host, key).querySelector('a'), key).toBeNull();
  });

  it('a value with spaces that starts like a path and ends in a dotted extension is a path, position or not', async () => {
    const host = await draw(
      doc('a: "./my notes/a.md"', 'b: "../a b/c.md:7"', 'c: "~/my dir/x.txt"', 'd: "C:\\\\Users\\\\a b\\\\x.txt"', 'e: "/a b/c d"'),
    );
    expect(linkIn(host, 'a')).toEqual({ kind: 'editor', text: './my notes/a.md' });
    expect(linkIn(host, 'b')).toEqual({ kind: 'editor', text: '../a b/c.md', position: { line: 7 } });
    expect(linkIn(host, 'c')).toEqual({ kind: 'editor', text: '~/my dir/x.txt' });
    expect(linkIn(host, 'd')?.kind).toBe('editor');
    // No dotted extension at the end: not a path once it has whitespace.
    expect(cell(host, 'e').querySelector('a')).toBeNull();
  });

  it('each item of a sequence is judged on its own', async () => {
    const host = await draw(doc('files:', '  - /syntax-showcase2.md', '  - plain words', '  - ./test.ts:3'));
    const items = [...cell(host, 'files').querySelectorAll('li')];
    expect(items.map((li) => li.querySelector('a') !== null)).toEqual([true, false, true]);
    expect(JSON.parse(items[2]!.querySelector('a')!.getAttribute('data-throng-link')!)).toEqual(
      editor('./test.ts', { position: { line: 3 } }),
    );
  });

  it('a document cannot plant the link by writing the attribute itself', async () => {
    const host = await draw(
      '<a data-throng-fm-link="forged.%7B%22text%22%3A%22%2Fetc%2Fpasswd%22%7D">forged</a>\n\nplain',
    );
    const a = host.querySelector('a');
    expect(a?.getAttribute('data-throng-link') ?? null).toBeNull();
    expect(a?.hasAttribute('data-throng-fm-link') ?? false).toBe(false);
  });
});

describe('the body is unchanged (FR-132)', () => {
  it('draws none of the front matter forms as links in the body', async () => {
    const host = await draw(`${doc('x: 1')}${BODY}`);
    expect(host.querySelector('p a')).toBeNull();
    expect(host.querySelector('p')?.textContent).toBe(BODY);
  });
});

describe('following (FR-132 through the editor’s route, FR-131)', () => {
  it('Ctrl+click hands the link as classified to the preview’s follow', async () => {
    const onFollow = vi.fn();
    const host = await draw(doc(LINK_TYPES_FRONT_MATTER), { onFollow });
    fireEvent.click(cell(host, 'path_line_column').querySelector('a')!, { ctrlKey: true });
    expect(onFollow).toHaveBeenCalledWith({ kind: 'editor', text: './test.ts', position: { line: 3, column: 5 } });
    onFollow.mockClear();
    fireEvent.click(cell(host, 'path_line_column').querySelector('a')!);
    expect(onFollow).not.toHaveBeenCalled();
  });
});

describe('in a mounted preview (FR-132, FR-131)', () => {
  let m: MountedPreviewWindow | undefined;
  const BINARY = { action: 'refuse', reason: 'binary' };

  async function mountWith(settings: Record<string, unknown>): Promise<MountedPreviewWindow> {
    const text = `${doc('logo: /img/logo.png', 'at: ./test.ts:3', 'phone: tel:+441234567890')}# Title`;
    m = await mountMarkdownPreview(text, `${ROOT}/README.md`, {
      settings,
      extras: [createElement(EditorOpenListener, { key: 'open' })],
    });
    m.openInto.mockImplementation(() => Promise.resolve(BINARY));
    m.links.open.mockResolvedValue({ ok: true });
    m.links.follow.mockResolvedValue({
      kind: 'openInThrong',
      link: { path: `${ROOT}/img/logo.png`, kind: 'file', inProject: true, executable: false, preview: 'none' },
    });
    const linkUri = { openExternal: vi.fn() };
    Object.assign(window.throng as object, { linkUri });
    Object.assign((window.throng as unknown as { editor: object }).editor, { load: () => new Promise(() => {}) });
    await screen.findByText('/img/logo.png', {}, COLD);
    return m;
  }

  beforeEach(() => __resetPreviewStore());
  afterEach(() => {
    m?.unmount();
    m = undefined;
    document.body.replaceChildren();
  });

  it('a link to a binary file, with the preference on, goes to the OS default program', async () => {
    const p = await mountWith({ explorer: { openUnsupportedInOs: true } });
    fireEvent.click(screen.getByText('/img/logo.png'), { ctrlKey: true });
    await waitFor(() => expect(p.links.open).toHaveBeenCalledTimes(1));
    expect(p.links.follow).toHaveBeenCalledWith(
      expect.objectContaining({ text: '/img/logo.png', kind: 'detectedPath', baseDirectory: ROOT, panelId: p.id }),
    );
    expect(p.links.open.mock.calls[0]![0]).toMatchObject({ text: '/img/logo.png' });
  });

  it('with the preference off the editor is asked, and the OS is not', async () => {
    const p = await mountWith({ explorer: { openUnsupportedInOs: false } });
    fireEvent.click(screen.getByText('/img/logo.png'), { ctrlKey: true });
    await waitFor(() => expect(p.links.follow).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(p.links.open).not.toHaveBeenCalled();
  });

  it('a position is split off the request, as the editor does', async () => {
    const p = await mountWith({});
    fireEvent.click(screen.getByText('./test.ts:3'), { ctrlKey: true });
    await waitFor(() => expect(p.links.follow).toHaveBeenCalledTimes(1));
    expect(p.links.follow.mock.calls[0]![0]).toMatchObject({ text: './test.ts', kind: 'detectedPath' });
  });

  it('a protocol off the user’s allowlist is not a link, as in the editor', async () => {
    await mountWith({ editor: { links: { protocolAllowlist: ['slack'] } } });
    expect(screen.getByText('tel:+441234567890').closest('a')).toBeNull();
  });

  it('an allowlisted protocol link leaves through the editor’s protocol route', async () => {
    await mountWith({});
    fireEvent.click(screen.getByText('tel:+441234567890'), { ctrlKey: true });
    await waitFor(() =>
      expect((window.throng as unknown as { linkUri: { openExternal: ReturnType<typeof vi.fn> } }).linkUri.openExternal).toHaveBeenCalledWith(
        'tel:+441234567890',
      ),
    );
  });
});
