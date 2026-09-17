/**
 * Opening a file whose stored override names a language this build does not know (016 FR-005b).
 *
 * ══ WHY THIS EXISTS ══
 *
 * 044 T163a-e move five E2E declarations down. One of them, `editor-language-override.e2e.ts`'s
 * "a persisted language this build no longer knows opens as plain text, WITHOUT error, and is
 * preserved", made three claims, and two were already held lower:
 *
 *   - the precedence decision — `core/tests/unit/language-precedence.test.ts` and
 *     `ui/tests/integration/language-detect.integration.test.ts` (the stale id falls through);
 *   - the store keeps the id — `daemon/tests/integration/document-ipc.integration.test.ts`.
 *
 * The third was not: that OPENING the file does not "repair" the stored id on the way. The daemon
 * round-trip proves the store would keep it; nothing proved the renderer never asks it to change.
 * `loadDocumentOverride` is the whole of the open path's contact with the document store
 * (`use-editor.ts`'s `refreshLanguage`), so a recording bridge under it is the complete answer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { loadDocumentOverride } from '../../src/renderer/editor/language-override.js';
import { getPanelLanguage, removePanelLanguage } from '../../src/renderer/editor/editor-language.js';

const PANEL = 'p-stale-language';

function recordingDocuments(storedLanguageId: string): { documents: DocumentClient; calls: string[] } {
  const calls: string[] = [];
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      calls.push(method);
      if (method === 'document.getState') {
        return Promise.resolve({
          state: { projectId: 'proj', relPath: 'main.rs', languageId: storedLanguageId },
        } as T);
      }
      return Promise.resolve({ state: null } as T);
    },
  };
  return { documents: new DocumentClient(bridge), calls };
}

afterEach(() => removePanelLanguage(PANEL));

describe('loadDocumentOverride with a stored id this build does not know (FR-005b)', () => {
  it('renders the detected language, resolves without throwing, and writes NOTHING back', async () => {
    const { documents, calls } = recordingDocuments('elvish');

    await expect(
      loadDocumentOverride({
        panelId: PANEL,
        projectId: 'proj',
        relPath: 'main.rs',
        filePath: 'C:/proj/main.rs',
        documents,
        stillMounted: () => true,
      }),
    ).resolves.toBeUndefined();

    // Falls through to detection: the file is Rust, from the registry, not from the stale override.
    expect(getPanelLanguage(PANEL)).toEqual({ languageId: 'rust', source: 'registry' });
    // The read happened — so the assertion below is about a path that really consulted the store.
    expect(calls).toContain('document.getState');
    // …and the stored id is left for a build that knows the language again. A "repair" here would
    // erase the user's choice on the first open after an upgrade.
    expect(calls.filter((m) => m !== 'document.getState')).toEqual([]);
  });

  it('still adopts a KNOWN stored id — the control that makes the test above mean something', async () => {
    // Without this, a loader that ignored the store entirely would pass the test above.
    const { documents } = recordingDocuments('python');

    await loadDocumentOverride({
      panelId: PANEL,
      projectId: 'proj',
      relPath: 'main.rs',
      filePath: 'C:/proj/main.rs',
      documents,
      stillMounted: () => true,
    });

    expect(getPanelLanguage(PANEL)).toEqual({ languageId: 'python', source: 'override' });
  });
});
