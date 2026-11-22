/**
 * 074 FR-093a (research R6c) — what an HTML Preview left out, said once, inline, with what fixes it.
 *
 * ONE condition, ONE notice: every remote resource the page named and the preview did not load — those the sanitiser
 * left out (`page.blocked`) and those the frame's content policy refused at run time (`securitypolicyviolation`, a
 * font inside a remote stylesheet, say) — are listed in this one notice, grouped by the source that would allow them.
 *
 * - A source that can be trusted (an `https:` origin serving stylesheets, fonts or images) carries **Allow this
 *   source**, which adds it to the project's Safe HTML preview sources (Project Settings); the page reloads with it.
 * - A source that never can be (`http:`, or anything asked for as a script) is listed without the action.
 * - The notice names the global **HTML: Safe preview sources** preference — trusting a source in every project — and
 *   opens Preferences at it.
 *
 * Inline, not a toast: it carries actions (repo rule). Dismissed for this page; the body remounts it per file.
 */
import { useState, type ReactElement } from 'react';
import { formatGrouped, sourceOf } from '@throng/core';
import { IconButton } from '../../../common/icon-button.js';
import type { BlockedKind, BlockedResource } from './html-sanitise.js';

/** The global preference the notice names, as Preferences' search finds it. */
export const SAFE_SOURCES_SETTING = 'editor.previews.providers.html.safeSources';

const KIND_BY_DIRECTIVE: Readonly<Record<string, BlockedKind>> = {
  'img-src': 'image',
  'style-src': 'stylesheet',
  'style-src-elem': 'stylesheet',
  'style-src-attr': 'stylesheet',
  'font-src': 'font',
  'media-src': 'media',
  'script-src': 'script',
  'script-src-elem': 'script',
  'script-src-attr': 'script',
};

/**
 * A request the frame's content policy refused, as the notice lists it — or `null` for a refusal that names no remote
 * source (inline script or style, `eval`).
 */
export function blockedFromViolation(e: Pick<SecurityPolicyViolationEvent, 'blockedURI' | 'effectiveDirective'>): BlockedResource | null {
  const source = sourceOf(e.blockedURI);
  if (source === null || !/^https?:/.test(source)) return null;
  const kind = KIND_BY_DIRECTIVE[e.effectiveDirective] ?? 'other';
  const allowable = source.startsWith('https:') && (kind === 'image' || kind === 'stylesheet' || kind === 'font');
  return { url: e.blockedURI, kind, source, allowable };
}

const KIND_WORD: Readonly<Record<BlockedKind, string>> = {
  image: 'image',
  stylesheet: 'stylesheet',
  font: 'font',
  media: 'media',
  script: 'script',
  other: 'resource',
};

/** Why a source cannot be allowed, in its row: what is wrong with it, not what the reader may not do. */
function whyNot(group: readonly BlockedResource[]): string | null {
  if (group.some((b) => b.allowable)) return null;
  if (group[0]!.source.startsWith('http:')) return 'not a secure (https) source';
  if (group.every((b) => b.kind === 'script')) return 'scripts never run in a preview';
  return 'only stylesheets, fonts and images load from a safe source';
}

interface Props {
  panelId: string;
  blocked: readonly BlockedResource[];
  /** Add a source to the project's safe list; `null` when the panel has no project to add it to. */
  onAllow: ((source: string) => void) | null;
}

export function BlockedResourcesNotice({ panelId, blocked, onAllow }: Props): ReactElement | null {
  const [dismissed, setDismissed] = useState(false);
  if (blocked.length === 0 || dismissed) return null;

  const groups = new Map<string, BlockedResource[]>();
  for (const b of blocked) {
    const list = groups.get(b.source);
    if (list === undefined) groups.set(b.source, [b]);
    else list.push(b);
  }
  const count = blocked.length;

  return (
    <div className="preview-html__notice preview-html__blocked" role="status" data-testid={`preview-html-blocked-${panelId}`}>
      <div className="preview-html__blocked-head">
        <span>
          {count === 1
            ? 'This page uses 1 resource from a source that is not on the safe list; it was left out.'
            : `This page uses ${formatGrouped(count)} resources from sources that are not on the safe list; they were left out.`}{' '}
          To trust a source in every project, add it to HTML: Safe preview sources.
        </span>
        <IconButton
          token="settings"
          title="Open HTML: Safe preview sources in Preferences"
          onClick={() => window.throng?.openPreferences?.('settings', SAFE_SOURCES_SETTING)}
          testId={`preview-html-blocked-preferences-${panelId}`}
        />
        <IconButton token="dismiss" title="Dismiss" onClick={() => setDismissed(true)} testId={`preview-html-blocked-dismiss-${panelId}`} />
      </div>
      <ul className="preview-html__blocked-list">
        {[...groups].map(([source, group]) => {
          const reason = whyNot(group);
          return (
            <li key={source} data-testid={`preview-html-blocked-source-${panelId}`} data-source={source}>
              <div className="preview-html__blocked-source">
                <span className="preview-html__blocked-origin">{source}</span>
                {reason !== null ? <span className="preview-html__blocked-why">— {reason}</span> : null}
                {reason === null && onAllow !== null ? (
                  <IconButton
                    token="add"
                    title="Allow this source"
                    onClick={() => onAllow(source)}
                    testId={`preview-html-blocked-allow-${panelId}`}
                  />
                ) : null}
              </div>
              <ul>
                {group.map((b) => (
                  <li key={`${b.kind} ${b.url}`} className="preview-html__blocked-url">
                    {KIND_WORD[b.kind]}: {b.url}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
