import { type ReactElement } from 'react';
import { THRONG_THEME, type Theme } from '@throng/core';
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
