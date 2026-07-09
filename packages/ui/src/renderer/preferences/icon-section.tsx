import { useEffect, useState, type ReactElement } from 'react';
import { resolveIconValue, THRONG_THEME, type IconPackManifest, type Theme } from '@throng/core';

/**
 * Icon section of the Themes tab (feature 007, US4 — FR-039/040). Choose an icon
 * pack that maps all tokens at once, and override individual tokens on top of it
 * (glyph or image). Each token renders in a 24px box: a glyph as text, an image
 * via a `file://` URL from the pack's asset base. A token missing everywhere falls
 * back to the default throng glyph. Writes update the selected theme file.
 */
interface IconPackDto {
  name: string;
  assetBase: string;
  tokens: Record<string, { glyph: string } | { image: string }>;
}

const ICON_TOKENS = Object.keys(THRONG_THEME.icons);

function assetBaseFor(packs: IconPackDto[], name: string | undefined): string | null {
  return packs.find((p) => p.name === name)?.assetBase ?? null;
}

function fileUrl(base: string, file: string): string {
  const norm = `${base}/${file}`.replace(/\\/g, '/');
  return `file:///${norm.replace(/^\/+/, '')}`;
}

export interface IconSectionProps {
  theme: Theme;
  onSetPack: (pack: string | undefined) => void;
  onOverride: (token: string, value: string) => void;
}

export function IconSection({ theme, onSetPack, onOverride }: IconSectionProps): ReactElement {
  const [packs, setPacks] = useState<IconPackDto[]>([]);
  useEffect(() => {
    let active = true;
    void window.throng?.config
      ?.listIconPacks?.()
      .then((list) => {
        if (active) setPacks(list as IconPackDto[]);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const manifests: Record<string, IconPackManifest> = {};
  for (const p of packs) manifests[p.name] = { name: p.name, tokens: p.tokens };
  const packBase = assetBaseFor(packs, theme.iconPack);

  const renderIcon = (token: string): ReactElement => {
    const value = resolveIconValue(theme, manifests, token);
    if ('image' in value && packBase) {
      return <img className="icon-cell__img" src={fileUrl(packBase, value.image)} alt={token} />;
    }
    const glyph = 'glyph' in value ? value.glyph : '';
    return <span className="icon-cell__glyph">{glyph}</span>;
  };

  return (
    <section className="settings-group" data-testid="settings-group-Icons">
      <h3 className="settings-group__title">Icons</h3>
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
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="icon-grid" data-testid="icon-grid">
        {ICON_TOKENS.map((token) => (
          <div className="icon-cell" key={token} data-testid={`icon-cell-${token}`}>
            <div className="icon-cell__box">{renderIcon(token)}</div>
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
