/**
 * The single way an icon is drawn in this application (017 / #54, 069).
 *
 * An icon is svg markup, always: the selected user set's override for the key when it has one, the
 * compiled-in default set's art otherwise (`resolveIcon` in `@throng/core`). There is no glyph
 * branch (069 FR-009).
 *
 * WHY THE SVG IS INLINED
 * ----------------------
 * The art is authored `stroke="currentColor"`. An SVG inside an `<img>` is an ISOLATED DOCUMENT:
 * its `currentColor` resolves against that document's own initial colour (black), not against the
 * host page. Inlining the markup is the only way the icon can inherit the theme's colour.
 *
 * The default set is trusted (vendored, compiled in); a user set's markup is sanitised in the MAIN
 * process, once, at load time — never here. This component does no work per render.
 *
 * WHY IT IS DECORATIVE
 * --------------------
 * `aria-hidden`, always. The accessible name comes from the enclosing control, which the
 * constitution already requires to carry a hover title naming its action.
 */
import { type ReactElement } from 'react';
import { resolveIcon, type IconKey } from '@throng/core';
import { useActiveTheme, useIconSets } from '../config/config-store.js';

export interface IconProps {
  /** Icon key (e.g. `folder`, `retry`, `add`). */
  token: IconKey;
  className?: string;
}

export function Icon({ token, className }: IconProps): ReactElement {
  const theme = useActiveTheme();
  const sets = useIconSets();
  return (
    <span
      className={className ? `icon ${className}` : 'icon'}
      aria-hidden="true"
      /*
       * Safe: the default set is compiled in, and a user set's markup was allowlist-sanitised in
       * the main process before it crossed IPC. Inlining is what lets `currentColor` bind to the theme.
       */
      dangerouslySetInnerHTML={{ __html: resolveIcon(theme, sets, token) }}
    />
  );
}
