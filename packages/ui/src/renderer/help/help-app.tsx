/**
 * The Help window's own document (080 FR-048, FR-051): throng's title bar and a toolbar — Back, Forward and Open in
 * browser, themeable icon controls like every other — above the guide, which main draws in a view of its own below
 * this toolbar (`main/help-window.ts`). This document reports where its toolbar ends, so main can place the view, and
 * shows the page's title and whether there is anywhere to go back or forward to.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { IconButton } from '../common/icon-button.js';
import { useNoDropNavigation } from '../common/no-drop-navigation.js';
import { NotificationProvider } from '../common/notification.js';
import { OpenExternalFailedNotice } from '../common/open-external-failed-notice.js';
import { LinkPromptHost } from '../link-prompt/link-prompt-host.js';
import { useHelpKey } from './use-help-key.js';
import { ConfigProvider, useActiveTheme } from '../config/config-store.js';
import { ThemeProvider } from '../theme/theme-provider.js';
import { TitleBar } from '../title-bar/title-bar.js';
import './help-app.css';

interface HelpState {
  readonly title: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/** The window's identity: the page's own title, after "Help". */
export function helpWindowIdentity(title: string): string {
  return title.trim() === '' ? 'Help — throng' : `Help — ${title.trim()}`;
}

function HelpShell(): ReactElement {
  useHelpKey(); // 080 FR-010 — F1 here goes back to the guide's start page
  const theme = useActiveTheme();
  const [state, setState] = useState<HelpState>({ title: '', canGoBack: false, canGoForward: false });
  const toolbar = useRef<HTMLDivElement | null>(null);

  useEffect(() => window.throng?.help?.onState(setState), []);

  // 080 FR-070 — while a dialog covers the window, main hides the guide and hands over a still of it.
  const [cover, setCover] = useState<string | null>(null);
  useEffect(
    () =>
      window.throng?.help?.onCover?.((png) =>
        setCover((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return png ? URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })) : null;
        }),
      ),
    [],
  );

  // Main places the guide's view below this toolbar, wherever the title bar and toolbar end.
  useLayoutEffect(() => {
    const el = toolbar.current;
    const report = (): void => {
      if (el) window.throng?.help?.layout(el.getBoundingClientRect().bottom);
    };
    report();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    if (el) observer?.observe(el);
    window.addEventListener('resize', report);
    window.throng?.help?.ready();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', report);
    };
  }, []);

  // Alt+Left / Alt+Right while this toolbar has focus (the view handles them while the guide has it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === 'ArrowLeft') window.throng?.help?.back();
      else if (e.key === 'ArrowRight') window.throng?.help?.forward();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const identity = helpWindowIdentity(state.title);
  useEffect(() => {
    document.title = identity;
  }, [identity]);

  return (
    <ThemeProvider theme={theme}>
      <div className="help-root" data-testid="help-window">
        <TitleBar identity={identity} showCog={false} />
        <div className="help-toolbar" ref={toolbar} data-testid="help-toolbar">
          <IconButton
            token="navigateBack"
            title="Back (Alt+Left)"
            testId="help-back"
            disabled={!state.canGoBack}
            onClick={() => window.throng?.help?.back()}
          />
          <IconButton
            token="navigateForward"
            title="Forward (Alt+Right)"
            testId="help-forward"
            disabled={!state.canGoForward}
            onClick={() => window.throng?.help?.forward()}
          />
          <span className="help-toolbar__spacer" />
          <IconButton token="openInBrowser" title="Open in browser" testId="help-open-in-browser" onClick={() => window.throng?.help?.openInBrowser()} />
        </div>
        {cover ? <img className="help-cover" src={cover} alt="" data-testid="help-cover" /> : null}
      </div>
    </ThemeProvider>
  );
}

export function HelpApp(): ReactElement {
  useNoDropNavigation();
  return (
    <ConfigProvider>
      <NotificationProvider>
        <OpenExternalFailedNotice />
        <LinkPromptHost />
        <HelpShell />
      </NotificationProvider>
    </ConfigProvider>
  );
}
