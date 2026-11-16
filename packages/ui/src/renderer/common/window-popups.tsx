/**
 * The popups every window owns once, whatever kind of window it is: the `title` tooltip that stands in for the OS's
 * (constitution v6.7.0). Mounted at the renderer entry every window kind shares (`main.tsx`), beside the window's
 * app, so no root can forget it.
 */
import { useEffect, type ReactElement } from 'react';
import { TitleTooltipHost, installTitleTooltips } from './title-tooltips.js';

export function WindowPopups(): ReactElement {
  useEffect(() => installTitleTooltips(), []);
  return <TitleTooltipHost />;
}
