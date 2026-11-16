/**
 * The Icons section of the Themes tab — the grid, the set picker and the user-set controls
 * (069 FR-012, FR-024 to FR-033, FR-041 to FR-048).
 *
 * Layer: component — what the section renders for a given theme and loaded sets, and the calls its
 * controls make. Which files main writes and reads is `icon-sets-ipc.test.ts`'s; this stands the
 * bridge in.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  ICON_KEYS,
  ICON_KEY_DESCRIPTIONS,
  THRONG_THEME,
  type IconKey,
  type Theme,
  type UserIconSetDto,
} from '@throng/core';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { IconSection } from '../../src/renderer/preferences/icon-section.js';
import { drawnIcon, iconMarkup } from './helpers/icon-markup.js';

const SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg>';

/** A user set as main loads it: `overrides` is what its folder holds. */
function userSet(name: string, overrides: IconKey[] = [], extra: Partial<UserIconSetDto> = {}): UserIconSetDto {
  return {
    name,
    overrides: Object.fromEntries(overrides.map((k) => [k, SVG])) as UserIconSetDto['overrides'],
    failures: {},
    unrecognised: [],
    ...extra,
  };
}

type Reply = { ok: true } | { ok: false; reason: string; message: string };

/**
 * The section over a live config store that holds `sets` and has `theme` active, with a bridge whose
 * icon-set calls are spies answering `replies`.
 */
async function mountSection(
  theme: Theme = THRONG_THEME,
  sets: UserIconSetDto[] = [],
  replies: {
    create?: Reply;
    override?: Reply[];
    reload?: Reply;
    openFolder?: Reply;
    rename?: Reply;
    remove?: Reply;
    resetIcon?: Reply;
  } = {},
) {
  const overrideReplies = [...(replies.override ?? [])];
  const iconSets = {
    create: vi.fn(() => Promise.resolve(replies.create ?? { ok: true })),
    override: vi.fn(() => Promise.resolve(overrideReplies.shift() ?? { ok: true })),
    reload: vi.fn(() => Promise.resolve(replies.reload ?? { ok: true })),
    openFolder: vi.fn(() => Promise.resolve(replies.openFolder ?? { ok: true })),
    rename: vi.fn(() => Promise.resolve(replies.rename ?? { ok: true })),
    remove: vi.fn(() => Promise.resolve(replies.remove ?? { ok: true })),
    resetIcon: vi.fn(() => Promise.resolve(replies.resetIcon ?? { ok: true })),
    onBackupsPresent: () => () => undefined,
    backupsReady: () => undefined,
  };
  Reflect.set(window, 'throng', {
    config: {
      get: () =>
        Promise.resolve({ settings: DEFAULT_APP_SETTINGS, theme, keybindings: DEFAULT_KEYBINDINGS, iconSets: sets }),
      onChange: () => () => undefined,
    },
    iconSets,
  });
  const onSetIconSet = vi.fn();
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ConfirmProvider,
        null,
        createElement(
          ConfigProvider,
          null,
          createElement(IconSection, {
            theme,
            onSetIconSet,
            onSetIconColour: () => undefined,
            folded: false,
            onToggleFold: () => undefined,
          }),
        ),
      ),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('icon-grid')).toBeInTheDocument());
  // The sets arrive on the same payload as the theme; wait for them before asserting on a set.
  if (sets.length > 0) await waitFor(() => expect(screen.getByTestId(`icon-set-option-${sets[0]!.name}`)).toBeInTheDocument());
  return { iconSets, onSetIconSet, user: userEvent.setup({ delay: null }) };
}

const withSet = (name: string): Theme => ({ ...THRONG_THEME, iconPack: name });

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'throng');
});

