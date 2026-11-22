/**
 * Where a panel's modal dialogs are drawn: one element at the document's top level, outside every panel.
 *
 * A panel is its own stacking context (`.panel-box { isolation: isolate }`), so a dialog drawn inside one is painted
 * over by the panels after it in the layout and by the side panes (MT-102 / MT-104 walk-through, 2026-11-21). A portal
 * into this host draws it above them all, while React events still bubble through the component tree.
 *
 * A host of its own rather than `document.body` itself: whatever clears the body (a window being torn down, a test
 * between cases) detaches the host with the dialog still in it, and React can still remove the dialog from the host;
 * the next dialog re-attaches it.
 */
const HOST_ID = 'throng-dialog-host';

export function dialogHost(): HTMLElement {
  let host = document.getElementById(HOST_ID);
  if (host === null) {
    host = document.createElement('div');
    host.id = HOST_ID;
  }
  if (!host.isConnected) document.body.appendChild(host);
  return host;
}
