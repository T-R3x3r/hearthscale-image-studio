import type { Swatch } from '@hearthscale/app-ui';
import type { Picture } from './records';

/** The marker colours in the order the person meets them. One colour marks
 *  one area of the picture. `paint` is the colour an edit model sees the
 *  area filled with, in its reference picture: a plain, saturated colour
 *  of the same name, whatever the theme draws the marks in. */
export const MARKERS: readonly { swatch: Swatch; name: string; paint: [number, number, number] }[] = [
  { swatch: 'rose', name: 'Red', paint: [230, 30, 30] },
  { swatch: 'ocean', name: 'Blue', paint: [30, 80, 230] },
  { swatch: 'moss', name: 'Green', paint: [30, 170, 50] },
  { swatch: 'amber', name: 'Orange', paint: [245, 140, 20] },
];

export const markerName = (swatch: Swatch) => MARKERS.find((marker) => marker.swatch === swatch)!.name;

/** The most pictures one area takes beside the picture it changes: each
 *  one costs the job about the time of a picture of its own. */
export const AREA_REFERENCES = 3;

/** One colour's marks over the picture, and what goes there. */
export interface Area {
  swatch: Swatch;
  words: string;
  references: Picture[];
  /** The marks at the picture's own size, in the colour's ink. A pixel at
   *  least half opaque is marked. */
  canvas: HTMLCanvasElement;
}

export interface Point {
  x: number;
  y: number;
}

