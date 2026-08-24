import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectPanels,
  createDefaultLayout,
  DEFAULT_APP_SETTINGS,
  type Panel,
  type WorkspaceLayout,
} from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { PanelTypeForm } from '../../src/renderer/panel-type/panel-type-form.js';
import { clearDraft } from '../../src/renderer/panel-type/panel-draft-store.js';

/**
 * 039 FR-008 — "Run as administrator by default" is a SEED, and a seed may not out-rank the
 * elevation gate.
 *
 * ══ THE DEFECT THIS FILE REPRODUCES ══
 *
 * `terminal-inputs.tsx:138` disables the per-panel checkbox when the daemon is not elevated, and
 * says why in its title. `panel-type-form.tsx:73` then seeds the very value that control displays
 * straight from `settings.terminals.defaultRunAsAdmin`, with no elevation check at all. So on a
 * NON-elevated throng with the preference on, the New Panel dialog opens with `runAsAdmin` already
 * `true` behind a control the user cannot untick — and Confirm writes that `true` into the Panel's
 * persisted config. The gate is on the control, not on the value that reaches it.
 *
 * ══ WHY COMPONENT AND NOT LOWER ══
 *
 * The rule being broken is a RENDERER composition: "the elevation capability gates the preference
 * seed". Neither half is wrong on its own — `canRunAsAdmin()` is right, the preference is right,
 * `TerminalInputs` is right — so no unit over any one of them can see it. It is also nothing like
 * an E2E: there is no shell, no daemon and no elevation here, only a form deciding what value to
 * start with from two facts it was handed.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Change `stubBridge` to resolve `[]` for `listFlavours` and both tests fail in `openTerminalForm`,
 * which waits for the flavour select that only exists once a non-empty list has loaded. Neither
 * test can pass against a form that never received its inputs.
 */

const PROJECT = 'proj-1';
const PANEL = 'p1';

const FLAVOURS = [
  {
    id: 'cmd',
    label: 'Command Prompt',
    file: 'C:\\Windows\\System32\\cmd.exe',
    args: [],
    source: 'builtin' as const,
    defaultShellArguments: '/K',
    reportsDirectory: true,
  },
];

/**
 * The preload bridge: an UNELEVATED daemon, and the preference turned ON.
 *
 * Both facts are the user's real situation in the report — they ticked "Run as administrator by
 * default" in Preferences while running throng normally. `config.get` goes through
 * `guardedSettingsValidator` in the store, so this partial document is merged over the shipped
 * defaults exactly as a real `settings.json` would be.
 */
function stubBridge(list: typeof FLAVOURS = FLAVOURS): void {
  Reflect.set(window, 'throng', {
    terminal: {
      listFlavours: () => Promise.resolve(list),
      capabilities: () => Promise.resolve({ elevated: false }),
    },
    config: {
      get: () =>
        Promise.resolve({
          settings: {
            ...DEFAULT_APP_SETTINGS,
            terminals: { ...DEFAULT_APP_SETTINGS.terminals, defaultRunAsAdmin: true },
          },
        }),
      onChange: () => () => {},
    },
    panel: {},
  });
}

function fakeDaemon(): { bridge: ThrongBridge } {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: PANEL });
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        default:
          return Promise.reject(new Error(`unexpected RPC from the panel type form: ${method}`));
      }
    },
  };
  return { bridge };
}

function servicesOver(bridge: ThrongBridge): Services {
  return {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };

function Host(): ReactElement | null {
  const ws = useWorkspace();
  captured.ws = ws;
  if (!ws.layout) return null;
  return createElement(PanelTypeForm, { panelId: PANEL, projectRoot: 'C:/proj' });
}

function mount(): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  const services = servicesOver(fakeDaemon().bridge);
  render(
    createElement(
      ServicesProvider,
      { services },
      createElement(
        ConfigProvider,
        null,
        createElement(
          ProjectsProvider,
          { client: services.projects },
          createElement(
            WorkspaceProvider,
            { client: services.workspace, activeProjectId: PROJECT },
            createElement(NotificationProvider, null, createElement(Host, null)),
          ),
        ),
      ),
    ),
  );
  return { user };
}

/**
 * Open the form and choose Terminal, which is the gesture that SEEDS the values.
 *
 * The wait for the settings to arrive is not decoration: `ConfigProvider` starts on the shipped
 * defaults and adopts `config.get`'s payload a tick later, so selecting the type before that lands
 * would seed from `defaultRunAsAdmin: false` and the test would pass for the wrong reason.
 */
async function openTerminalForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  const select = await screen.findByTestId(`panel-type-select-${PANEL}`);
  await user.selectOptions(select, 'terminal');
  await screen.findByTestId('terminal-flavour');
}

const panelIn = (ws: Ws): Panel =>
  collectPanels((ws.layout as WorkspaceLayout).tabs[0].root).find((p) => p.id === PANEL) as Panel;

beforeEach(() => {
  captured.ws = null;
  stubBridge();
});

afterEach(() => {
  clearDraft(PANEL);
  Reflect.deleteProperty(window, 'throng');
});

describe('the "Run as administrator" preference is a seed, not a grant (039 FR-008)', () => {
  it('does not tick the New Panel admin control on an UNELEVATED throng', async () => {
    const { user } = mount();
    await openTerminalForm(user);

    const admin = screen.getByTestId('terminal-admin');
    // Disabled has always been true, and it is not the defect: the control is disabled AND ticked,
    // which tells the user this terminal will be elevated and gives them no way to say otherwise.
    expect(admin).toBeDisabled();
    expect(admin).not.toBeChecked();
  });

  it('confirms a terminal with runAsAdmin FALSE, whatever the preference says', async () => {
    const { user } = mount();
    await openTerminalForm(user);

    await user.click(screen.getByTestId(`panel-type-confirm-${PANEL}`));

    await waitFor(() => expect(panelIn(captured.ws as Ws).kind).toBe('terminal'));
    // The value that reaches the daemon. A persisted `true` here is worse than a cosmetic lie: it
    // survives into the workspace file, so the next ELEVATED launch of throng starts this panel's
    // shell as administrator without the user ever having been able to tick the box.
    expect(panelIn(captured.ws as Ws).config?.runAsAdmin).toBe(false);
  });
});
