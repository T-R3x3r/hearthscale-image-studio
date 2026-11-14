/** The shapes a picture takes, as width over height. */
export const SHAPES = [
  { id: 'square', label: 'Square', ratio: 1 },
  { id: 'portrait', label: 'Portrait', ratio: 2 / 3 },
  { id: 'landscape', label: 'Landscape', ratio: 3 / 2 },
  { id: 'wide', label: 'Wide', ratio: 16 / 9 },
] as const;
export type ShapeId = (typeof SHAPES)[number]['id'];

/** The sizes a picture takes: the side of a square of the same area, as a
 *  share of the side of the square a model draws at first. */
export const SIZES = [
  { id: 'small', label: 'Small', share: 0.5 },
  { id: 'medium', label: 'Medium', share: 0.75 },
  { id: 'large', label: 'Large', share: 1 },
] as const;
export type SizeId = (typeof SIZES)[number]['id'];

/** The width and height of a shape at a size of a model's side, both
 *  multiples of 64: the short side nearest the one that keeps the area, the
 *  long side the largest that keeps the area at or under the square's. */
export function dimensions(shape: ShapeId, size: SizeId, model: number): { width: number; height: number } {
  const { ratio } = SHAPES.find((s) => s.id === shape)!;
  const side = SIZES.find((s) => s.id === size)!.share * model;
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

/** The words of a marked area the person left empty: what was there goes. */
export const REMOVE_WORDS =
  'Remove every object, person, text and interface element in front of the scene, and show the background behind them, seamless, as if nothing had ever been there.';

/** The words of a marked area that holds pictures but no words of its own. */
export const REFERENCE_WORDS = 'Put the subject of the added picture here, matching the light and the scene.';

/** Changes of the whole picture that take one press, for a model that
 *  follows reference pictures. */
export const QUICK = [
  {
    id: 'text',
    label: 'Remove all text',
    icon: 't-box-line',
    words:
      'Remove all text from the picture: letters, numbers, captions, signs with writing, logos with words and watermarks. Fill each place with what would be behind it. Keep everything else exactly as it is.',
  },
  {
    id: 'interface',
    label: 'Remove the interface',
    icon: 'gamepad-line',
    words:
      'Remove the game or app interface from the picture: menus, buttons, icons, health and status bars, maps, crosshairs, score and text overlays. Show only the scene behind them, filled in naturally. Keep everything else exactly as it is.',
  },
  {
    id: 'night',
    label: 'Make it night',
    icon: 'moon-line',
    words:
      'Make it night: a dark sky, moonlight, and the lights of the scene switched on, with realistic shadows. Keep the scene, the people and the composition exactly as they are.',
  },
  {
    id: 'background',
    label: 'Remove the background',
    icon: 'scissors-cut-line',
    words: 'Remove the background. Keep the main subject exactly as it is, on a plain white background.',
  },
] as const;

/** How far a change of the whole picture may move from it, for a model that
 *  draws a picture again from a picture. */
export const CHANGES = [
  { id: 'small', label: 'Small change', strength: 0.4 },
  { id: 'medium', label: 'Medium change', strength: 0.6 },
  { id: 'big', label: 'Big change', strength: 0.8 },
] as const;
export type ChangeId = (typeof CHANGES)[number]['id'];

/** How far "Vary a little" and "Vary a lot" move from a picture. */
export const VARY = { little: 0.35, lot: 0.7 } as const;
