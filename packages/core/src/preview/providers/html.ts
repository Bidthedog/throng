/**
 * The HTML provider's descriptor (074 FR-001, FR-070 – FR-088; Q5) — an `.html` / `.htm` file previews as its page,
 * rendered as static markup in an isolated, sandboxed frame: no script runs, nothing is fetched, nothing navigates.
 *
 * A text provider: parented beside the editor it is written in, following the unsaved buffer. Not a flowing document
 * as far as the chrome is concerned (`flowingDocument: false`): the page lives in an opaque-origin frame the panel
 * cannot read into, so there is no Select All, Go to Heading or Synchronise Scrolling (FR-087), and a Find in Files
 * match opens an editor (`revealsMatches: false`, FR-084). Its runs may load the page's own stylesheets and fonts
 * from the project through the asset route (`assetMimeTypes`, FR-072). Ships Throng Preview (Q5).
 *
 * The core half only; the frame is the renderer's `ui/src/renderer/preview/providers/html/`. Pure data.
 */
import type { PreviewProviderDescriptor } from '../provider.js';
import { maxFileBytesSetting } from './media-settings.js';
import { SHIPPED_HTML_SAFE_SOURCES, safeSourceFault } from '../safe-sources.js';

export const htmlProvider: PreviewProviderDescriptor = {
  id: 'html',
  displayName: 'HTML',
  extensions: ['.html', '.htm'],
  kind: 'text',
  // 074 FR-103 — drawn as the preview icon with this type's mark.
  previewIcon: 'previewHtml',
  defaultOpenAction: 'preview',
  filesNoun: 'HTML files',
  flowingDocument: false,
  revealsMatches: false,
  assetMimeTypes: ['text/css', 'font/woff2', 'font/woff', 'font/ttf', 'font/otf'],
  maxFileBytesSetting: 'maxFileBytes',
  settings: [
    maxFileBytesSetting('HTML files', 10 * 1024 * 1024),
    // 074 FR-072a — the remote sources every project's HTML previews may load stylesheets, fonts and images from.
    {
      leaf: 'safeSources',
      label: 'Safe preview sources',
      description:
        'Web addresses an HTML preview may load stylesheets, fonts and images from — for example https://fonts.googleapis.com, or https://*.example.com for every subdomain. Only https. Scripts never run, whatever is listed. A project can trust more sources of its own in Project Settings.',
      control: 'list',
      default: SHIPPED_HTML_SAFE_SOURCES,
      // FR-072c — the editor refuses an entry that is not a source, in Project Settings' words.
      validateItem: safeSourceFault,
    },
  ],
};
