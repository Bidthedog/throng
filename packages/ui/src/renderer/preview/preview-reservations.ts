/**
 * The reservation a freshly PLACED preview carries to its first attach (044 FR-012,
 * contracts/preview-ipc.md §1 `open` / `attach`, §2 `place`).
 *
 * Main answers `open` with a reservation that holds the path, so two opens in quick succession can
 * never place two previews. The renderer places the panel with a layout write, and the panel's
 * component mounts a commit later and attaches — so the reservation has to wait somewhere between the
 * two. `openPreview` records it here under the new panel's id before typing the panel; `PreviewPanel`
 * sends it with its attach and clears it once main has answered.
 *
 * Module-level, like `preview-store`: one window, one map, and a panel id is unique.
 */
const reservations = new Map<string, string>();

/** Record the reservation main granted for the preview about to mount as `panelId`. */
export function setPreviewReservation(panelId: string, reservation: string): void {
  reservations.set(panelId, reservation);
}

/** The reservation waiting for `panelId`'s attach, if any. Read, not taken: a retried attach needs it too. */
export function previewReservationFor(panelId: string): string | undefined {
  return reservations.get(panelId);
}

/** Main has answered the attach that carried it — consumed or refused, it is spent. */
export function clearPreviewReservation(panelId: string): void {
  reservations.delete(panelId);
}

/** Tests only. */
export function __resetPreviewReservations(): void {
  reservations.clear();
}
