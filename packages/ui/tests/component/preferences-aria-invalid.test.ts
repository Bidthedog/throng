/**
 * Every control that shows an invalid state says so with `aria-invalid="true"` (056 FR-007, research R3).
 *
 * Layer: component — the attribute is the one signal a FOLDED heading can observe from outside its rows
 * (the warning marker reads `[aria-invalid="true"]`), so each control family has to carry it. Number, Text,
 * JsonArray and the colour field already did; these cases pin that, and MapControl's is the one that was
 * missing. Asserted on the attribute's value, not its presence: React renders `aria-invalid="false"` for a
 * valid control, which is not an invalid one.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { type FieldDescriptor } from '@throng/core';
import { SettingControl } from '../../src/renderer/preferences/form-controls.js';
import { MapControl } from '../../src/renderer/preferences/map-control.js';
import { ColourField } from '../../src/renderer/common/colour-picker.js';

const invalidOf = (el: HTMLElement): boolean => el.getAttribute('aria-invalid') === 'true';

const numberField = {
  key: 'x.count',
  label: 'Count',
  description: 'd',
  group: 'G',
  control: 'number',
  min: 1,
} as FieldDescriptor;

const textField = {
  key: 'x.name',
  label: 'Name',
  description: 'd',
  group: 'G',
  control: 'text',
  validate: (raw: string) => (raw.includes('!') ? 'No bangs' : null),
} as FieldDescriptor;

const arrayField = {
  key: 'x.list',
  label: 'List',
  description: 'd',
  group: 'G',
  control: 'array',
} as FieldDescriptor;

describe('NumberControl', () => {
  it('is aria-invalid after a non-number is committed, and valid again after editing', async () => {
    const user = userEvent.setup();
    render(createElement(SettingControl, { descriptor: numberField, value: 5, onCommit: vi.fn() }));
    const input = screen.getByTestId('control-x.count');
    expect(invalidOf(input)).toBe(false);
    await user.clear(input);
    await user.type(input, 'abc');
    await user.tab();
    expect(invalidOf(input)).toBe(true);
    await user.clear(input);
    expect(invalidOf(input)).toBe(false);
  });
});

describe('TextControl', () => {
  it('is aria-invalid while the descriptor rejects the text, and valid once edited', async () => {
    const user = userEvent.setup();
    render(createElement(SettingControl, { descriptor: textField, value: 'ok', onCommit: vi.fn() }));
    const input = screen.getByTestId('control-x.name');
    expect(invalidOf(input)).toBe(false);
    await user.clear(input);
    await user.type(input, 'bad!');
    await user.tab();
    expect(invalidOf(input)).toBe(true);
    await user.type(input, 'x');
    expect(invalidOf(input)).toBe(false);
  });
});

describe('JsonArrayControl', () => {
  it('is aria-invalid for text that is not a JSON array', () => {
    render(
      createElement(SettingControl, { descriptor: arrayField, value: [{ a: 1 }], onCommit: vi.fn() }),
    );
    const area = screen.getByTestId('control-x.list');
    expect(invalidOf(area)).toBe(false);
    fireEvent.change(area, { target: { value: '{nope' } });
    fireEvent.blur(area);
    expect(invalidOf(area)).toBe(true);
    fireEvent.change(area, { target: { value: '[]' } });
    expect(invalidOf(area)).toBe(false);
  });
});

describe('the colour field', () => {
  it('is aria-invalid for an unparseable colour committed on blur', async () => {
    const user = userEvent.setup();
    render(createElement(ColourField, { value: '#112233', onCommit: vi.fn(), testId: 'colour' }));
    const hex = screen.getByTestId('colour-hex');
    expect(invalidOf(hex)).toBe(false);
    await user.clear(hex);
    await user.type(hex, 'not a colour');
    await user.tab();
    expect(invalidOf(hex)).toBe(true);
  });
});

describe('MapControl', () => {
  const byExtension = {
    key: 'editor.languageByExtension',
    label: 'Language by extension',
    control: 'map',
    type: 'object',
  } as FieldDescriptor;

  it('marks the new-key input aria-invalid while a refused key shows its error', async () => {
    const user = userEvent.setup();
    render(createElement(MapControl, { descriptor: byExtension, value: {}, onCommit: vi.fn() }));
    const input = screen.getByTestId(`map-new-key-${byExtension.key}`);
    expect(invalidOf(input)).toBe(false);
    await user.type(input, 'foo');
    await user.click(screen.getByTestId(`map-add-${byExtension.key}`));
    expect(screen.getByTestId(`map-error-${byExtension.key}`)).toBeInTheDocument();
    expect(invalidOf(input)).toBe(true);
    await user.type(input, 'x');
    expect(invalidOf(input)).toBe(false);
  });

  it('marks a records row that arrived broken from the file', () => {
    // The shape of `terminals.flavours`, which lives in a registry the package does not export.
    const records = {
      key: 'x.flavours',
      label: 'Flavours',
      description: 'd',
      group: 'G',
      control: 'records',
      idKey: 'id',
      itemNoun: 'flavour',
      columns: [
        { key: 'label', label: 'Label', control: 'text' },
        { key: 'file', label: 'Executable', control: 'text' },
      ],
    } as FieldDescriptor;
    // An entry with an id and nothing else is not a flavour: the row says so in its own cell (C17).
    const idKey = records.idKey ?? 'id';
    const { container } = render(
      createElement(MapControl, {
        descriptor: records,
        value: [{ [idKey]: 'broken' }],
        onCommit: vi.fn(),
      }),
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    // A `<tr>` has no aria-invalid in ARIA, so the problem row uses a dedicated scan hook instead.
    const problemRow = container.querySelector('[data-pref-invalid]');
    expect(problemRow).not.toBeNull();
    expect(problemRow!.tagName).toBe('TR');
    expect(container.querySelector('[aria-invalid="true"]'), 'aria-invalid stays on inputs only').toBeNull();
  });

  it('does not mark the new-id input invalid for a DRAFT row’s error (only for the id itself)', async () => {
    const user = userEvent.setup();
    const records = {
      key: 'x.flavours',
      label: 'Flavours',
      description: 'd',
      group: 'G',
      control: 'records',
      idKey: 'id',
      itemNoun: 'flavour',
      columns: [
        { key: 'label', label: 'Label', control: 'text' },
        { key: 'file', label: 'Executable', control: 'text' },
      ],
    } as FieldDescriptor;
    const { container } = render(
      createElement(MapControl, { descriptor: records, value: [], onCommit: vi.fn() }),
    );
    const newId = screen.getByTestId('flavour-new-id');
    // A duplicate/empty id is refused outright: that error IS about the new-id value.
    await user.click(screen.getByTestId('flavour-add'));
    expect(invalidOf(newId)).toBe(true);
    await user.type(newId, 'fresh');
    expect(invalidOf(newId), 'editing the id clears it').toBe(false);
    // A good id creates a draft that still lacks an executable: its error belongs to the draft row.
    await user.click(screen.getByTestId('flavour-add'));
    expect(screen.getByTestId('flavour-error')).toBeInTheDocument();
    expect(invalidOf(screen.getByTestId('flavour-new-id'))).toBe(false);
    expect(container.querySelector('[data-pref-invalid]')).not.toBeNull();
  });
});
