/**
 * 069 FR-022 — the About window credits the vendored Lucide icons, and a package that carries its own
 * licence text offers it in an expandable block.
 *
 * Layer: component — what the About window renders from the third-party list main hands it. That the
 * list carries Lucide at all is `generate-licenses.test.ts`'s (a script over files).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('offers the licence text of a package that carries one, collapsed until opened', async () => {
    const box = await mount();
    const toggle = within(box).getByTestId('about-licence-text-toggle-lucide');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(box).queryByTestId('about-licence-text-lucide')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(box).getByTestId('about-licence-text-lucide').textContent).toBe(LUCIDE_TEXT);

    fireEvent.click(toggle);
    expect(within(box).queryByTestId('about-licence-text-lucide')).toBeNull();
  });

  it('offers no toggle for a package without licence text', async () => {
    const box = await mount();
    expect(within(box).queryByTestId('about-licence-text-toggle-react')).toBeNull();
  });
});
