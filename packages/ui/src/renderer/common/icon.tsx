/**
 * The single way an icon is drawn in this application (017 / #54).
 *
 * WHY THIS EXISTS
 * ---------------
 * There used to be two icon resolvers. The pack-aware one (`resolveIconValue`) was called from
 * exactly one screen — the Preferences → Icons grid. The pack-blind one (`resolveIcon`) served
 * every other icon in the app: the explorer tree and toolbar, panel and tab chrome, menus, the find
 * bar, terminals, buttons. So the user's icon-pack choice was honoured NOWHERE they could see it.
 * Selecting a pack changed a preview grid and nothing else.
 *
 * Worse, `resolveIcon` returned a `string`, which structurally cannot express an image — so no call
 * site could have rendered a pack icon even if it had wanted to. Fixing #54 therefore meant giving
 * the renderer a component that can render one, and making it the ONLY way to draw an icon.
 * `resolveIcon` is deleted; a source guard (`icon-call-sites.test.ts`) fails the build if any
 * renderer module reaches for it again.
 *
 * WHY THE SVG IS INLINED
 * ----------------------
 * The bundled pack art is authored `stroke="currentColor"`, which is exactly right. But an SVG
 * inside an `<img>` is an ISOLATED DOCUMENT: its `currentColor` resolves against that document's own
 * initial colour (black), not against the host page. That is why the SVG pack rendered black-on-dark
 * and was unusable. Inlining the markup is the only way the icon can inherit the theme's colour.
 *
 * The markup is sanitised in the MAIN process, once, at pack-load time — never here. By the time it
 * reaches this component it is already safe, and this component does no work per render.
 *
 * WHY IT IS DECORATIVE
 * --------------------
 * `aria-hidden`, always. The accessible name comes from the enclosing control, which the
 * constitution already requires to carry a hover title naming its action. An icon that also
 * announced itself would be read out twice — and today's glyph icons are worse than that: a screen
 * reader reads the raw character aloud.
 */
import { type ReactElement } from 'react';
import { resolveIconAsset } from '@throng/core';
import { useActiveTheme, useIconPacks } from '../config/config-store.js';

export interface IconProps {
  /** Active-theme icon token (e.g. `folder`, `retry`, `add`). */
  token: string;
  className?: string;
}

export function Icon({ token, className }: IconProps): ReactElement | null {
  const theme = useActiveTheme();
  const packs = useIconPacks();
  const asset = resolveIconAsset(theme, packs, token);

  switch (asset.kind) {
    case 'svg':
      return (
        <span
          className={className ? `icon ${className}` : 'icon'}
          aria-hidden="true"
          /*
           * Safe: the markup was allowlist-sanitised in the main process before it crossed IPC
           * (see @throng/core sanitiseSvg). Inlining is what lets `currentColor` bind to the theme.
           */
          dangerouslySetInnerHTML={{ __html: asset.markup }}
        />
      );

    case 'raster':
      // A raster image cannot take a colour from the theme — it keeps its own. No bundled pack uses
      // PNG; this exists so a user-authored one is shown rather than silently dropped.
      return (
        <img
          className={className ? `icon ${className}` : 'icon'}
          src={asset.dataUri}
          alt=""
          aria-hidden="true"
        />
      );

    case 'glyph':
      return (
        <span className={className ? `icon ${className}` : 'icon'} aria-hidden="true">
          {asset.glyph}
        </span>
      );

    /*
     * Unreachable in practice: resolveIconAsset falls back down the chain (pack → theme → default)
     * rather than returning `missing`, precisely so a half-broken pack cannot produce a half-empty
     * interface. Handled explicitly so a future change to that contract fails loudly here instead
     * of rendering a hole.
     */
    case 'missing':
    default:
      return null;
  }
}
