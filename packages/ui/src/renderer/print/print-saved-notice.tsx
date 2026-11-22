/**
 * 075 FR-082 — a PDF saved from Print Preview, reported in the window that asked for the print: one success toast
 * naming the file and its folder. Its control is Reveal in File Explorer when the folder is in the open project (the
 * tree shows it), and Open otherwise (the OS's default program, through main, which opens only a PDF it saved).
 */
import { useEffect, type ReactElement } from 'react';
import { relPathUnderRoot } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { useNotify } from '../common/notification.js';
import { useProjectsOptional } from '../state/projects-store.js';

const TEST_ID = 'print-saved';

function split(path: string): { dir: string; name: string } {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? { dir: '', name: path } : { dir: path.slice(0, cut), name: path.slice(cut + 1) };
}

export interface PrintSavedNoticeProps {
  /** The open project's root; read from the projects store when not given. */
  readonly projectRoot?: string | null;
}

export function PrintSavedNotice({ projectRoot }: PrintSavedNoticeProps): null {
  const { notify } = useNotify();
  const projects = useProjectsOptional();
  const root = projectRoot !== undefined ? projectRoot : (projects?.activeProject?.rootFolder ?? null);

  useEffect(() => {
    const print = window.throng?.print;
    if (!print?.onSaved) return undefined;
    return print.onSaved(({ path }) => {
      const { dir, name } = split(path);
      const inProject = root !== null && relPathUnderRoot(root, path) !== null;
      const control: ReactElement = inProject ? (
        <IconButton
          token="folderOpen"
          className="notice__control"
          testId="print-saved-reveal"
          title="Reveal in File Explorer"
          onClick={() => window.dispatchEvent(new CustomEvent('throng:reveal-in-tree', { detail: { absPath: path } }))}
        />
      ) : (
        <IconButton
          token="previewPdf"
          className="notice__control"
          testId="print-saved-open"
          title={`Open ${name}`}
          onClick={() => {
            void print.openSaved(path).then((result) => {
              if (result.ok) return;
              notify({ severity: 'error', subject: { kind: 'file', name, dir }, action: 'open', message: result.osReason, testId: 'print-saved-open-failed' });
            });
          }}
        />
      );
      notify({
        severity: 'success',
        subject: { kind: 'file', name, dir },
        message: `Saved as a PDF in ${dir}.`,
        testId: TEST_ID,
        controls: control,
      });
    });
  }, [notify, root]);

  return null;
}
