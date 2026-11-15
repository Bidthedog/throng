import type { CommandLineStatus, ICommandLineInstall } from '../abstractions/command-line-install.js';
import { logExpected } from '../diagnostics/caught.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ICommandLineInstall contract violation: ${message}`);
}

/** A temporary place to install into, and the means to put it in each starting state. */
export interface CommandLineInstallHarness {
  make(): ICommandLineInstall;
  /** Put something that is not throng's at the command's name. */
  plantOther(): Promise<void>;
  /**
   * Move the throng bundle the command points at, as a user dragging the app elsewhere does, and answer the install
   * the copy now running from the new place would build.
   */
  moveBundle(): Promise<ICommandLineInstall>;
  /** Put the bundle back where `make` expects it. */
  restoreBundle(): Promise<void>;
  /** Remove whatever is at the command's name, so the next step starts from nothing. */
  clear(): Promise<void>;
}

const rejects = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try {
    await fn();
    return null;
  } catch (error) {
    logExpected('command-line-install-contract', 'the contract requires this call to reject', error);
    return error instanceof Error ? error.message : String(error);
  }
};

/**
 * Reusable contract for any `ICommandLineInstall` (070 FR-024a, data-model.md *ICommandLineInstall*). An unavailable
 * one offers nothing and says why; an available one walks every state transition the data model names. In behaviour
 * terms; rejects on the first violation. `harness` is needed only for an available implementation.
 */
export async function runCommandLineInstallContract(make: () => ICommandLineInstall, harness?: CommandLineInstallHarness): Promise<void> {
  const subject = make();
  if (!subject.available) {
    assert(typeof subject.unavailableReason === 'string' && subject.unavailableReason.length > 0, 'an unavailable install must say why');
    assert((await subject.status()).kind === 'absent', 'an unavailable install has nothing to report');
    assert((await rejects(() => subject.install({ replaceOther: true }))) !== null, 'an unavailable install must refuse to install');
    assert((await rejects(() => subject.uninstall())) !== null, 'an unavailable install must refuse to uninstall');
    return;
  }
  assert(harness !== undefined, 'an available install needs a harness to be tested');
  const kind = async (): Promise<CommandLineStatus['kind']> => (await subject.status()).kind;

  await harness.clear();
  assert((await kind()) === 'absent', 'with nothing installed, the status must be absent');

  const installed = await subject.install({ replaceOther: false });
  assert(installed.kind === 'ours' && (await kind()) === 'ours', 'absent → ours: install must put throng’s command in place');
  assert(installed.kind === 'ours' && installed.linkPath.length > 0, 'an installed command must say where it is');

  const removed = await subject.uninstall();
  assert(removed.kind === 'absent' && (await kind()) === 'absent', 'ours → absent: uninstall must remove throng’s command');

  await harness.plantOther();
  assert((await kind()) === 'other', 'something else at the name must read as other');
  assert((await rejects(() => subject.install({ replaceOther: false }))) !== null, 'install must refuse to replace another program unasked');
  assert((await kind()) === 'other', 'a refused install must leave the other program in place');
  const kept = await subject.uninstall();
  assert(kept.kind === 'other' && (await kind()) === 'other', 'uninstall must never remove a command that is not throng’s');
  const replaced = await subject.install({ replaceOther: true });
  assert(replaced.kind === 'ours', 'other → ours: install with replaceOther must replace it');

  const moved = await harness.moveBundle();
  try {
    const broken = await subject.status();
    assert(broken.kind === 'ours-broken', `ours → ours-broken: a moved bundle must read as broken; got ${broken.kind}`);
    assert(broken.kind === 'ours-broken' && broken.target.length > 0, 'a broken command must say what it pointed at');
    const repaired = await moved.install({ replaceOther: false });
    assert(repaired.kind === 'ours', 'ours-broken → ours: the moved copy must install over its own broken command unasked');
    assert((await moved.uninstall()).kind === 'absent', 'the moved copy must uninstall its own command');
  } finally {
    await harness.restoreBundle();
    await harness.clear();
  }
}