describe('the default set is a read-only grid (FR-012, FR-027, FR-028, FR-032)', () => {
  it('shows one row per icon key, each with its icon, key, file name and description as the hover title', async () => {
    await mountSection();

    const cells = screen.getByTestId('icon-grid').querySelectorAll('.icon-cell');
    expect(cells).toHaveLength(ICON_KEYS.length);
    for (const key of ICON_KEYS) {
      const cell = screen.getByTestId(`icon-cell-${key}`);
      expect(drawnIcon(cell.querySelector('.icon-cell__icon')), `${key} icon`).toBe(iconMarkup(key));
      expect(cell.querySelector('.icon-cell__name')).toHaveTextContent(key);
      expect(cell.querySelector('.icon-cell__file')).toHaveTextContent(`${key}.svg`);
      expect(cell, `${key} hover title`).toHaveAttribute('title', ICON_KEY_DESCRIPTIONS[key]);
    }
  });

  it('has no override input, and shows Override, Reset, Rename and Delete greyed out, saying why (FR-049)', async () => {
    await mountSection();

    expect(screen.getByTestId('icon-grid').querySelectorAll('input')).toHaveLength(0);
    for (const key of ICON_KEYS) {
      for (const id of [`icon-override-${key}`, `icon-reset-${key}`]) {
        const control = screen.getByTestId(id);
        expect(control, id).toBeDisabled();
        expect(control).toHaveAttribute('title', 'Select one of your own icon sets to use this');
      }
    }
    for (const id of ['icon-set-rename', 'icon-set-delete']) {
      expect(screen.getByTestId(id), id).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute('title', 'Select one of your own icon sets to use this');
    }
  });

  it('shows the icon colour Clear greyed out while there is no colour, and usable once there is one (FR-049)', async () => {
    await mountSection();
    expect(screen.getByTestId('icon-colour-clear')).toBeDisabled();
    cleanup();

    await mountSection({ ...THRONG_THEME, colours: { ...THRONG_THEME.colours, iconColour: '#ff0000' } });
    expect(screen.getByTestId('icon-colour-clear')).not.toBeDisabled();
  });

  it('labels its picker “Icon set”, and has no “(default glyphs)” option', async () => {
    await mountSection();

    expect(screen.getByText('Icon set')).toBeInTheDocument();
    expect(screen.queryByText('Icon pack')).toBeNull();
    const select = screen.getByTestId('icon-set-select') as HTMLSelectElement;
    expect(select.value).toBe('throng');
    expect(select).not.toHaveTextContent('default glyphs');
  });
});

