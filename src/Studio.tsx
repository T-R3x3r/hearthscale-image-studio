import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ChatMessage, ModelCard } from '@hearthscale/app';
import {
  Button,
  Icon,
  IconButton,
  Lightbox,
  Meter,
  Notice,
  ShellConfirm,
  Toast,
  useFloatingTips,
} from '@hearthscale/app-ui';
import { call, download, fileUrl, hostContext, on, reason, tool } from './bridge';
import {
  addRun,
  finishRun,
  forgetPictures,
  getPicture,
  getRun,
  latestCompare,
  listPictures,
  nameOf,
  openLibrary,
  picturesOfRun,
  runsOfCompare,
  setFavourite,
  type Action,
  type Picture,
  type Run,
} from './records';
import { abilitiesOf, onDownload, readModels, type Abilities, type Models } from './models';
import { blobOf, extended, fileName, marginsOf, maskOf, prepared, sizeOf, upload, type Stroke } from './pictures';
import {
  dimensions,
  ERASE_WORDS,
  PLAIN_BACKGROUND_WORDS,
  SHAPES,
  SIZES,
  VARY,
  withStyle,
  type ShapeId,
  type SizeId,
} from './recipes';
import { cancelRun, newId, onEnded, recoverRuns, startRun, useLive } from './runs';
import { Library } from './Library';
import { Stage, StageBar, type PictureActions, type Sides, type StageProps, type Tool } from './Stage';
import { PromptBar, type Advanced, type Mode } from './PromptBar';
import { ComparePage, type Column } from './ComparePage';

type Page = 'studio' | 'compare';

interface Prefs {
  shape: ShapeId;
  size: SizeId;
  style: string | null;
  count: number;
  compare: string[];
}

const PREFS: Prefs = { shape: 'square', size: 'medium', style: null, count: 1, compare: [] };

const LABELS: Record<Action | 'compare', string> = {
  make: 'Make',
  change: 'Change',
  edit: 'Change',
  fill: 'Fill',
  erase: 'Erase',
  extend: 'Extend',
  enlarge: 'Enlarge',
  open: 'Open',
  compare: 'Compare',
};

/** What the prompt holds for each action, as an example of real words. */
const EXAMPLES: Record<Exclude<Action, 'enlarge' | 'open'> | 'compare', string> = {
  make: 'A red fox in a snowy forest at dawn',
  compare: 'A red fox in a snowy forest at dawn',
  change: 'Make it winter, with snow on the roofs',
  edit: 'Make it winter, with snow on the roofs',
  fill: 'A wooden bench',
  erase: 'A wooden bench',
  extend: 'More of the beach and the sky',
};

const IMPROVE =
  'You turn a short idea for a picture into one prompt for an image model. Name the subject, the setting, the light and the look in plain words. Answer with the prompt alone, in at most 60 words, with no quotes.';
const DESCRIBE =
  'Describe this picture as one prompt for an image model: the subject, the setting, the light and the look. Answer with the prompt alone, in at most 60 words, with no quotes.';

function newRun(fields: Partial<Run> & Pick<Run, 'kind' | 'action' | 'model' | 'label'>): Run {
  return {
    id: newId(),
    made: Date.now(),
    prompt: '',
    negative: '',
    style: null,
    width: null,
    height: null,
    steps: null,
    guidance: null,
    seed: null,
    strength: null,
    count: 1,
    source: null,
    compare: null,
    job: null,
    inputs: [],
    status: 'making',
    error: null,
    started: null,
    finished: null,
    ...fields,
  };
}

const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
const decimal = (text: string) => (text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : null);

/** The settings of a job that every action shares, as far as the model takes them. */
function shared(abilities: Abilities, advanced: Advanced, avoid: string, count: number) {
  const input: Record<string, unknown> = {};
  const negative = [avoid, advanced.negative.trim()].filter(Boolean).join(', ');
  const steps = whole(advanced.steps);
  const guidance = decimal(advanced.guidance);
  const seed = whole(advanced.seed);
  const pictures = Math.max(1, Math.min(count, abilities.count));
  if (abilities.negative && negative) input.negativePrompt = negative;
  if (abilities.steps && steps) input.steps = Math.min(steps, 1000);
  if (abilities.guidance && guidance !== null) input.guidance = Math.min(Math.max(guidance, 0), 100);
  if (abilities.seed && seed !== null) input.seed = Math.min(seed, 4294967295 - pictures + 1);
  if (pictures > 1) input.count = pictures;
  return {
    input,
    negative,
    steps: abilities.steps ? steps : null,
    guidance: abilities.guidance ? guidance : null,
    seed: abilities.seed ? seed : null,
    count: pictures,
  };
}

