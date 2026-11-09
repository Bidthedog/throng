import type { TerminalOutputNotification } from '@throng/ipc-contract';

type OutputListener = (delivery: TerminalOutputNotification) => void;

interface OutputBridge {
  onOutput(listener: OutputListener): () => void;
}

interface Router {
  views: Map<string, Set<OutputListener>>;
  off: () => void;
}

const routers = new WeakMap<OutputBridge, Router>();

/**
 * One output listener per window, however many terminal views it has (061 FR-007): each delivery goes straight to the
 * views of the terminal it belongs to, rather than every view inspecting every delivery.
 */
export function subscribeTerminalOutput(bridge: OutputBridge, panelId: string, listener: OutputListener): () => void {
  let router = routers.get(bridge);
  if (!router) {
    const views = new Map<string, Set<OutputListener>>();
    const off = bridge.onOutput((delivery) => {
      // A copy: a listener may leave while the delivery is going out.
      for (const view of [...(views.get(delivery.panelId) ?? [])]) view(delivery);
    });
    router = { views, off };
    routers.set(bridge, router);
  }
  const { views } = router;
  let forPanel = views.get(panelId);
  if (!forPanel) {
    forPanel = new Set();
    views.set(panelId, forPanel);
  }
  forPanel.add(listener);
  const held = forPanel;
  return () => {
    held.delete(listener);
    if (held.size > 0) return;
    views.delete(panelId);
    if (views.size > 0) return;
    router.off();
    routers.delete(bridge);
  };
}
