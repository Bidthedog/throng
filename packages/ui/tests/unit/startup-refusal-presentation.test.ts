/**
 * How a startup refusal is shown (062 FR-019; 070 FR-007, research R15). A real refusal — running as root, or a
 * translocated copy — shows the system error dialog, then exits. One raised through the `THRONG_TEST_EXEC_PATH` seam
 * is a package check launching the app as if translocated: macOS's dialog is modal and nobody is there to dismiss it,
 * so the check would hang to its cap. That one logs the refusal and exits without the dialog.
 */
import { describe, expect, it } from 'vitest';
import { refusalPresentation } from '../../src/main/startup-refusal.js';

describe('refusalPresentation', () => {
  it('shows the dialog for a real refusal', () => {
    expect(refusalPresentation({})).toBe('dialog');
    expect(refusalPresentation({ THRONG_TEST_EXEC_PATH: '' })).toBe('dialog');
  });

  it('logs instead when the refusal came through the test seam', () => {
    expect(refusalPresentation({ THRONG_TEST_EXEC_PATH: '/private/var/folders/x/AppTranslocation/y/throng.app/Contents/MacOS/throng' })).toBe('log');
  });
});
