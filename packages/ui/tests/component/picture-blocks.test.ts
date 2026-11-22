/**
 * 074 research R2, R3, R9 — the picture renderers on the block-renderer seam: the one-`<image>` wrapper, an SVG's
 * intrinsic size, its isolation (the source never becomes DOM), its failure notices, and the image renderer's
 * pixel bound and measurements.
 *
 * Layer: component — needs a DOM (DOMParser, SVG elements); jsdom decodes no image, so the loader is a fake.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  drawSvgSource,
  imageUrlEntry,
  MAX_IMAGE_PIXELS,
  svgIntrinsicSize,
  SVG_DRAW_TIMEOUT_MS,
  type PictureLoader,
} from '../../src/renderer/preview/blocks/picture.js';
import { blockRendererFor } from '../../src/renderer/preview/blocks/block-renderers.js';

const HOSTILE = readFileSync(join(__dirname, '..', 'fixtures', 'preview', 'hostile.svg'), 'utf8');
const ok: PictureLoader = { load: () => Promise.resolve({ width: 10, height: 10 }) };

let urls = 0;
beforeEach(() => {
  urls = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++urls}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('svgIntrinsicSize (FR-043)', () => {
  it('reads width and height, with or without px', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40px"/>')).toEqual({ width: 120, height: 40 });
  });

  it('falls back to the viewBox, keeping its aspect when one length is given', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"/>')).toEqual({ width: 200, height: 100 });
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="50" viewBox="0 0 200 100"/>')).toEqual({ width: 50, height: 25 });
  });

  it('draws at 300 × 150 with neither', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="50%"/>')).toEqual({ width: 300, height: 150 });
  });

  it('names a malformed file and a non-SVG root', () => {
    expect(() => svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>')).toThrow(/not well formed/);
    expect(() => svgIntrinsicSize('<html/>')).toThrow(/not an SVG/);
  });
});

describe('drawSvgSource — an isolated picture (FR-040, FR-044, FR-045)', () => {
  it('returns a one-<image> wrapper whose href is a blob of the source, typed image/svg+xml', async () => {
    const wrapper = await drawSvgSource('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"/>', ok);
    expect(wrapper.getAttribute('viewBox')).toBe('0 0 8 4');
    const images = wrapper.querySelectorAll('image');
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute('href')).toMatch(/^blob:/);
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('image/svg+xml');
  });

  it('never puts the hostile source into the document: no script, handler, foreignObject or remote href', async () => {
    const wrapper = await drawSvgSource(HOSTILE, ok);
    document.body.appendChild(wrapper);
    try {
      expect(document.querySelector('script, foreignObject')).toBeNull();
      expect(document.querySelector('[onload], [onclick]')).toBeNull();
      expect(wrapper.innerHTML).not.toMatch(/https?:/);
      expect(wrapper.children).toHaveLength(1);
    } finally {
      wrapper.remove();
    }
  });

  it('rejects with a message when the picture will not decode', async () => {
    const bad: PictureLoader = { load: () => Promise.reject(new Error('decode')) };
    await expect(drawSvgSource('<svg xmlns="http://www.w3.org/2000/svg"/>', bad)).rejects.toThrow('could not be drawn as a picture');
  });

  it('rejects once the draw takes longer than the bound', async () => {
    vi.useFakeTimers();
    const slow: PictureLoader = { load: () => new Promise(() => undefined) };
    const drawn = drawSvgSource('<svg xmlns="http://www.w3.org/2000/svg"/>', slow);
    const assertion = expect(drawn).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(SVG_DRAW_TIMEOUT_MS + 1);
    await assertion;
  });

  it('is registered as the ```svg fence renderer (FR-054)', () => {
    expect(blockRendererFor('svg')?.noun).toBe('SVG');
  });
});

describe('imageUrlEntry (FR-020 – FR-025)', () => {
  it('measures the picture, reports it, and wraps the URL itself', async () => {
    const onMeasured = vi.fn();
    const renderer = await imageUrlEntry({ loader: { load: () => Promise.resolve({ width: 64, height: 32 }) }, onMeasured }).load();
    const wrapper = await renderer.render('throng-preview://source/p?rev=1', { theme: {} as never });
    expect(onMeasured).toHaveBeenCalledWith({ width: 64, height: 32 });
    expect(wrapper.querySelector('image')?.getAttribute('href')).toBe('throng-preview://source/p?rev=1');
    expect(wrapper.getAttribute('width')).toBe('64');
  });

  it('refuses a picture over the pixel bound before it is drawn (FR-025)', async () => {
    const huge: PictureLoader = { load: () => Promise.resolve({ width: 30_000, height: 30_000 }) };
    const renderer = await imageUrlEntry({ loader: huge }).load();
    expect(30_000 * 30_000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    await expect(renderer.render('u', { theme: {} as never })).rejects.toThrow(/30,000 × 30,000 pixels/);
  });

  // 074 convergence T066 — FR-025, "huge dimensions, small file": the bound is applied from the measured size, before
  // the bitmap is decoded — a 30,000 × 30,000 picture is never decoded at all.
  it('refuses a picture over the pixel bound without decoding it (FR-025)', async () => {
    const decode = vi.fn(() => Promise.resolve({ width: 30_000, height: 30_000 }));
    const huge: PictureLoader = { measure: () => Promise.resolve({ width: 30_000, height: 30_000 }), load: decode };
    const renderer = await imageUrlEntry({ loader: huge }).load();
    await expect(renderer.render('u', { theme: {} as never })).rejects.toThrow(/30,000 × 30,000 pixels/);
    expect(decode, 'the bitmap was decoded').not.toHaveBeenCalled();
  });

  it('decodes a picture inside the bound once it is measured (FR-020)', async () => {
    const decode = vi.fn(() => Promise.resolve({ width: 64, height: 32 }));
    const renderer = await imageUrlEntry({ loader: { measure: () => Promise.resolve({ width: 64, height: 32 }), load: decode } }).load();
    await renderer.render('u', { theme: {} as never });
    expect(decode).toHaveBeenCalledWith('u');
  });

  it('names an undecodable file plainly, never with the raw error (FR-024)', async () => {
    const renderer = await imageUrlEntry({ loader: { load: () => Promise.reject(new Error('EncodingError: xyz')) } }).load();
    await expect(renderer.render('u', { theme: {} as never })).rejects.toThrow('This file is not an image throng can show.');
  });
});

describe('the reduced-motion first frame (074 FR-026)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Each redraw of a regenerated picture (a new `?rev=`) drew a new first-frame PNG and kept every one alive.
  it('holds a bounded number of first-frame URLs however often the picture is redrawn', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4, height: 4, close: () => {} })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done: BlobCallback) => {
      done(new Blob(['png'], { type: 'image/png' }));
    });
    const renderer = await imageUrlEntry({ loader: ok, readBytes: async () => new Blob(['gif']), reducedMotion: () => true }).load();
    for (let rev = 0; rev < 100; rev++) await renderer.render(`throng-preview://p/a.gif?rev=${rev}`, { theme: {} as never });

    const created = vi.mocked(URL.createObjectURL).mock.calls.length;
    const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.length;
    expect(created).toBe(100);
    expect(created - revoked).toBeLessThanOrEqual(64);
  });
});