describe('the picker lists the default set and every user set (FR-016, FR-029)', () => {
  it('lists throng, then each user set, with an unavailable set disabled and its reason as the title', async () => {
    await mountSection(THRONG_THEME, [userSet('mine'), userSet('broken', [], { error: 'the folder could not be read' })]);

    const select = screen.getByTestId('icon-set-select');
    expect([...select.querySelectorAll('option')].map((o) => o.value)).toEqual(['throng', 'mine', 'broken']);
    expect(screen.getByTestId('icon-set-option-mine')).not.toBeDisabled();
    const broken = screen.getByTestId('icon-set-option-broken');
    expect(broken).toBeDisabled();
    expect(broken).toHaveAttribute('title', 'the folder could not be read');
  });

  it('selecting a set applies it to the theme, reloads the sets from disk and says so in a toast (FR-041, FR-046)', async () => {
    const { user, onSetIconSet, iconSets } = await mountSection(THRONG_THEME, [userSet('mine')]);

    await user.selectOptions(screen.getByTestId('icon-set-select'), 'mine');

    expect(onSetIconSet).toHaveBeenCalledWith('mine');
    await waitFor(() => expect(iconSets.reload).toHaveBeenCalledWith()); // after the theme write settles
    const hint = await screen.findByTestId('icon-set-notice-hint');
    expect(hint).toHaveTextContent(/mine/);
    expect(within(screen.getByTestId('icon-set-row')).queryByTestId('icon-set-notice-hint')).toBeNull();
  });

  it('marks every user set in the list with an asterisk, and not the default set (FR-048)', async () => {
    await mountSection(THRONG_THEME, [userSet('mine'), userSet('broken', [], { error: 'unreadable' })]);

    expect(screen.getByTestId('icon-set-option-throng')).toHaveTextContent(/^throng$/);
    expect(screen.getByTestId('icon-set-option-mine')).toHaveTextContent(/^mine \*$/);
    expect(screen.getByTestId('icon-set-option-broken')).toHaveTextContent(/^broken \* \(unavailable\)$/);
  });

  it('selecting the default set clears the theme’s set, and reloads nothing', async () => {
    const { user, onSetIconSet, iconSets } = await mountSection(withSet('mine'), [userSet('mine')]);

    await user.selectOptions(screen.getByTestId('icon-set-select'), 'throng');

    expect(onSetIconSet).toHaveBeenCalledWith(undefined);
    expect(iconSets.reload).not.toHaveBeenCalled();
  });

  it('says why a selected set could not be loaded, in a toast rather than in the row (FR-016, FR-046)', async () => {
    await mountSection(withSet('broken'), [userSet('broken', [], { error: 'the folder could not be read' })]);

    expect(await screen.findByTestId('icon-set-error')).toHaveTextContent('the folder could not be read');
    expect(within(screen.getByTestId('icon-set-row')).queryByTestId('icon-set-error')).toBeNull();
  });

  it('shows a selected set whose folder is gone as unavailable, selected, with the reason (FR-016)', async () => {
    await mountSection(withSet('gone'), [userSet('mine')]);

    const select = screen.getByTestId('icon-set-select') as HTMLSelectElement;
    expect(select.value).toBe('gone');
    const option = screen.getByTestId('icon-set-option-gone');
    expect(option).toBeDisabled();
    expect(option).toHaveTextContent('gone (unavailable)');
    const error = await screen.findByTestId('icon-set-error');
    expect(error).toHaveTextContent(/gone/);
    expect(error).toHaveTextContent(/not found/i);
    expect(error).toHaveTextContent(/default/i);
  });

  it('shows no unavailable set for a theme on the default set', async () => {
    await mountSection(THRONG_THEME, [userSet('mine')]);

    expect(screen.queryByTestId('icon-set-error')).toBeNull();
    expect((screen.getByTestId('icon-set-select') as HTMLSelectElement).value).toBe('throng');
  });
});

