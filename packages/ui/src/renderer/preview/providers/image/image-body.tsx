/**
 * The Image provider's body (074 FR-020 – FR-028): the file at its `throng-preview://source` URL, drawn as a picture
 * through the shared one-drawing body, so it carries a Mermaid preview's controls exactly (FR-030, FR-031).
 *
 * - The URL carries the run's revision, so a file rewritten on disk is a new source and redraws (FR-023); the frame
 *   stays mounted and keeps the reader's view mode.
 * - Its bytes, for Copy Image and the reduced-motion first frame, come through `readSource` — read once per
 *   revision, and only when needed — so the canvas the rasteriser draws on is never tainted (research R4).
 * - The status readout names the picture's pixel size and file size, digit-grouped (FR-022).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { formatGrouped } from '@throng/core';
import type { PreviewBodyProps } from '../../provider-view.js';
import { imageUrlEntry, prefersReducedMotion } from '../../blocks/picture.js';
import { DiagramFileBody } from '../../diagram/diagram-file-body.js';
import { zoomPercent } from '../../zoom-titles.js';

/** `1,920 × 1,080 pixels · 2,345,678 bytes`, the size part only once it is known. */
export function imageReadout(size: { width: number; height: number }, bytes: number | null, scale: number | null = null): string {
  const pixels = `${formatGrouped(size.width)} × ${formatGrouped(size.height)} pixels`;
  const sized = bytes === null ? pixels : `${pixels} · ${formatGrouped(bytes)} bytes`;
  return scale === null ? sized : `${sized} · ${zoomPercent(scale)}`;
}

export function ImageBody(props: PreviewBodyProps): ReactElement {
  const url = props.content.kind === 'resource' ? props.content.url : '';
  const readSourceRef = useRef(props.readSource);
  readSourceRef.current = props.readSource;
  const onReadoutRef = useRef(props.onStatusReadout);
  onReadoutRef.current = props.onStatusReadout;
  const [measured, setMeasured] = useState<{ url: string; width: number; height: number } | null>(null);
  const [bytes, setBytes] = useState<{ url: string; size: number } | null>(null);
  // 074 (2026-11-20) — the zoom the picture is shown at, beside its size in the status bar.
  const [scale, setScale] = useState<number | null>(null);

  // One read per revision, shared by the readout, Copy Image and the first frame.
  const reads = useRef(new Map<string, Promise<Blob | null>>());
  const readBytes = useRef((forUrl: string): Promise<Blob | null> => {
    let read = reads.current.get(forUrl);
    if (read === undefined) {
      const reader = readSourceRef.current;
      read =
        reader === undefined
          ? Promise.resolve(null)
          : reader().then((r) => (r.ok ? new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: r.mime }) : null));
      reads.current.clear();
      reads.current.set(forUrl, read);
    }
    return read;
  }).current;
  const entry = useMemo(
    () =>
      imageUrlEntry({
        reducedMotion: prefersReducedMotion,
        onMeasured: (size) => setMeasured({ url, ...size }),
        readBytes,
      }),
    [url, readBytes],
  );

  // The file size for the readout: the same one read, once the picture has been measured.
  useEffect(() => {
    if (measured === null || measured.url !== url) return;
    let live = true;
    void readBytes(url).then((blob) => {
      if (live && blob !== null) setBytes({ url, size: blob.size });
    });
    return () => {
      live = false;
    };
  }, [measured, url, readBytes]);

  useEffect(() => {
    if (measured === null || measured.url !== url) return;
    onReadoutRef.current?.(imageReadout(measured, bytes?.url === url ? bytes.size : null, scale));
  }, [measured, bytes, url, scale]);
  useEffect(() => () => onReadoutRef.current?.(null), []);

  return (
    <DiagramFileBody
      body={props}
      source={url}
      entry={entry}
      name="preview-image"
      // FR-020a — 100%, or Fit when the image is larger than the panel.
      initialMode="open"
      scrolls
      hatch={props.providerSettings.transparencyHatch !== false}
      onScale={setScale}
    />
  );
}
