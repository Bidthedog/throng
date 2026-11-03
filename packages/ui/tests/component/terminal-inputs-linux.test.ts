import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { linuxHostTraits } from '@throng/core';
import { withHostTraits } from '@throng/core/testing';
import { TerminalInputs } from '../../src/renderer/panel-type/terminal-inputs.js';

/** Layer: component. Whether a control is drawn needs a DOM, and no app (062 FR-008). */
describe('the Terminal form on Linux', () => {
  const draw = (): void => {
    render(createElement(TerminalInputs, { values: {}, flavours: [], elevated: false, onChange: () => {} }));
  };

  it('offers no elevation, because Linux has none to offer', () => {
    withHostTraits(linuxHostTraits('/run/x'), draw);
    expect(screen.queryByText('Run as administrator')).toBeNull();
  });

  it('still offers it on Windows', () => {
    draw();
    expect(screen.getByText('Run as administrator')).toBeTruthy();
  });
});