describe('the Icon set row: its controls and their order (FR-024, FR-028 to FR-030, FR-041, FR-047)', () => {
  it('offers Copy, Open folder and Reload as titled icon controls on a user set', async () => {
    const { user, iconSets } = await mountSection(withSet('mine'), [userSet('mine')]);

    const copy = screen.getByTestId('icon-set-copy');
    const open = screen.getByTestId('icon-set-open-folder');
    const reload = screen.getByTestId('icon-set-reload');
    expect(drawnIcon(copy)).toBe(iconMarkup('copy'));
    // T041 (SC-006): the name README.txt and docs/preferences.md use for this control.
    expect(copy).toHaveAttribute('title', 'New set from this set');
    expect(drawnIcon(open)).toBe(iconMarkup('folderOpen'));
    expect(drawnIcon(reload)).toBe(iconMarkup('refresh'));
    expect(reload).toHaveAttribute('title', 'Reload the icon sets from disk');
    for (const control of [copy, open, reload]) {
      expect(control.getAttribute('title') ?? '').not.toBe('');
      expect(control.textContent?.trim()).toBe('');
    }

    await user.click(open);
    expect(iconSets.openFolder).toHaveBeenCalledWith('mine');
    await user.click(reload);
    expect(iconSets.reload).toHaveBeenCalledWith();
  });

  it('offers the same three on the default set: Open folder opens the icon sets folder itself', async () => {
    const { user, iconSets } = await mountSection(THRONG_THEME, [userSet('mine')]);

    expect(screen.getByTestId('icon-set-copy')).toBeInTheDocument();
    expect(screen.getByTestId('icon-set-open-folder')).toHaveAttribute('title', 'Open the icon sets folder');
    await user.click(screen.getByTestId('icon-set-open-folder'));
    expect(iconSets.openFolder).toHaveBeenCalledWith(undefined);
    await user.click(screen.getByTestId('icon-set-reload'));
    expect(iconSets.reload).toHaveBeenCalledWith();
  });

  it('puts the picker last, the controls every selection has before it, and a user set\'s own before those', async () => {
    await mountSection(withSet('mine'), [userSet('mine')]);

    const row = screen.getByTestId('icon-set-row');
    expect([...row.children].map((c) => c.getAttribute('data-testid'))).toEqual([
      'icon-set-user-controls',
      'icon-set-always-controls',
      'icon-set-select',
    ]);
    const user = screen.getByTestId('icon-set-user-controls');
    expect(drawnIcon(within(user).getByTestId('icon-set-rename'))).toBe(iconMarkup('rename'));
    expect(drawnIcon(within(user).getByTestId('icon-set-delete'))).toBe(iconMarkup('destroy'));
    expect(row.querySelector('p')).toBeNull();
  });

  it('draws the same controls in the same order on the default set and a user set, enabling only the user set\'s own (FR-047, FR-049)', async () => {
    const shape = (): string[] =>
      [...screen.getByTestId('icon-set-row').querySelectorAll('button, select')].map((c) => c.getAttribute('data-testid') ?? '');
    await mountSection(THRONG_THEME, [userSet('mine')]);
    const onDefault = shape();
    expect(screen.getByTestId('icon-set-rename')).toBeDisabled();
    expect(screen.getByTestId('icon-set-delete')).toBeDisabled();
    cleanup();

    await mountSection(withSet('mine'), [userSet('mine')]);
    expect(shape()).toEqual(onDefault);
    expect(screen.getByTestId('icon-set-rename')).not.toBeDisabled();
    expect(screen.getByTestId('icon-set-delete')).not.toBeDisabled();
  });
});

describe('Rename this icon set (FR-042)', () => {
  it('opens a prompt holding the name, accepts a change of case and renames', async () => {
    const { user, iconSets, onSetIconSet } = await mountSection(withSet('mine'), [userSet('mine'), userSet('other')]);

    await user.click(screen.getByTestId('icon-set-rename'));
    const input = (await screen.findByTestId('icon-set-rename-input')) as HTMLInputElement;
    expect(input.value).toBe('mine');
    await user.clear(input);
    await user.type(input, 'OTHER');
    expect(screen.getByTestId('icon-set-rename-error')).toHaveTextContent('already exists');

    await user.clear(input);
    await user.type(input, 'Mine');
    expect(screen.queryByTestId('icon-set-rename-error')).toBeNull();
    await user.click(screen.getByTestId('icon-set-rename-confirm'));

    await waitFor(() => expect(iconSets.rename).toHaveBeenCalledWith('mine', 'Mine'));
    await waitFor(() => expect(onSetIconSet).toHaveBeenCalledWith('Mine'));
    expect(screen.queryByTestId('icon-set-rename-dialog')).toBeNull();
  });

  it('keeps the prompt open with main\'s reason when main refuses the name', async () => {
    const { user, onSetIconSet } = await mountSection(withSet('mine'), [userSet('mine')], {
      rename: { ok: false, reason: 'exists', message: 'An icon set named ours already exists.' },
    });

    await user.click(screen.getByTestId('icon-set-rename'));
    const input = (await screen.findByTestId('icon-set-rename-input')) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'ours');
    await user.click(screen.getByTestId('icon-set-rename-confirm'));

    expect(await screen.findByTestId('icon-set-rename-error')).toHaveTextContent('already exists');
    expect(onSetIconSet).not.toHaveBeenCalled();
  });
});

