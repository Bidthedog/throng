import { useEffect, useState, type MouseEvent, type ReactElement } from 'react';
import { ConfigProvider, useActiveTheme } from '../config/config-store.js';
import { useNoDropNavigation } from '../composition-root.js';
import { ThemeProvider } from '../theme/theme-provider.js';
import { TitleBar } from '../title-bar/title-bar.js';
import './about.css';

/**
 * The "About throng" surface (020, FR-003 / FR-003a). Reached from the cog menu
 * ("About throng"), rendered in the shared app-modal About window
 * (`index.html?about=1`). It presents the running copy's identity:
 *
 *  - the product **version** and internal **build id** as SELECTABLE text, so a user
 *    can copy them straight into a bug report (FR-003);
 *  - a **copyright notice** and a **licence link** (FR-003a);
 *  - the **full AGPL-3.0 licence text** in a read-only, scrollable region (FR-003a);
 *  - the **third-party packages** shipped, each with its version and a live licence link.
 *
 * The version, author, build id, licence text and third-party list all come from the
 * main process over the preload bridge (`window.throng.about.get`) — the version is the
 * root package.json version (the single source, FR-001), NOT `app.getVersion()` (which
 * reports Electron's own version when running unpackaged); nothing is hardcoded here.
 *
 * Control discipline (constitution, T020a): the only *action* control that would need
 * a themeable icon is the window chrome, which the shared TitleBar already draws from
 * theme tokens. The licence link and the Close button are dialog-decision/navigation
 * controls that keep text labels under the stated exception — their colours derive
 * from theme tokens (see about.css), and neither is a hardcoded-colour action icon.
 */
interface ThirdPartyLicence {
  name: string;
  version: string;
  license: string;
  licenseUrl: string;
  projectUrl: string;
}

interface AboutInfo {
  version: string;
  author: string;
  repoUrl: string;
  buildId: string;
  licenseText: string;
  thirdParty: ThirdPartyLicence[];
}

const AGPL_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

function AboutShell(): ReactElement {
  const theme = useActiveTheme();
  const [info, setInfo] = useState<AboutInfo>({
    version: '',
    author: '',
    repoUrl: '',
    buildId: '',
    licenseText: '',
    thirdParty: [],
  });

  useEffect(() => {
    let active = true;
    void window.throng?.about?.get?.().then((received) => {
      if (active && received) setInfo(received);
    });
    return () => {
      active = false;
    };
  }, []);

  // Open any external link in the user's browser rather than navigating the sandboxed About window.
  const openExternal = (url: string) => (event: MouseEvent): void => {
    event.preventDefault();
    window.throng?.about?.openExternal?.(url);
  };

  const closeWindow = (): void => window.throng?.window?.close?.();

  // The throng licence link points at the LICENSE in throng's own repo (falling back to the
  // canonical AGPL text if the repo URL is somehow absent). The repo base is shown separately.
  const throngLicenceUrl = info.repoUrl ? `${info.repoUrl}/blob/HEAD/LICENSE` : AGPL_URL;
  const repoDisplay = info.repoUrl.replace(/^https?:\/\//, '');

  return (
    <ThemeProvider theme={theme}>
      <div className="about-root" data-testid="about-window">
        <TitleBar identity="About — throng" showCog={false} closeOnly />
        <div className="about-body">
          <h1 className="about-product">throng</h1>

          <dl className="about-meta">
            <dt>Version</dt>
            <dd className="about-selectable" data-testid="about-version">
              {info.version}
            </dd>
            <dt>Build</dt>
            <dd className="about-selectable" data-testid="about-build-id">
              {info.buildId}
            </dd>
          </dl>

          <p className="about-copyright" data-testid="about-copyright">
            © {new Date().getFullYear()} {info.author || 'Christopher Sebok'}. Licensed under{' '}
            <a
              href={throngLicenceUrl}
              className="about-licence-link"
              data-testid="about-licence-link"
              onClick={openExternal(throngLicenceUrl)}
            >
              GNU AGPL-3.0-only
            </a>
            .
          </p>

          {info.repoUrl ? (
            <p className="about-repo">
              <a
                href={info.repoUrl}
                className="about-licence-link"
                data-testid="about-repo-link"
                onClick={openExternal(info.repoUrl)}
              >
                {repoDisplay}
              </a>
            </p>
          ) : null}

          <label className="about-section-label" htmlFor="about-licence-text">
            Licence
          </label>
          <textarea
            id="about-licence-text"
            className="about-licence-text"
            data-testid="about-licence-text"
            readOnly
            wrap="off"
            aria-label="Full licence text"
            value={info.licenseText}
          />

          {/* Third-party packages (FR-003a). Not a <textarea> — a plain text box cannot carry the
              live licence links the requirement asks for — but a read-only, scrollable box styled
              to match the licence box, each row a package with a live link to its licence. */}
          <span className="about-section-label">
            Third-party packages ({info.thirdParty.length})
          </span>
          <div
            className="about-thirdparty"
            data-testid="about-thirdparty"
            role="list"
            aria-label="Third-party packages and licences"
          >
            {info.thirdParty.map((p) => (
              <div className="about-thirdparty__row" role="listitem" key={`${p.name}@${p.version}`}>
                {p.projectUrl ? (
                  <a
                    className="about-thirdparty__name"
                    href={p.projectUrl}
                    onClick={openExternal(p.projectUrl)}
                    title={`Open the ${p.name} project page`}
                  >
                    {p.name}
                  </a>
                ) : (
                  <span className="about-thirdparty__name">{p.name}</span>
                )}
                <span className="about-thirdparty__version">{p.version}</span>
                {p.licenseUrl ? (
                  <a
                    className="about-thirdparty__licence"
                    href={p.licenseUrl}
                    onClick={openExternal(p.licenseUrl)}
                    title={`Open the ${p.license} licence`}
                  >
                    {p.license}
                  </a>
                ) : (
                  <span className="about-thirdparty__licence">{p.license}</span>
                )}
              </div>
            ))}
          </div>

          <div className="about-actions">
            <button
              type="button"
              className="about-close"
              data-testid="about-close"
              onClick={closeWindow}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}

export function AboutApp(): ReactElement {
  // The About window is a SEPARATE renderer realm with its own root; without this a
  // file dropped anywhere on it makes the engine navigate to that file, replacing the
  // dialog (mirrors the preferences window's guard, 018 / FR-061a). It has no drop
  // target of its own, so every drop here would otherwise land on nothing and navigate.
  useNoDropNavigation();
  return (
    <ConfigProvider>
      <AboutShell />
    </ConfigProvider>
  );
}
