/**
 * The status strip's reset control for a manual language choice (055 FR-024, FR-024a, US6).
 *
 * Layer: component — what the strip renders for each resolution source, and what pressing the control sends
 * to the daemon, are both visible from the strip alone; no window, shell or real store is involved.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LanguageResolution } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { StatusStrip } from '../../src/renderer/editor/status-strip.js';
import { removePanelLanguage, setPanelLanguage } from '../../src/renderer/editor/editor-language.js';

const PANEL = 'panel-reset';
const PROJECT = 'proj-1';
const REL = 'tsconfig.json';

interface Call {
  method: string;
  params: unknown;
}

function servicesRecording(calls: Call[]): Services {
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      calls.push({ method, params });
      return Promise.resolve({ state: { projectId: PROJECT, relPath: REL, languageId: null } } as TResult);
    },
  };
  return {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

function mount(resolution: LanguageResolution, calls: Call[] = []) {
  setPanelLanguage(PANEL, resolution);
  render(
    createElement(
      ServicesProvider,
      { services: servicesRecording(calls) },
      createElement(StatusStrip, { panelId: PANEL, projectId: PROJECT, relPath: REL }),
    ),
  );
  return { calls, user: userEvent.setup() };
}

const strip = (): HTMLElement => screen.getByTestId(`editor-language-${PANEL}`);
const reset = (): HTMLElement | null => screen.queryByTestId(`editor-language-reset-${PANEL}`);

afterEach(() => {
  removePanelLanguage(PANEL);
});

describe('the reset control (FR-024)', () => {
  it('is absent for a language the registry detected', () => {
    mount({ languageId: 'jsonc', source: 'registry' });
    expect(strip()).toBeVisible();
    expect(reset()).toBeNull();
  });

  it('is absent for a language the user extension mapping chose', () => {
    mount({ languageId: 'json', source: 'user-mapping' });
    expect(strip()).toBeVisible();
    expect(reset()).toBeNull();
  });

  it('is shown beside the language for a manual override, with a title naming the action', () => {
    mount({ languageId: 'json', source: 'override' });
    const control = reset();
    expect(control).not.toBeNull();
    expect(control).toHaveAttribute('title', expect.stringMatching(/reset/i));
  });

  it('is shown for a Plain Text override too (016 FR-011)', () => {
    mount({ languageId: 'plaintext', source: 'override' });
    expect(reset()).not.toBeNull();
  });
});

describe('pressing it (FR-024a)', () => {
  it('clears the stored override with null rather than storing another language', async () => {
    const { user, calls } = mount({ languageId: 'json', source: 'override' });

    await user.click(reset() as HTMLElement);

    await waitFor(() => expect(calls.some((c) => c.method === 'document.setState')).toBe(true));
    expect(calls.find((c) => c.method === 'document.setState')?.params).toEqual({
      projectId: PROJECT,
      relPath: REL,
      languageId: null,
    });
  });
});