describe('Delete this icon set (FR-043)', () => {
  it('asks first, then deletes and returns the theme to the default set', async () => {
    const { user, iconSets, onSetIconSet } = await mountSection(withSet('mine'), [userSet('mine')]);

    await user.click(screen.getByTestId('icon-set-delete'));
    const dialog = await screen.findByTestId('icon-set-delete-dialog');
    expect(dialog).toHaveTextContent(/trash/);
    expect(iconSets.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByTestId('icon-set-delete-yes'));

    await waitFor(() => expect(iconSets.remove).toHaveBeenCalledWith('mine'));
    await waitFor(() => expect(onSetIconSet).toHaveBeenCalledWith(undefined));
  });

  it('deletes nothing on Cancel', async () => {
    const { user, iconSets, onSetIconSet } = await mountSection(withSet('mine'), [userSet('mine')]);

    await user.click(screen.getByTestId('icon-set-delete'));
    await user.click(await screen.findByTestId('icon-set-delete-no'));

    await waitFor(() => expect(screen.queryByTestId('icon-set-delete-dialog')).toBeNull());
    expect(iconSets.remove).not.toHaveBeenCalled();
    expect(onSetIconSet).not.toHaveBeenCalled();
  });

  it('reports a delete main could not do, and keeps the theme on the set', async () => {
    const { user, onSetIconSet } = await mountSection(withSet('mine'), [userSet('mine')], {
      remove: { ok: false, reason: 'io', message: 'the trash is not available' },
    });

    await user.click(screen.getByTestId('icon-set-delete'));
    await user.click(await screen.findByTestId('icon-set-delete-yes'));

    expect(await screen.findByText(/the trash is not available/)).toBeInTheDocument();
    expect(onSetIconSet).not.toHaveBeenCalled();
  });
});

describe('Reset this icon to the default (FR-044)', () => {
  it('is usable on an overridden icon, and resets that key', async () => {
    const { user, iconSets } = await mountSection(withSet('mine'), [userSet('mine', ['save'])]);

    const reset = screen.getByTestId('icon-reset-save');
    expect(reset).not.toBeDisabled();
    expect(reset).toHaveAttribute('title', 'Reset this icon to the default');
    await user.click(reset);
    await waitFor(() => expect(iconSets.resetIcon).toHaveBeenCalledWith('mine', 'save'));
  });

  it('is on screen but greyed out on an icon that comes from the default set (FR-049)', async () => {
    await mountSection(withSet('mine'), [userSet('mine', ['save'])]);

    const reset = screen.getByTestId('icon-reset-add');
    expect(reset).toBeVisible();
    expect(reset).toBeDisabled();
    expect(reset).toHaveAttribute('title', 'This icon already comes from the default set');
  });
});

describe('each row says Overridden or Default, by file presence alone (FR-027)', () => {
  it('marks a key the set holds as Overridden, and every other as Default', async () => {
    await mountSection(withSet('mine'), [userSet('mine', ['save', 'copy'])]);

    expect(screen.getByTestId('icon-cell-status-save')).toHaveTextContent('Overridden');
    expect(screen.getByTestId('icon-cell-status-copy')).toHaveTextContent('Overridden');
    expect(screen.getByTestId('icon-cell-status-add')).toHaveTextContent('Default');
    expect(screen.getByTestId('icon-cell-save')).toHaveAttribute('data-overridden', 'true');
    expect(screen.getByTestId('icon-cell-add')).toHaveAttribute('data-overridden', 'false');
  });

  it('draws the set’s art for an overridden key, and the default art for the rest', async () => {
    await mountSection(withSet('mine'), [userSet('mine', ['save'])]);

    const art = (key: IconKey): string | undefined => drawnIcon(screen.getByTestId(`icon-cell-${key}`).querySelector('.icon-cell__icon'));
    expect(art('save')).not.toBe(iconMarkup('save'));
    expect(art('add')).toBe(iconMarkup('add'));
  });

  it('says why an override file could not be loaded, on its row, and shows the default art there', async () => {
    await mountSection(withSet('mine'), [userSet('mine', [], { failures: { save: 'not an SVG file' } })]);

    expect(screen.getByTestId('icon-cell-failure-save')).toHaveTextContent('not an SVG file');
    expect(drawnIcon(screen.getByTestId('icon-cell-save').querySelector('.icon-cell__icon'))).toBe(iconMarkup('save'));
  });

  it('lists the files in the set’s folder that match no key', async () => {
    await mountSection(withSet('mine'), [userSet('mine', [], { unrecognised: ['notes.txt', 'notifications.svg'] })]);

    const list = screen.getByTestId('icon-set-unrecognised');
    expect(list).toHaveTextContent('notes.txt');
    expect(list).toHaveTextContent('notifications.svg');
  });

  it('lists none when the set holds only recognised files', async () => {
    await mountSection(withSet('mine'), [userSet('mine', ['save'])]);

    expect(screen.queryByTestId('icon-set-unrecognised')).toBeNull();
  });
});

