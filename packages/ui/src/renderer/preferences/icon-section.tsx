import { type ReactElement } from 'react';
import { THRONG_THEME, type Theme } from '@throng/core';
import { ColourField } from '../common/colour-picker.js';
import { IconButton } from '../common/icon-button.js';
import { ROW_ACTION_TOKENS } from './row-action-tokens.js';
import { Icon } from '../common/icon.js';
import { useIconPacks } from '../config/config-store.js';

/**
 * Icon section of the Themes tab (007, US4 — FR-039/040; reworked by 017 / #54).
 *
 * Choose an icon pack that maps all tokens at once, and override individual tokens on top of it.
 *
 * This grid used to render icons through a PRIVATE `<img src="file://…">` path of its own, and that
 * was the root of #54 twice over. It made this the only screen in the app where a pack was honoured
 * at all — and because an SVG inside an `<img>` is an isolated document, its `currentColor` resolved
 * to black rather than to the theme, so even here the pack looked broken on a dark theme.
 *
 * It now renders through the SAME <Icon> component as the rest of the app. A preview that renders
 * differently from the thing it is previewing is not a preview.
 */
const ICON_TOKENS = Object.keys(THRONG_THEME.icons);

export interface IconSectionProps {
  theme: Theme;
  onSetPack: (pack: string | undefined) => void;
  onOverride: (token: string, value: string) => void;
  /**
   * Set the theme's icon colour (018 / US5). `''` clears it back to unset.
   *
   * The colour lives BESIDE the pack selector because that is where the user is when the icons look
   * wrong. The bundled set is monochrome line art: it reads well on dark themes and badly on light
   * ones, and the obvious remedy — ship a black set and a white set — is the wrong one. The artwork
   * already inherits its colour, so the two sets would be the same art twice, and would still be
   * wrong for every theme that suits neither pure black nor pure white.
   */
  onSetIconColour: (hex: string) => void;
  /**
   * The icon tokens surviving the Themes tab's typeahead (FR-021), and whether the icon-pack row
   * itself matched. `null` means no search is active — show everything.
   *
   * The section used to sit OUTSIDE the filtered groups, so it neither narrowed nor disappeared:
   * search for "terminal" and you got the two matching colour rows plus, still, the entire icon
   * grid. A section that ignores the filter is worse than one with no filter, because it looks
   * like a result.
   */
  filter?: { tokens: readonly string[]; packRowMatches: boolean } | null;
}

export function IconSection({
  theme,
  onSetPack,
  onOverride,
  onSetIconColour,
  filter = null,
}: IconSectionProps): ReactElement | null {
  // Packs arrive on the same hot-reloaded payload as the theme that selects them, so this grid
  // needs no fetch of its own and cannot show a pack that disagrees with the live theme.
  const packMap = useIconPacks();
  const packs = Object.values(packMap);
  const selected = theme.iconPack ? packMap[theme.iconPack] : undefined;

  // The section takes part in the Themes typeahead like everything else on the tab (FR-021).
  const visibleTokens = filter ? ICON_TOKENS.filter((t) => filter.tokens.includes(t)) : ICON_TOKENS;
  const showPackRow = !filter || filter.packRowMatches;
  if (filter && !showPackRow && visibleTokens.length === 0) return null;

  return (
    <section className="settings-group" data-testid="settings-group-Icons">
      <h3 className="settings-group__title">Icons</h3>
      {showPackRow ? (
        <div className="settings-row">
          <div className="settings-row__meta">
            <label className="settings-row__label">Icon pack</label>
            <p className="settings-row__desc">Map all icon tokens at once; override individual tokens below.</p>
          </div>
          <div className="settings-row__control">
            <select
              className="ctl ctl--select"
              data-testid="icon-pack-select"
              value={theme.iconPack ?? ''}
              onChange={(e) => onSetPack(e.target.value || undefined)}
            >
              <option value="">(default glyphs)</option>
              {packs.map((p) => (
                <option
                  key={p.name}
                  value={p.name}
                  disabled={!!p.error}
                  // The REASON travels with the option, so a broken pack explains itself without
                  // the user having to select it first — which they cannot, since it is disabled.
                  title={p.error}
                  data-testid={`icon-pack-option-${p.name}`}
                >
                  {p.name}
                  {p.error ? ' (unavailable)' : ''}
                </option>
              ))}
            </select>
            {/*
              FR-004a — a pack that cannot be loaded says SO, right where it was chosen.
              Falling back silently would reproduce the exact confusion this feature exists to
              remove: a setting the user changed that appears to do nothing.
            */}
            {selected?.error ? (
              <p className="settings-row__error" data-testid="icon-pack-error" role="alert">
                <strong>{selected.name}</strong> could not be loaded, so the theme&apos;s own icons
                are being shown instead. {selected.error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {showPackRow ? (
        <div className="settings-row" data-testid="icon-colour-row">
          <div className="settings-row__meta">
            <label className="settings-row__label">Icon colour</label>
            <p className="settings-row__desc">
              Leave it empty and every glyph takes the colour of whatever holds it — which is what
              they have always done, so no theme changes until you set this.
            </p>
          </div>
          <div className="settings-row__control">
            {/*
             * The SAME picker every colour token uses (FR-025). It sits here rather than among the
             * colour tokens because this is where you are standing when the icons look wrong.
             *
             * It is one of the two OPTIONAL tokens, and its emptiness is its meaning: unset, the
             * artwork inherits its host's colour, exactly as before this feature — which is what
             * makes FR-029 true, that no bundled theme changes appearance the day it lands.
             */}
            <ColourField
              value={theme.colours.iconColour ?? ''}
              testId="control-colours.iconColour"
              onCommit={(hex) => onSetIconColour(hex)}
              // One of the only two tokens whose ABSENCE is its meaning: unset, every icon keeps the
              // colour of whatever it sits on, which is why no bundled theme sets it.
              clearable
            />
            {/* FR-043a — an action control, therefore a THEMED ICON with a hover title, not a text
                button. Offered only when there is something to clear: clearing an already-unset value
                is a no-op, and a no-op affordance is noise (FR-016a). */}
            {theme.colours.iconColour ? (
              <IconButton
                token={ROW_ACTION_TOKENS.clear}
                className="icon-colour__clear"
                testId="icon-colour-clear"
                title="Clear the icon colour — icons take the colour of what they sit on"
                onClick={() => onSetIconColour('')}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="icon-grid" data-testid="icon-grid">
        {visibleTokens.map((token) => (
          <div className="icon-cell" key={token} data-testid={`icon-cell-${token}`}>
            <div className="icon-cell__box">
              <Icon token={token} className="icon-cell__icon" />
            </div>
            <span className="icon-cell__name">{token}</span>
            <input
              className="ctl__input icon-cell__override"
              data-testid={`icon-override-${token}`}
              placeholder="glyph or file.svg"
              defaultValue={
                theme.iconOverrides?.[token] && 'glyph' in theme.iconOverrides[token]
                  ? (theme.iconOverrides[token] as { glyph: string }).glyph
                  : theme.iconOverrides?.[token] && 'image' in theme.iconOverrides[token]
                    ? (theme.iconOverrides[token] as { image: string }).image
                    : ''
              }
              onBlur={(e) => onOverride(token, e.target.value)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
