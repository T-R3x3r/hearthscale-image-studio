import type { ModelCard } from '@hearthscale/app';
import { call, on } from './bridge';

interface Property {
  maximum?: number;
  minimum?: number;
  default?: number;
}

/** What an image model takes, read from the input schema its card states. */
export interface Abilities {
  /** Starts from a picture and moves away from it as far as `strength` says. */
  change: boolean;
  /** Draws a masked part of a picture anew. */
  fill: boolean;
  /** Reads reference pictures, which a model made for editing follows. */
  edit: boolean;
  /** Takes a width and a height. */
  size: boolean;
  negative: boolean;
  seed: boolean;
  steps: boolean;
  guidance: boolean;
  /** The steps and the guidance the model takes when the job names none. */
  stepsDefault: number;
  guidanceDefault: number;
  /** The most pictures one job draws. */
  count: number;
  strength: number;
}

export function abilitiesOf(card: ModelCard | undefined): Abilities {
  const input = card?.jobs?.image?.input as { properties?: Record<string, Property> } | undefined;
  const props = input?.properties ?? {};
  return {
    change: 'image' in props,
    fill: 'mask' in props,
    edit: 'references' in props,
    size: 'width' in props && 'height' in props,
    negative: 'negativePrompt' in props,
    seed: 'seed' in props,
    steps: 'steps' in props,
    guidance: 'guidance' in props,
    stepsDefault: props.steps?.default ?? 20,
    guidanceDefault: props.guidance?.default ?? 7,
    count: props.count?.maximum ?? 1,
    strength: props.strength?.default ?? 0.75,
  };
}

/** The image and upscale models the person can run now, and the ones a
 *  Server can install, kept fresh as downloads move. */
export interface Models {
  image: ModelCard[];
  upscale: ModelCard[];
  chat: ModelCard | null;
  /** The image model the platform picks for the app. */
  chosen: string | null;
  /** Why the platform picks no image model for the app, in Hearthscale's words. */
  unavailable: string | null;
  /** The upscale model the platform picks for the app. */
  upscaleChosen: string | null;
  absentImage: ModelCard[];
  absentUpscale: ModelCard[];
  downloading: ModelCard[];
}

export async function readModels(): Promise<Models> {
  const [image, upscale, chat, absentImage, absentUpscale, downloadingImage, downloadingUpscale] = await Promise.all([
    call('hearthscale/models/list', { kind: 'image' }),
    call('hearthscale/models/list', { kind: 'upscale' }),
    call('hearthscale/models/list', { kind: 'chat' }),
    call('hearthscale/models/list', { kind: 'image', state: 'absent' }),
    call('hearthscale/models/list', { kind: 'upscale', state: 'absent' }),
    call('hearthscale/models/list', { kind: 'image', state: 'downloading' }),
    call('hearthscale/models/list', { kind: 'upscale', state: 'downloading' }),
  ]);
  const chatCard = chat.chosen.chat?.card;
  const imageChoice = image.chosen.image;
  return {
    image: image.cards,
    upscale: upscale.cards,
    chat: chat.cards.find((card) => card.id === chatCard) ?? null,
    chosen: imageChoice?.card ?? null,
    unavailable: imageChoice && 'reason' in imageChoice ? imageChoice.reason : null,
    upscaleChosen: upscale.chosen.upscale?.card ?? null,
    absentImage: absentImage.cards,
    absentUpscale: absentUpscale.cards,
    downloading: [...downloadingImage.cards, ...downloadingUpscale.cards],
  };
}

/** Calls `fn` with each move of a download of any Server's models. */
export function onDownload(
  fn: (download: {
    card: string;
    state: string;
    progress?: { receivedBytes: number; totalBytes: number };
    reason?: string;
  }) => void,
) {
  return on('hearthscale/models/download', ({ download }) => fn(download));
}