describe('Override this icon (FR-030, FR-032, FR-033)', () => {
  it('is usable on every row of a user set, as a titled icon control, and greyed out on the default set', async () => {
    await mountSection(withSet('mine'), [userSet('mine')]);
    for (const key of ICON_KEYS) {
      const button = screen.getByTestId(`icon-override-${key}`);
      expect(drawnIcon(button)).toBe(iconMarkup('overrideIcon'));
      expect(button).toHaveAttribute('title', 'Override this icon');
      expect(button).not.toBeDisabled();
    }
    cleanup();

    await mountSection(THRONG_THEME, [userSet('mine')]);
    expect(screen.getByTestId('icon-override-save')).toBeDisabled();
  });

  it('copies the default art into the set without asking when no file is there', async () => {
    const { user, iconSets } = await mountSection(withSet('mine'), [userSet('mine')]);

    await user.click(screen.getByTestId('icon-override-save'));

    expect(iconSets.override).toHaveBeenCalledTimes(1);
    expect(iconSets.override).toHaveBeenCalledWith('mine', 'save', false);
    expect(screen.queryByTestId('icon-replace-dialog')).toBeNull();
  });

  it('asks Replace or Cancel when the file exists, and replaces only on Replace', async () => {
    const { user, iconSets } = await mountSection(
      withSet('mine'),
      [userSet('mine', ['save'])],
      { override: [{ ok: false, reason: 'exists', message: 'exists' }, { ok: true }] },
    );

    await user.click(screen.getByTestId('icon-override-save'));
    const dialog = await screen.findByTestId('icon-replace-dialog');
    expect(within(dialog).getByTestId('icon-replace-yes')).toHaveTextContent('Replace');
    expect(within(dialog).getByTestId('icon-replace-no')).toHaveTextContent('Cancel');
    expect(iconSets.override).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByTestId('icon-replace-yes'));

    await waitFor(() => expect(iconSets.override).toHaveBeenCalledTimes(2));
    expect(iconSets.override).toHaveBeenLastCalledWith('mine', 'save', true);
  });

  it('leaves the file exactly as it was on Cancel — no second call', async () => {
    const { user, iconSets } = await mountSection(
      withSet('mine'),
      [userSet('mine', ['save'])],
      { override: [{ ok: false, reason: 'exists', message: 'exists' }] },
    );

    await user.click(screen.getByTestId('icon-override-save'));
    await user.click(await screen.findByTestId('icon-replace-no'));

    await waitFor(() => expect(screen.queryByTestId('icon-replace-dialog')).toBeNull());
    expect(iconSets.override).toHaveBeenCalledTimes(1);
  });

  it('reports a failed write as a notice naming the reason', async () => {
    const { user } = await mountSection(withSet('mine'), [userSet('mine')], {
      override: [{ ok: false, reason: 'io', message: 'the folder is read-only' }],
    });

    await user.click(screen.getByTestId('icon-override-save'));

    expect(await screen.findByText(/the folder is read-only/)).toBeInTheDocument();
  });
});

