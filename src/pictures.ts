import { call, fileUrl } from './bridge';

const sizes = new Map<string, Promise<{ width: number; height: number }>>();

/** The width and height of a picture of the library. */
export function sizeOf(path: string): Promise<{ width: number; height: number }> {
  let known = sizes.get(path);
  if (!known) {
    known = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('The picture did not load. Try again.'));
      image.src = fileUrl(path);
    });
    sizes.set(path, known);
  }
  return known;
}

export async function blobOf(path: string): Promise<Blob> {
  const answer = await fetch(fileUrl(path));
  if (!answer.ok) throw new Error(await answer.text());
  return answer.blob();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The picture did not load. Try again.'));
    image.src = src;
  });
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be made. Try again.'))),
      'image/png',
    ),
  );
}

export async function upload(name: string, blob: Blob): Promise<string> {
  const { asset } = await call('hearthscale/ui/upload-file', { name, mediaType: 'image/png', blob });
  return asset;
}

/** The largest picture a person's own file becomes, as an area. */
const OPENED_AREA = 1024 * 1024;

/** A picture the person opened, made a PNG a job takes: scaled down to the
 *  area a model draws well and cut to multiples of 64 on each side. */
export async function prepared(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, Math.sqrt(OPENED_AREA / (image.naturalWidth * image.naturalHeight)));
    const scaledWidth = image.naturalWidth * scale;
    const scaledHeight = image.naturalHeight * scale;
    const width = Math.max(64, Math.floor(scaledWidth / 64) * 64);
    const height = Math.max(64, Math.floor(scaledHeight / 64) * 64);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas
      .getContext('2d')!
      .drawImage(image, (width - scaledWidth) / 2, (height - scaledHeight) / 2, scaledWidth, scaledHeight);
    return await toPng(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One drag of the brush, in the picture's own pixels. */
export interface Stroke {
  size: number;
  erase: boolean;
  points: { x: number; y: number }[];
}

/** Draws strokes in one ink onto a context the size of their picture; a
 *  stroke that rubs out clears what the strokes before it drew. */
export function paintStrokes(context: CanvasRenderingContext2D, strokes: Stroke[], ink: string): void {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = ink;
  for (const stroke of strokes) {
    const [first, ...rest] = stroke.points;
    context.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    context.lineWidth = stroke.size;
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const point of rest.length ? rest : [first]) context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.globalCompositeOperation = 'source-over';
}

/** A mask a job takes from the strokes of the brush: white where the
 *  strokes cover the picture, black elsewhere. */
export async function maskOf(strokes: Stroke[], width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  paintStrokes(context, strokes, 'white');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const on = pixels.data[i + 3] > 0 ? 255 : 0;
    pixels.data[i] = on;
    pixels.data[i + 1] = on;
    pixels.data[i + 2] = on;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return toPng(canvas);
}

/** How many pixels each side of a picture grows by. */
export interface Margins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The margins an extend adds: a share of the picture's width or height
 *  on each chosen side, as a multiple of 64. */
export function marginsOf(
  size: { width: number; height: number },
  sides: { left: boolean; right: boolean; top: boolean; bottom: boolean },
  share: number,
): Margins {
  const grow = (side: number) => Math.max(64, Math.round((side * share) / 64) * 64);
  return {
    left: sides.left ? grow(size.width) : 0,
    right: sides.right ? grow(size.width) : 0,
    top: sides.top ? grow(size.height) : 0,
    bottom: sides.bottom ? grow(size.height) : 0,
  };
}

/** Where an extended picture's new border overlaps the old picture, so the
 *  seam is drawn anew too. */
const SEAM = 16;

/** The picture of an extend and its mask: the picture in place on a larger
 *  canvas, the new border filled with a blur of the picture so the model
 *  starts from its colours, and a mask that is white over the border. The
 *  picture is drawn from its bytes, so the canvas can be read back. */
export async function extended(
  path: string,
  margins: Margins,
): Promise<{ image: Blob; mask: Blob; width: number; height: number }> {
  const picture = await createImageBitmap(await blobOf(path));
  const width = picture.width + margins.left + margins.right;
  const height = picture.height + margins.top + margins.bottom;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.filter = 'blur(32px)';
  context.drawImage(picture, 0, 0, width, height);
  context.filter = 'none';
  context.drawImage(picture, margins.left, margins.top);

  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const ink = mask.getContext('2d')!;
  ink.fillStyle = '#ffffff';
  ink.fillRect(0, 0, width, height);
  ink.fillStyle = '#000000';
  const inset = (margin: number) => (margin > 0 ? SEAM : 0);
  ink.fillRect(
    margins.left + inset(margins.left),
    margins.top + inset(margins.top),
    picture.width - inset(margins.left) - inset(margins.right),
    picture.height - inset(margins.top) - inset(margins.bottom),
  );

  return { image: await toPng(canvas), mask: await toPng(mask), width, height };
}

/** A file name for a saved picture, from its words and its number. */
export function fileName(prompt: string, seed: number | null): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${words || 'picture'}${seed !== null ? `-${seed}` : ''}.png`;
}