const inkOf = (swatch: Swatch) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--swatch-${swatch}`).trim();

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function line(context: CanvasRenderingContext2D, from: Point, to: Point, size: number) {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = size;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

/** Whether a pixel of a mask canvas, by its alpha, counts as marked. */
const MARKED = 128;

function marked(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] >= MARKED) return true;
  return false;
}

/** The areas marked on one picture. A pixel belongs to one area at most:
 *  painting in one colour takes the pixel from every other colour. The
 *  canvases change in place as the person paints; `version` moves with
 *  every change a view draws from. */
export class Marks {
  areas: Area[] = [];
  width = 0;
  height = 0;
  /** The picture's pixels per pixel of the screen, as the marks are drawn
   *  now: the brush's size and the soft edge are set in the screen's. */
  scale = 1;
  version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Drops every mark, for a picture of this size. */
  reset(width: number, height: number) {
    if (this.areas.length === 0 && this.width === width && this.height === height) return;
    this.areas = [];
    this.width = width;
    this.height = height;
    this.changed();
  }

  find(swatch: Swatch): Area | undefined {
    return this.areas.find((area) => area.swatch === swatch);
  }

  private area(swatch: Swatch): Area {
    const found = this.find(swatch);
    if (found) return found;
    const canvas = canvasOf(this.width, this.height);
    canvas.className = 'is-marks-layer';
    const area: Area = { swatch, words: '', references: [], canvas };
    this.areas = [...this.areas, area];
    this.changed();
    return area;
  }

  private others(swatch: Swatch | null): Area[] {
    return this.areas.filter((area) => area.swatch !== swatch);
  }

  /** Takes what `draw` covers from every colour but `swatch`. */
  private clear(swatch: Swatch | null, draw: (context: CanvasRenderingContext2D) => void) {
    for (const other of this.others(swatch)) {
      const context = other.canvas.getContext('2d')!;
      context.globalCompositeOperation = 'destination-out';
      draw(context);
      context.globalCompositeOperation = 'source-over';
    }
  }

  /** Paints a line of the brush in a colour, or erases every colour along
   *  it where `swatch` is null. */
  stroke(swatch: Swatch | null, from: Point, to: Point, size: number) {
    if (swatch) {
      const context = this.area(swatch).canvas.getContext('2d')!;
      context.strokeStyle = inkOf(swatch);
      line(context, from, to, size);
    }
    this.clear(swatch, (context) => line(context, from, to, size));
  }

  rectangle(swatch: Swatch, x: number, y: number, width: number, height: number) {
    const context = this.area(swatch).canvas.getContext('2d')!;
    context.fillStyle = inkOf(swatch);
    context.fillRect(x, y, width, height);
    this.clear(swatch, (each) => each.fillRect(x, y, width, height));
  }

  /** Marks in a colour everything that no colour marks yet, and lets go of
   *  what the colour marked. */
  invert(swatch: Swatch) {
    const area = this.area(swatch);
    const rest = canvasOf(this.width, this.height);
    const context = rest.getContext('2d')!;
    context.fillStyle = inkOf(swatch);
    context.fillRect(0, 0, this.width, this.height);
    context.globalCompositeOperation = 'destination-out';
    for (const each of this.areas) context.drawImage(each.canvas, 0, 0);
    const own = area.canvas.getContext('2d')!;
    own.globalCompositeOperation = 'copy';
    own.drawImage(rest, 0, 0);
    own.globalCompositeOperation = 'source-over';
    this.settle();
  }

  /** Ends a move of a tool: an area left with no marks goes. */
  settle() {
    this.areas = this.areas.filter((area) => marked(area.canvas));
    this.changed();
  }

  drop(swatch: Swatch) {
    this.areas = this.others(swatch);
    this.changed();
  }

  private edit(swatch: Swatch, change: (area: Area) => Partial<Area>) {
    this.areas = this.areas.map((area) => (area.swatch === swatch ? { ...area, ...change(area) } : area));
    this.changed();
  }

  setWords(swatch: Swatch, words: string) {
    this.edit(swatch, () => ({ words }));
  }

  addReference(swatch: Swatch, picture: Picture) {
    this.edit(swatch, (area) => ({
      references: area.references.some((r) => r.id === picture.id)
        ? area.references
        : [...area.references, picture].slice(0, AREA_REFERENCES),
    }));
  }

  dropReference(swatch: Swatch, id: string) {
    this.edit(swatch, (area) => ({ references: area.references.filter((r) => r.id !== id) }));
  }

  /** Swaps each picture an area holds for its fresh record, such as after
   *  its file moved. */
  renew(fresh: (picture: Picture) => Picture) {
    if (this.areas.length === 0) return;
    this.areas = this.areas.map((area) => ({ ...area, references: area.references.map(fresh) }));
    this.changed();
  }

  /** Drops the pictures that left the library from every area. */
  forget(ids: Set<string>) {
    if (!this.areas.some((area) => area.references.some((r) => ids.has(r.id)))) return;
    this.areas = this.areas.map((area) => ({ ...area, references: area.references.filter((r) => !ids.has(r.id)) }));
    this.changed();
  }

  /** Paints each area again in its colour's ink, as the theme has it now. */
  recolor() {
    for (const area of this.areas) {
      const context = area.canvas.getContext('2d')!;
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = inkOf(area.swatch);
      context.fillRect(0, 0, this.width, this.height);
      context.globalCompositeOperation = 'source-over';
    }
  }
}

/** Which pixels an area marks: 1 where it marks, 0 elsewhere. */
export function maskOf(area: Area): Uint8Array {
  const { data } = area.canvas.getContext('2d')!.getImageData(0, 0, area.canvas.width, area.canvas.height);
  const mask = new Uint8Array(data.length / 4);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= MARKED ? 1 : 0;
  return mask;
}

/** A mask as the PNG a job takes: white where the job draws anew. */
export function maskPng(mask: Uint8Array, width: number, height: number): Promise<Blob> {
  const canvas = canvasOf(width, height);
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const on = mask[i] ? 255 : 0;
    pixels.data.set([on, on, on, 255], i * 4);
  }
  context.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The mask could not be made.'))), 'image/png'),
  );
}

const FAR = 1e20;

/** The squared distance of each sample to the nearest sample whose cost is
 *  0, along one line (Felzenszwalb and Huttenlocher). */
function distances1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** How much of a job's picture each pixel takes: none outside the marks,
 *  all of it deeper inside them than `soft` pixels, and a smooth rise in
 *  between, so the change blends in while every pixel outside the marks
 *  keeps its own value. */
export function blendOf(mask: Uint8Array, width: number, height: number, soft: number): Float32Array {
  const blend = new Float32Array(mask.length);
  if (soft <= 0) {
    for (let i = 0; i < mask.length; i++) blend[i] = mask[i];
    return blend;
  }
  const grid = new Float64Array(mask.length);
  for (let i = 0; i < mask.length; i++) grid[i] = mask[i] ? FAR : 0;
  const longest = Math.max(width, height);
  const f = new Float64Array(longest);
  const d = new Float64Array(longest);
  const v = new Int32Array(longest);
  const z = new Float64Array(longest + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    distances1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = grid[row + x];
    distances1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[row + x] = d[x];
  }
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const t = Math.min(1, Math.sqrt(grid[i]) / soft);
    blend[i] = t * t * (3 - 2 * t);
  }
  return blend;
}

/** Lays a job's picture into the picture by the blend, pixel by pixel,
 *  its transparency included. */
export function blendInto(base: ImageData, result: ImageData, blend: Float32Array): void {
  const to = base.data;
  const from = result.data;
  for (let i = 0, p = 0; i < blend.length; i++, p += 4) {
    const share = blend[i];
    if (share === 0) continue;
    for (let c = 0; c < 4; c++)
      to[p + c] = share === 1 ? from[p + c] : Math.round(to[p + c] + (from[p + c] - to[p + c]) * share);
  }
}

/** A copy of the picture with an area filled in its marker's paint, which
 *  shows an edit model where the area lies. */
export function paintedWith(base: ImageData, mask: Uint8Array, swatch: Swatch): ImageData {
  const painted = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  const [r, g, b] = MARKERS.find((marker) => marker.swatch === swatch)!.paint;
  for (let i = 0; i < mask.length; i++) if (mask[i]) painted.data.set([r, g, b, 255], i * 4);
  return painted;
}