/** The size of a job, where the model's schema takes one. */
function sized(abilities: Abilities, width: number, height: number) {
  return abilities.size ? { width, height } : {};
}

/** Collects a streamed completion of the app's chat model. */
async function complete(content: ChatMessage['content'], system: string | null): Promise<string> {
  const stream = newId();
  let text = '';
  let failure: string | null = null;
  const stop = on('hearthscale/models/delta', ({ stream: id, delta }) => {
    if (id !== stream) return;
    if ('text' in delta) {
      if (!delta.reasoning) text += delta.text;
    } else if (delta.stop === 'error') failure = delta.error ?? 'The chat model stopped. Try again.';
  });
  try {
    await call('hearthscale/models/complete', {
      stream,
      request: {
        messages: [
          ...(system ? [{ role: 'system' as const, content: system }] : []),
          { role: 'user' as const, content },
        ],
        reasoning: 'none',
        sampling: { maxTokens: 200 },
      },
    });
  } finally {
    stop();
  }
  if (failure) throw new Error(failure);
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

/** The widths below which the library lies over the stage, and the bars keep only their main actions. */
const CRAMPED = '(width < 900px)';
const NARROW = '(width < 640px)';

/** Whether the view is narrower than a media query's width, read again
 *  whenever the frame resizes, also while the view first renders. */
function useWidthBelow(query: string) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}

