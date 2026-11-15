/**
 * Wait until a watch just opened on macOS can see a change (070).
 *
 * libuv shares one FSEvents stream per process, rebuilds it as each watch is added, and starts it on a thread of its
 * own after `fs.watch` has returned: a change in that first instant is never reported, and under the gate's load the
 * instant grew long enough to fail tests that change a file straight after opening a watch. Someone else changes a file
 * seconds after it opens, not milliseconds, so the wait models a person; Windows and Linux do not wait.
 *
 * sleep-justified: nothing observable says the FSEvents stream has started, so there is no condition to wait on.
 */
export function watchStarted(): Promise<void> {
  return process.platform === 'darwin' ? new Promise((resolve) => setTimeout(resolve, 300)) : Promise.resolve();
}