describe('Copy makes a new set from the selected one and switches the theme to it (FR-024, FR-025)', () => {
  it('opens a name prompt, refuses a bad name with the reason, and creates nothing', async () => {
    const { user, iconSets } = await mountSection(THRONG_THEME, [userSet('mine')]);

    await user.click(screen.getByTestId('icon-set-copy'));
    const input = (await screen.findByTestId('icon-set-name-input')) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'MINE');

    expect(screen.getByTestId('icon-set-name-error')).toHaveTextContent('already exists');
    expect(screen.getByTestId('icon-set-name-confirm')).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'throng');
    expect(screen.getByTestId('icon-set-name-error')).toHaveTextContent('default icon set');
    await user.type(input, '{Enter}');
    expect(iconSets.create).not.toHaveBeenCalled();
  });

  it('creates the set from the default set, then switches the theme to it', async () => {
    const { user, iconSets, onSetIconSet } = await mountSection(THRONG_THEME);

    await user.click(screen.getByTestId('icon-set-copy'));
    const input = (await screen.findByTestId('icon-set-name-input')) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Fresh');
    await user.click(screen.getByTestId('icon-set-name-confirm'));

    await waitFor(() => expect(iconSets.create).toHaveBeenCalledWith('Fresh', 'throng'));
    await waitFor(() => expect(onSetIconSet).toHaveBeenCalledWith('Fresh'));
    expect(screen.queryByTestId('icon-set-name-dialog')).toBeNull();
  });

  it('creates the set from the selected user set', async () => {
    const { user, iconSets } = await mountSection(withSet('mine'), [userSet('mine', ['save'])]);

    await user.click(screen.getByTestId('icon-set-copy'));
    const input = (await screen.findByTestId('icon-set-name-input')) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Mine two');
    await user.click(screen.getByTestId('icon-set-name-confirm'));

    await waitFor(() => expect(iconSets.create).toHaveBeenCalledWith('Mine two', 'mine'));
  });

  it('does not switch the theme when main refuses, and says why', async () => {
    const { user, onSetIconSet } = await mountSection(THRONG_THEME, [], {
      create: { ok: false, reason: 'exists', message: 'A folder with that name already exists.' },
    });

    await user.click(screen.getByTestId('icon-set-copy'));
    const input = (await screen.findByTestId('icon-set-name-input')) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Fresh');
    await user.click(screen.getByTestId('icon-set-name-confirm'));

    // T040 (converge G4, FR-025): the reason sits on the name field and the prompt stays open to fix it.
    expect(await screen.findByTestId('icon-set-name-error')).toHaveTextContent('A folder with that name already exists.');
    expect(screen.getByTestId('icon-set-name-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-set-notice-error')).toBeNull();
    expect(onSetIconSet).not.toHaveBeenCalled();

    // Changing the name clears main's reason, and a name main accepts closes the prompt.
    await user.type(input, '2');
    expect(screen.queryByTestId('icon-set-name-error')).toBeNull();
  });

  // T042, T043: a create call that throws is reported, never left as a prompt that does nothing.
  it('closes the prompt titled after the action and reports a create call that fails outright', async () => {
    const { user, iconSets, onSetIconSet } = await mountSection(THRONG_THEME);
    iconSets.create.mockImplementation(() => Promise.reject(new Error('bridge gone')));

    await user.click(screen.getByTestId('icon-set-copy'));
    expect(await screen.findByText('New set from “throng”')).toBeInTheDocument();
    await user.click(screen.getByTestId('icon-set-name-confirm'));

    expect(await screen.findByTestId('icon-set-notice-error')).toHaveTextContent(/bridge gone/);
    expect(screen.queryByTestId('icon-set-name-dialog')).toBeNull();
    expect(onSetIconSet).not.toHaveBeenCalled();
  });
});