export function Studio() {
  const [models, setModels] = useState<Models | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(PREFS);
  const [page, setPage] = useState<Page>('studio');
  const cramped = useWidthBelow(CRAMPED);
  const narrow = useWidthBelow(NARROW);
  const [folded, setFolded] = useState(cramped);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [search, setSearch] = useState('');
  const [favourites, setFavourites] = useState(false);
  const [shown, setShown] = useState<Picture | null>(null);
  const [shownSize, setShownSize] = useState<{ width: number; height: number } | null>(null);
  const [shownFrom, setShownFrom] = useState<Picture | null>(null);
  const [comparing, setComparing] = useState(false);
  const [stripRun, setStripRun] = useState<Run | null>(null);
  const [strip, setStrip] = useState<Picture[]>([]);
  const [source, setSource] = useState<Picture | null>(null);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [references, setReferences] = useState<Picture[]>([]);
  const [words, setWords] = useState('');
  const [advanced, setAdvanced] = useState<Advanced>({ negative: '', steps: '', guidance: '', seed: '' });
  const [mode, setMode] = useState<Mode>('edit');
  const [amount, setAmount] = useState(0.75);
  const [currentTool, setTool] = useState<Tool>('none');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const painted = strokes.some((stroke) => !stroke.erase);
  const [brushSize, setBrushSize] = useState(48);
  const [erasing, setErasing] = useState(false);
  const [sides, setSides] = useState<Sides>({ left: false, right: true, top: false, bottom: false, share: 0.25 });
  const [compareSet, setCompareSet] = useState<string | null>(null);
  const [compareRuns, setCompareRuns] = useState<{ run: Run; picture: Picture | null }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [large, setLarge] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Picture | null>(null);
  const [helping, setHelping] = useState(false);
  const [starting, setStarting] = useState(false);
  const [opened, setOpened] = useState(false);
  const composer = useRef<HTMLDivElement>(null);
  const shownBlob = useRef<{ path: string; blob: Blob } | null>(null);
  const shownBefore = useRef<Picture | null>(null);
  const stripRunRef = useRef<Run | null>(null);
  const compareSetRef = useRef<string | null>(null);
  const live = useLive();
  const locale = hostContext().locale ?? navigator.language;
  const tips = useFloatingTips('right');

  stripRunRef.current = stripRun;
  compareSetRef.current = compareSet;

  const setPrefs = useCallback((change: Partial<Prefs>) => {
    setPrefsState((before) => {
      const next = { ...before, ...change };
      void call('hearthscale/store/set', { key: 'prefs', value: next });
      return next;
    });
  }, []);

  const refreshModels = useCallback(async () => setModels(await readModels()), []);
  const refreshLibrary = useCallback(async () => {
    if (opened) setPictures(await listPictures({ words: search, favourites }));
  }, [opened, search, favourites]);

  const loadCompare = useCallback(async (set: string | null) => {
    if (!set) return setCompareRuns([]);
    const runs = await runsOfCompare(set);
    setCompareRuns(
      await Promise.all(runs.map(async (run) => ({ run, picture: (await picturesOfRun(run.id))[0] ?? null }))),
    );
  }, []);

  const show = useCallback(async (picture: Picture | null) => {
    setShown(picture);
    setComparing(false);
    if (!picture) return;
    if (stripRunRef.current?.id !== picture.run) {
      setStripRun(await getRun(picture.run));
      setStrip(await picturesOfRun(picture.run));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await openLibrary();
      setOpened(true);
      const kept = (await call('hearthscale/store/get', { key: 'prefs' })).value as Partial<Prefs> | null;
      if (kept) setPrefsState({ ...PREFS, ...kept });
      await refreshModels();
      await recoverRuns();
      const set = await latestCompare();
      setCompareSet(set);
      await loadCompare(set);
    })().catch((error) => setProblem(reason(error)));
  }, [refreshModels, loadCompare]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => setFolded(cramped), [cramped]);

  useEffect(() => on('hearthscale/models/chosen', () => void refreshModels()), [refreshModels]);

  useEffect(
    () =>
      onEnded(async (id, outcome, error) => {
        await refreshLibrary();
        if (id === stripRunRef.current?.id) {
          const made = await picturesOfRun(id);
          setStripRun(await getRun(id));
          setStrip(made);
          if (outcome === 'done' && made[0]) await show(made[0]);
          if (outcome !== 'done' && shownBefore.current) await show(shownBefore.current);
          if (outcome === 'failed' && error) setProblem(error);
        }
        if (compareSetRef.current) await loadCompare(compareSetRef.current);
      }),
    [refreshLibrary, show, loadCompare],
  );

  useEffect(
    () =>
      onDownload((moved) => {
        if (moved.state !== 'downloading') {
          if (moved.state !== 'ready' && moved.reason) setProblem(moved.reason);
          void refreshModels();
        } else if (!models?.downloading.some((card) => card.id === moved.card)) {
          void refreshModels();
        }
      }),
    [refreshModels, models],
  );

  useEffect(() => {
    setShownSize(null);
    setShownFrom(null);
    shownBlob.current = null;
    if (!shown) return;
    let current = true;
    void sizeOf(shown.path).then((size) => current && setShownSize(size));
    void blobOf(shown.path).then((blob) => {
      if (current) shownBlob.current = { path: shown.path, blob };
    });
    void getRun(shown.run).then(async (run) => {
      const from = run?.source ? await getPicture(run.source) : null;
      if (!current || !from) return;
      const [before, after] = await Promise.all([sizeOf(from.path), sizeOf(shown.path)]);
      const sameShape = Math.abs(before.width / before.height - after.width / after.height) < 0.01;
      if (current && sameShape) setShownFrom(from);
    });
    return () => {
      current = false;
    };
  }, [shown]);

  useEffect(() => {
    setSourceSize(null);
    setTool('none');
    setStrokes([]);
    if (!source) return;
    void sizeOf(source.path).then(setSourceSize);
  }, [source]);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        event.preventDefault();
        void openFile(file);
      }
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  });

  const imageCards = models?.image ?? [];
  const model: ModelCard | null = imageCards.find((card) => card.id === models?.chosen) ?? null;
  const abilities = abilitiesOf(model ?? undefined);
  const upscaler = models?.upscale.find((card) => card.id === models.upscaleChosen) ?? models?.upscale[0] ?? null;
  const chat = models?.chat ?? null;
  const editing = !!source && page === 'studio';
  const extending = editing && currentTool === 'extend' && (sides.left || sides.right || sides.top || sides.bottom);

  let action: keyof typeof EXAMPLES;
  if (page === 'compare') action = 'compare';
  else if (!editing) action = 'make';
  else if (extending) action = 'extend';
  else if (painted) action = words.trim() ? 'fill' : 'erase';
  else action = abilities.edit && (mode === 'edit' || !abilities.change) ? 'edit' : 'change';

  const ready = (() => {
    if (!model) return false;
    const hasWords = !!words.trim();
    switch (action) {
      case 'compare':
        return hasWords && prefs.compare.filter((id) => imageCards.some((c) => c.id === id)).length >= 2;
      case 'make':
        return hasWords;
      case 'change':
        return hasWords && abilities.change && !!sourceSize;
      case 'edit':
        return hasWords && abilities.edit && !!sourceSize;
      case 'fill':
        return hasWords && abilities.fill && !!sourceSize;
      case 'erase':
      case 'extend':
        return abilities.fill && !!sourceSize;
      default:
        return false;
    }
  })();

  /** Starts a run and puts it on the stage while it makes. */
  async function begin(run: Run, input: Record<string, unknown>) {
    setProblem(null);
    setStripRun(run);
    setStrip([]);
    shownBefore.current = shown;
    setShown(null);
    setComparing(false);
    await startRun(run, input, LABELS[run.action]);
  }

  async function hold(paths: string[]): Promise<string[]> {
    return (await tool<{ assets: string[] }>('hold', { paths })).assets;
  }

  async function submit() {
    if (!model || !ready || starting) return;
    setStarting(true);
    try {
      if (action === 'compare') return await compare();
      if (action === 'make') return await make();
      await change(action);
    } catch (error) {
      setProblem(reason(error));
    } finally {
      setStarting(false);
    }
  }

  async function make() {
    const { prompt, avoid } = withStyle(words.trim(), prefs.style);
    const { width, height } = dimensions(prefs.shape, prefs.size);
    const settings = shared(abilities, advanced, avoid, prefs.count);
    const run = newRun({
      kind: 'image',
      action: 'make',
      model: model!.id,
      label: model!.label,
      prompt: words.trim(),
      style: prefs.style,
      width,
      height,
      negative: settings.negative,
      steps: settings.steps,
      guidance: settings.guidance,
      seed: settings.seed,
      count: settings.count,
    });
    await begin(run, { prompt, ...sized(abilities, width, height), ...settings.input });
  }

  async function change(kind: Action, from: Picture = source!, strength = amount, prompt = words.trim()) {
    const size = from.id === source?.id && sourceSize ? sourceSize : await sizeOf(from.path);
    const styled = withStyle(prompt || from.prompt, kind === 'erase' || kind === 'extend' ? null : prefs.style);
    const settings = shared(abilities, advanced, styled.avoid, kind === 'extend' || kind === 'erase' ? 1 : prefs.count);
    let input: Record<string, unknown>;
    const inputs: string[] = [];
    let width = size.width;
    let height = size.height;
    try {
      if (kind === 'edit') {
        const extra = from.id === source?.id ? references : [];
        inputs.push(...(await hold([from.path, ...extra.map((r) => r.path)])));
        input = { prompt: styled.prompt, references: [...inputs] };
      } else if (kind === 'change') {
        inputs.push(...(await hold([from.path])));
        input = { prompt: styled.prompt, image: inputs[0], strength };
      } else if (kind === 'fill' || kind === 'erase') {
        inputs.push(...(await hold([from.path])));
        inputs.push(await upload('mask.png', await maskOf(strokes, sourceSize!.width, sourceSize!.height)));
        input = {
          prompt: kind === 'erase' ? ERASE_WORDS : styled.prompt,
          image: inputs[0],
          mask: inputs[1],
          strength: kind === 'erase' ? 1 : strength,
        };
      } else {
        const grown = await extended(from.path, marginsOf(size, sides, sides.share));
        inputs.push(await upload('extended.png', grown.image));
        inputs.push(await upload('mask.png', grown.mask));
        width = grown.width;
        height = grown.height;
        input = {
          prompt: styled.prompt || 'the rest of the scene',
          image: inputs[0],
          mask: inputs[1],
          strength: 1,
        };
      }
    } catch (error) {
      if (inputs.length) await tool('release', { assets: inputs });
      throw error;
    }
    const run = newRun({
      kind: 'image',
      action: kind,
      model: model!.id,
      label: model!.label,
      prompt: kind === 'fill' || kind === 'erase' || kind === 'extend' ? from.prompt : prompt || from.prompt,
      style: kind === 'erase' || kind === 'extend' ? null : prefs.style,
      width,
      height,
      negative: settings.negative,
      steps: settings.steps,
      guidance: settings.guidance,
      seed: settings.seed,
      strength: 'strength' in input ? (input.strength as number) : null,
      count: settings.count,
      source: from.id,
      inputs,
    });
    await begin(run, { ...input, ...sized(abilities, width, height), ...settings.input });
    if (kind === 'fill' || kind === 'erase' || kind === 'extend') {
      setTool('none');
      setStrokes([]);
    }
  }

  async function compare() {
    const set = newId();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const { prompt, avoid } = withStyle(words.trim(), prefs.style);
    const { width, height } = dimensions(prefs.shape, prefs.size);
    setProblem(null);
    setCompareSet(set);
    for (const card of imageCards.filter((c) => prefs.compare.includes(c.id))) {
      const settings = shared(abilitiesOf(card), { ...advanced, seed: String(seed) }, avoid, 1);
      const run = newRun({
        kind: 'image',
        action: 'make',
        model: card.id,
        label: card.label,
        prompt: words.trim(),
        style: prefs.style,
        width,
        height,
        negative: settings.negative,
        steps: settings.steps,
        guidance: settings.guidance,
        seed: settings.seed,
        compare: set,
      });
      await startRun(run, { prompt, ...sized(abilitiesOf(card), width, height), ...settings.input }, LABELS.compare);
      await loadCompare(set);
    }
  }

  async function more() {
    const run = stripRun;
    if (!run || !model) return;
    const card = imageCards.find((c) => c.id === run.model) ?? model;
    const styled = withStyle(run.prompt, run.style);
    const settings = shared(
      abilitiesOf(card),
      {
        negative: '',
        steps: run.steps ? String(run.steps) : '',
        guidance: run.guidance !== null ? String(run.guidance) : '',
        seed: '',
      },
      run.negative,
      run.count,
    );
    const next = newRun({
      ...run,
      id: newId(),
      made: Date.now(),
      model: card.id,
      label: card.label,
      seed: null,
      job: null,
      inputs: [],
      status: 'making',
      error: null,
      started: null,
      finished: null,
      compare: null,
    });
    const sizes = run.width && run.height ? sized(abilitiesOf(card), run.width, run.height) : {};
    await begin(next, { prompt: styled.prompt, ...sizes, ...settings.input });
  }

  /** Starts the Server's download of a model the app needs, with Hearthscale's install card. */
  async function install(card: ModelCard) {
    await call('hearthscale/models/install', { target: card.id });
    await refreshModels();
  }

  async function enlarge(picture: Picture) {
    if (!upscaler) return install(models!.absentUpscale[0]);
    const inputs = await hold([picture.path]);
    const run = newRun({
      kind: 'upscale',
      action: 'enlarge',
      model: upscaler.id,
      label: upscaler.label,
      prompt: picture.prompt,
      source: picture.id,
      inputs,
    });
    await begin(run, { image: inputs[0] });
  }

  async function openFile(file: Blob) {
    setProblem(null);
    try {
      const asset = await upload('picture.png', await prepared(file));
      const run = newRun({ kind: 'opened', action: 'open', model: '', label: '', status: 'done' });
      const { path } = await tool<{ path: string }>('keep', { asset, run: run.id }, 'Open picture');
      await addRun(run);
      await finishRun(run, [{ path, seed: null }], Date.now());
      const picture = (await picturesOfRun(run.id))[0];
      await refreshLibrary();
      if (source && abilities.edit) setReferences((before) => [...before, picture].slice(0, 9));
      else {
        setSource(picture);
        setReferences([]);
      }
      await show(picture);
    } catch (error) {
      setProblem(reason(error));
    }
  }

  async function improve() {
    setHelping(true);
    const before = words;
    try {
      const better = await complete(words.trim(), IMPROVE);
      if (better) {
        setWords(better);
        setToast({ text: 'Words improved', undo: () => setWords(before) });
      }
    } catch (error) {
      setProblem(reason(error));
    } finally {
      setHelping(false);
    }
  }

  async function describe(picture: Picture) {
    setHelping(true);
    let assets: string[] = [];
    try {
      assets = await hold([picture.path]);
      const text = await complete(
        [
          { type: 'image', asset: assets[0], mediaType: 'image/png' },
          { type: 'text', text: DESCRIBE },
        ],
        null,
      );
      if (text) setWords(text);
    } catch (error) {
      setProblem(reason(error));
    } finally {
      if (assets.length) await tool('release', { assets });
      setHelping(false);
    }
  }

  async function useSettings(picture: Picture) {
    const run = await getRun(picture.run);
    if (!run) return;
    setSource(null);
    setReferences([]);
    setPage('studio');
    setWords(run.prompt);
    setAdvanced({
      negative: run.negative,
      steps: run.steps ? String(run.steps) : '',
      guidance: run.guidance !== null ? String(run.guidance) : '',
      seed: picture.seed !== null ? String(picture.seed) : '',
    });
    const fit = SHAPES.flatMap((shape) => SIZES.map((size) => ({ shape: shape.id, size: size.id }))).find(
      ({ shape, size }) => {
        const d = dimensions(shape, size);
        return d.width === run.width && d.height === run.height;
      },
    );
    setPrefs({
      style: run.style,
      ...(fit ?? {}),
      ...(imageCards.some((c) => c.id === run.model) ? { model: run.model } : {}),
    });
  }

  async function saveAs(picture: Picture) {
    const kept = shownBlob.current?.path === picture.path ? shownBlob.current.blob : await blobOf(picture.path);
    const { isError } = await download(fileName(picture.prompt, picture.seed), kept);
    if (!isError) setToast({ text: 'Saved' });
  }

  async function copy(picture: Picture) {
    try {
      const kept = shownBlob.current?.path === picture.path ? shownBlob.current.blob : await blobOf(picture.path);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': kept })]);
      setToast({ text: 'Copied' });
    } catch (error) {
      setProblem(reason(error));
    }
  }

  async function remove(picture: Picture) {
    setDeleting(null);
    try {
      await tool('remove', { paths: [picture.path] }, 'Delete');
      await forgetPictures([picture.id]);
      if (source?.id === picture.id) setSource(null);
      setReferences((before) => before.filter((r) => r.id !== picture.id));
      const left = strip.filter((p) => p.id !== picture.id);
      setStrip(left);
      await show(left[0] ?? null);
      await refreshLibrary();
    } catch (error) {
      setProblem(reason(error));
    }
  }

  async function toggleFavourite(picture: Picture) {
    await setFavourite(picture.id, !picture.favourite);
    const flipped = { ...picture, favourite: !picture.favourite };
    setShown((s) => (s?.id === picture.id ? flipped : s));
    setStrip((list) => list.map((p) => (p.id === picture.id ? flipped : p)));
    await refreshLibrary();
  }

  const actions: PictureActions | null = shown
    ? {
        edit:
          abilities.change || abilities.edit ? () => (setSource(shown), setReferences([]), setWords('')) : undefined,
        addToPrompt:
          source &&
          abilities.edit &&
          source.id !== shown.id &&
          !references.some((r) => r.id === shown.id) &&
          references.length < 9
            ? () => setReferences((before) => [...before, shown])
            : undefined,
        vary: abilities.change
          ? (how) => void change('change', shown, VARY[how], shown.prompt).catch((e) => setProblem(reason(e)))
          : undefined,
        enlarge:
          upscaler || (models?.absentUpscale.length ?? 0) > 0
            ? () => void enlarge(shown).catch((e) => setProblem(reason(e)))
            : undefined,
        plainBackground: abilities.edit
          ? () => void change('edit', shown, 1, PLAIN_BACKGROUND_WORDS).catch((e) => setProblem(reason(e)))
          : undefined,
        compareSource: shownFrom ? () => setComparing(true) : undefined,
        favourite: () => void toggleFavourite(shown),
        save: () => void saveAs(shown),
        copy: () => void copy(shown),
        large: () =>
          setLarge(
            Math.max(
              0,
              strip.findIndex((p) => p.id === shown.id),
            ),
          ),
        settings: () => void useSettings(shown),
        remove: () => setDeleting(shown),
      }
    : null;

  const stripLive = stripRun ? (live.get(stripRun.id) ?? null) : null;
  const margins =
    editing && currentTool === 'extend' && sourceSize && extending ? marginsOf(sourceSize, sides, sides.share) : null;
  const stagePicture = editing && (currentTool !== 'none' || painted) ? source : shown;
  const stageSize = stagePicture && stagePicture.id === source?.id && sourceSize ? sourceSize : shownSize;
  const columns: Column[] = compareRuns.map(({ run, picture }) => ({ run, picture, live: live.get(run.id) ?? null }));
  const fold = tips('fold', folded ? 'Show the library' : 'Hide the library');
  const lightboxItems = strip.length ? strip : shown ? [shown] : [];
  const lightbox = large !== null && lightboxItems.length > 0;
  /** A part the view draws over the prompt's footer, under which the model slot lies. */
  const covering = lightbox || !!deleting || (cramped && !folded);
  const suggestedImage = models?.downloading.find((card) => card.kind === 'image') ?? models?.absentImage[0] ?? null;
  const stageProps: StageProps = {
    narrow,
    picture: stagePicture,
    size: stageSize,
    source,
    sourceOf: shownFrom,
    comparing,
    onStopCompare: () => setComparing(false),
    live: stripLive,
    liveLabel: stripRun
      ? `${stripRun.action === 'make' ? 'Making' : stripRun.action === 'enlarge' ? 'Enlarging' : 'Changing'} with ${stripRun.label}…`
      : '',
    noModel: !!models && imageCards.length === 0,
    unavailable: models?.unavailable ?? null,
    onRetry: () => void refreshModels(),
    suggestion: suggestedImage
      ? { label: suggestedImage.label, downloading: suggestedImage.state === 'downloading' }
      : null,
    onInstall: () => void (suggestedImage && install(suggestedImage).catch((e) => setProblem(reason(e)))),
    onIdea: setWords,
    tool: currentTool,
    onTool: (next) => {
      setTool(next);
      if (next !== 'none') setShown(source);
    },
    strokes,
    brushSize,
    onBrushSize: setBrushSize,
    erasing,
    onErasing: setErasing,
    painted,
    onStroke: (stroke) => setStrokes((before) => [...before, stroke]),
    onClearStrokes: () => setStrokes([]),
    sides,
    onSides: setSides,
    margins,
    actions,
    onStopEditing: () => {
      setSource(null);
      setReferences([]);
    },
  };
  const title =
    page === 'compare'
      ? 'Compare models'
      : stagePicture
        ? stagePicture.prompt
          ? nameOf(stagePicture.prompt)
          : 'Opened picture'
        : stripRun && stripLive
          ? nameOf(stripRun.prompt)
          : 'New picture';
  const away = () => {
    if (cramped) setFolded(true);
  };

  useEffect(() => {
    void call('hearthscale/ui/cover', { covered: covering });
  }, [covering]);

  return (
    <div
      className="is-studio"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
        if (file) void openFile(file);
      }}
    >
      {!folded && (
        <aside className="is-side">
          <Library
            pictures={pictures}
            locale={locale}
            shown={shown?.id ?? null}
            words={search}
            favourites={favourites}
            page={page}
            onWords={setSearch}
            onFavourites={setFavourites}
            onShow={(picture) => (away(), setPage('studio'), void show(picture))}
            onNew={() => {
              away();
              setPage('studio');
              setSource(null);
              setReferences([]);
              setWords('');
              void show(null);
              setStripRun(null);
              setStrip([]);
            }}
            onPage={(next) => (away(), setPage(next))}
          />
        </aside>
      )}
      <main className="is-main">
        <div className="is-toolbar">
          <span {...fold.hover} className="is-tipwrap">
            <IconButton
              aria-label={folded ? 'Show the library' : 'Hide the library'}
              onClick={() => setFolded(!folded)}
            >
              <Icon name={folded ? 'side-wide' : 'side-narrow'} size={16} />
            </IconButton>
            {fold.tip}
          </span>
          <span className="is-bar-title">{title}</span>
          {page === 'studio' && <StageBar {...stageProps} />}
        </div>
        {page === 'studio' && (
          <>
            <Stage {...stageProps} />
            {stripRun && (stripLive || strip.length > 1 || (stripRun.action === 'make' && strip.length > 0)) && (
              <div className="is-strip">
                {strip.map((picture) => (
                  <button
                    key={picture.id}
                    className="is-strip-item"
                    data-on={picture.id === shown?.id}
                    onClick={() => void show(picture)}
                  >
                    <img src={fileUrl(picture.path)} alt={picture.prompt} />
                  </button>
                ))}
                {stripLive &&
                  Array.from({ length: Math.max(1, stripRun.count - strip.length) }, (_, i) => (
                    <div key={`making-${i}`} className="is-strip-item" data-making>
                      <Meter value={stripLive.fraction} label="Progress" variant="ring" />
                    </div>
                  ))}
                {stripLive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon name="stop-line" size={14} />}
                    onClick={() => void cancelRun(stripRun.id)}
                  >
                    Cancel
                  </Button>
                ) : (
                  stripRun.action === 'make' &&
                  imageCards.some((c) => c.id === stripRun.model) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Icon name="add-line" size={14} />}
                      onClick={() => void more().catch((e) => setProblem(reason(e)))}
                    >
                      Make more
                    </Button>
                  )
                )}
              </div>
            )}
          </>
        )}
        {page === 'compare' && (
          <ComparePage
            models={imageCards}
            picked={prefs.compare}
            onPick={(compare) => setPrefs({ compare })}
            current={model?.id ?? null}
            columns={columns}
            onShow={(picture) => (setPage('studio'), void show(picture))}
            onCancel={(run) => void cancelRun(run)}
            unavailable={models?.unavailable ?? null}
            onRetry={() => void refreshModels()}
          />
        )}
        <div className="is-dock">
          {problem && (
            <Notice>
              {problem}
              <button className="hs-link" onClick={() => setProblem(null)}>
                Close
              </button>
            </Notice>
          )}
          <PromptBar
            words={words}
            onWords={setWords}
            onSubmit={() => void submit()}
            action={LABELS[action]}
            example={EXAMPLES[action]}
            ready={ready}
            busy={starting}
            source={editing ? source : null}
            references={editing && abilities.edit ? references : []}
            onDropSource={() => {
              setSource(null);
              setReferences([]);
            }}
            onDropReference={(id) => setReferences((before) => before.filter((r) => r.id !== id))}
            onOpenFile={(file) => void openFile(file)}
            canAddReference={editing && abilities.edit && references.length < 9}
            abilities={abilities}
            composer={composer}
            shape={prefs.shape}
            onShape={(shape) => setPrefs({ shape })}
            size={prefs.size}
            onSize={(size) => setPrefs({ size })}
            style={prefs.style}
            onStyle={(style) => setPrefs({ style })}
            count={Math.min(prefs.count, abilities.count)}
            onCount={(count) => setPrefs({ count })}
            showCount={action !== 'erase' && action !== 'extend' && action !== 'compare'}
            comparing={action === 'compare'}
            advanced={advanced}
            onAdvanced={setAdvanced}
            mode={mode}
            onMode={setMode}
            showMode={
              editing &&
              abilities.edit &&
              abilities.change &&
              action !== 'fill' &&
              action !== 'erase' &&
              action !== 'extend'
            }
            amount={action === 'change' || action === 'fill' ? amount : null}
            onAmount={setAmount}
            onImprove={chat ? () => void improve() : null}
            onDescribe={
              chat?.vision && (editing ? source : shown) ? () => void describe((editing ? source : shown)!) : null
            }
            helping={helping}
          />
        </div>
      </main>
      {lightbox && (
        <Lightbox
          items={lightboxItems.map((p) => ({
            src: fileUrl(p.path),
            name: p.prompt ? nameOf(p.prompt) : 'Picture',
            onSave: () => void saveAs(p),
          }))}
          start={Math.min(large, lightboxItems.length - 1)}
          onClose={() => setLarge(null)}
        />
      )}
      {deleting && (
        <ShellConfirm
          title="Delete this picture?"
          body="Its file in the app's folder is deleted too."
          action="Delete"
          tone="danger"
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
      {toast && (
        <Toast
          action={toast.undo ? { label: 'Undo', onPress: toast.undo } : undefined}
          above={composer}
          onClose={() => setToast(null)}
        >
          {toast.text}
        </Toast>
      )}
    </div>
  );
}
