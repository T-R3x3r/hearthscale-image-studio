/** The shapes a picture takes, as width over height. */
export const SHAPES = [
  { id: 'square', label: 'Square', ratio: 1 },
  { id: 'portrait', label: 'Portrait', ratio: 2 / 3 },
  { id: 'landscape', label: 'Landscape', ratio: 3 / 2 },
  { id: 'wide', label: 'Wide', ratio: 16 / 9 },
] as const;
export type ShapeId = (typeof SHAPES)[number]['id'];

/** The sizes a picture takes: the side of a square of the same area. */
export const SIZES = [
  { id: 'small', label: 'Small', side: 512 },
  { id: 'medium', label: 'Medium', side: 768 },
  { id: 'large', label: 'Large', side: 1024 },
] as const;
export type SizeId = (typeof SIZES)[number]['id'];

/** The width and height of a shape at a size, both multiples of 64: the
 *  short side nearest the one that keeps the area, the long side the
 *  largest that keeps the area at or under the square's. */
export function dimensions(shape: ShapeId, size: SizeId): { width: number; height: number } {
  const { ratio } = SHAPES.find((s) => s.id === shape)!;
  const side = SIZES.find((s) => s.id === size)!.side;
  const area = side * side;
  const short = Math.max(64, Math.round(Math.sqrt(area * Math.min(ratio, 1 / ratio)) / 64) * 64);
  const long = Math.max(short, Math.floor(area / short / 64) * 64);
  return ratio >= 1 ? { width: long, height: short } : { width: short, height: long };
}

/** A look the words of a prompt take on. */
export interface Style {
  id: string;
  label: string;
  words: string;
  avoid?: string;
}

export const STYLES: Style[] = [
  { id: 'photo', label: 'Photo', words: 'photograph, natural light, sharp focus, fine detail' },
  { id: 'film', label: 'Film still', words: 'cinematic film still, dramatic lighting, shallow depth of field' },
  { id: 'illustration', label: 'Illustration', words: 'digital illustration, clean lines, vibrant colours' },
  { id: 'watercolour', label: 'Watercolour', words: 'watercolour painting, soft washes, paper texture' },
  { id: 'oil', label: 'Oil painting', words: 'oil painting, visible brush strokes, rich colours' },
  { id: 'sketch', label: 'Pencil sketch', words: 'pencil sketch, graphite, hand drawn, monochrome', avoid: 'colour' },
  { id: 'anime', label: 'Anime', words: 'anime style, cel shading, bold outlines' },
  { id: 'render', label: '3D render', words: '3D render, soft studio lighting, smooth materials' },
  { id: 'pixel', label: 'Pixel art', words: 'pixel art, 16-bit, limited palette' },
  { id: 'icon', label: 'Flat icon', words: 'flat vector icon, simple shapes, solid colours, plain background' },
  { id: 'vintage', label: 'Vintage photo', words: 'vintage photograph, film grain, faded colours' },
];

export function withStyle(prompt: string, style: string | null): { prompt: string; avoid: string } {
  const look = STYLES.find((s) => s.id === style);
  if (!look) return { prompt, avoid: '' };
  return { prompt: `${prompt}, ${look.words}`, avoid: look.avoid ?? '' };
}

/** Words that start a first picture. */
export const IDEAS = [
  'A lighthouse on a cliff at dusk',
  'A cat in a tiny space suit',
  'A cosy cabin in deep snow, warm windows',
  'A bowl of ramen seen from above',
  'A city street in the rain at night, neon signs',
  'A friendly robot watering plants',
];

/** The words an erase draws in place of what the brush covered. */
export const ERASE_WORDS = 'the empty background behind it, seamless, nothing there';

/** The instruction that takes a picture's background away. */
export const PLAIN_BACKGROUND_WORDS =
  'Remove the background. Keep the main subject exactly as it is, on a plain white background.';

/** How far "Vary a little" and "Vary a lot" move from a picture. */
export const VARY = { little: 0.35, lot: 0.7 } as const;
