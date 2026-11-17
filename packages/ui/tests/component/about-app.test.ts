/**
 * 069 FR-022 — the About window credits the vendored Lucide icons as it does every other package: name,
 * version and licence link, with no block of licence text of its own (FR-069).
 *
 * Layer: component — what the About window renders from the third-party list main hands it. That the
 * list carries Lucide at all is `generate-licenses.test.ts`'s (a script over files).
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AboutApp } from '../../src/renderer/about/about-app.js';

const LUCIDE_TEXT = 'ISC License\n\nCopyright (c) for portions of Lucide are held by Cole Bemis 2013-2022.';

const list = [
  { name: 'react', version: '19.0.0', license: 'MIT', licenseUrl: 'https://spdx.org/licenses/MIT.html', projectUrl: 'https://react.dev' },
  {
    name: 'lucide',
    version: '1.66.0',
    license: 'ISC',
    licenseUrl: 'https://spdx.org/licenses/ISC.html',
    projectUrl: 'https://lucide.dev',
    licenseText: LUCIDE_TEXT,
  },
];

beforeEach(() => {
  Reflect.set(window, 'throng', {
    config: { get: () => Promise.resolve({ settings: { version: 1 } }), onChange: () => () => undefined },
    about: {
      get: () => Promise.resolve({ version: '1.0.0', author: 'A', repoUrl: '', buildId: 'b', licenseText: 'AGPL' }),
      getThirdParty: () => Promise.resolve(list),
      openExternal: () => undefined,
    },
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'throng');
});

async function mount(): Promise<HTMLElement> {
  render(createElement(AboutApp));
  await waitFor(() => expect(screen.queryByTestId('about-thirdparty-loading')).toBeNull());
  return screen.getByTestId('about-thirdparty');
}

describe('third-party licence text (069 FR-022)', () => {
  it('lists Lucide with its version and licence, beside the other packages', async () => {
    const box = await mount();
    const row = within(box).getByText('lucide').closest('.about-thirdparty__row') as HTMLElement;
    expect(row).toHaveTextContent('1.66.0');
    expect(row).toHaveTextContent('ISC');
    expect(within(box).getByText('react')).toBeInTheDocument();
  });

  it('treats Lucide like every other package: a licence link, and no licence text block (FR-069)', async () => {
    const box = await mount();
    const row = within(box).getByText('lucide').closest('.about-thirdparty__row') as HTMLElement;
    expect(within(row).getByText('ISC').closest('a')).toHaveAttribute('href', 'https://spdx.org/licenses/ISC.html');
    expect(row.querySelector('button')).toBeNull();
    expect(row).not.toHaveTextContent(LUCIDE_TEXT);
  });
});
