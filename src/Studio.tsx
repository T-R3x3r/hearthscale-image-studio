import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import type { ChatMessage, ModelCard } from '@hearthscale/app';
import {
  Button,
  Chip,
  Icon,
  IconButton,
  Lightbox,
  Meter,
  ShellConfirm,
  Toast,
  useFloatingTips,
  type Swatch,
} from '@hearthscale/app-ui';
import { assetUrl, call, dataPath, download, fileUrl, hostContext, on, reason, tool } from './bridge';
import {
  addRun,
  finishRun,
  forgetPictures,
  getPicture,
  getRun,
  latestCompare,
  listPictures,
  nameOf,
  pictureName,
  openLibrary,
  picturesOfRun,
  runsOfCompare,
  setFavourite,
  type Action,
  type Picture,
  type Run,
} from './records';
import {
  abilitiesOf,
  fitting,
  onDownload,
  readModels,
  withLoras,
  type Abilities,
  type Fitted,
  type Lora,
  type Models,
} from './models';
import {
  blobOf,
  extended,
  fileName,
  marginsOf,
  pixelsOf,
  pngOf,
  prepared,
  sizeOf,
  upload,
  type Margins,
} from './pictures';
import {
  CHANGES,
  QUICK,
  SHAPES,
  SIZES,
  VARY,
  areaPrompt,
  dimensions,
  withStyle,
  type ChangeId,
  type ShapeId,
  type SizeId,
} from './recipes';
import { AREA_REFERENCES, Marks, blendInto, blendOf, markerName, maskOf, maskPng, paintedWith } from './marks';
import { LONGEST, shortName, stamp } from './names';
import { cancelRun, newId, onEnded, recoverRuns, runSteps, startRun, useLive } from './runs';
import { Library, type LibraryActions } from './Library';
import { Stage, StageBar, type Comparing, type PictureActions, type Sides, type StageProps, type Tool } from './Stage';
import { PromptBar, type Advanced, type PromptMode } from './PromptBar';
import { ComparePage, type Column } from './ComparePage';
import { ProblemNotice, type Problem } from './Problem';

type Page = 'studio' | 'compare';

/** Where a step back or forward can land. */
interface Place {
  section: 'all' | 'favourites' | 'compare';
  picture: string | null;
}

const samePlace = (a: Place, b: Place) => a.section === b.section && a.picture === b.picture;

/** The stage's place while a run has no picture to show yet. It is never kept as a step. */
const MAKING = 'making';

/** What a view of the tab shows again after it loads anew. */
interface ViewState {
  page: Page;
  picture: string | null;
}

interface Prefs {
  shape: ShapeId;
  size: SizeId;
  style: string | null;
  count: number;
  compare: string[];
  loras: Lora[];
  change: ChangeId;
}

const PREFS: Prefs = {
  shape: 'square',
  size: 'medium',
  style: null,
  count: 1,
  compare: [],
  loras: [],
  change: 'medium',
};

const LABELS: Record<Action | 'compare', string> = {
  make: 'Make',
  change: 'Change',
  edit: 'Change',
  mark: 'Change',
  extend: 'Extend',
  enlarge: 'Enlarge',
  open: 'Open',
  compare: 'Compare',
};

/** What did not happen when an action failed, in one sentence. */
const UNDONE: Record<Action | 'compare', string> = {
  make: 'The picture was not made.',
  change: 'The picture was not changed.',
  edit: 'The picture was not changed.',
  mark: 'The picture was not changed.',
  extend: 'The picture was not extended.',
  enlarge: 'The picture was not enlarged.',
  open: 'The picture did not open.',
  compare: 'The comparison did not start.',
};

/** What the prompt holds in each mode, as an example of real words. */
const EXAMPLES: Record<Exclude<PromptMode, 'areas'>, string> = {
  make: 'A red fox in a snowy forest at dawn',
  compare: 'A red fox in a snowy forest at dawn',
  change: 'Make it winter, with snow on the roofs',
  extend: 'More of the beach and the sky',
};

const IMPROVE =
  'You turn a short idea for a picture into one prompt for an image model. Name the subject, the setting, the light and the look in plain words. Answer with the prompt alone, in at most 60 words, with no quotes.';
const NAME =
  "You name a picture's file. Answer with a name of two to five words that says what the picture shows, taken from the prompt it was made with. Answer with the name alone, with no quotes and no full stop.";
const DESCRIBE =
  'Describe this picture as one prompt for an image model: the subject, the setting, the light and the look. Answer with the prompt alone, in at most 60 words, with no quotes.';

/** The most pictures the prompt adds to the picture it changes. */
const PROMPT_REFERENCES = 9;

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
    loras: [],
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

/** The LoRAs a run used, as its record keeps them. */
const lorasOf = (used: Fitted[]) =>
  used.map(({ adapter, weight }) => ({ id: adapter.id, label: adapter.label, weight }));

/** Collects a streamed completion of the app's chat model. */
async function complete(content: ChatMessage['content'], system: string | null): Promise<string> {
  const stream = newId();
  let text = '';
  let failure: string | null = null;
  const stop = on('hearthscale/models/delta', ({ stream: id, delta }) => {
    if (id !== stream) return;
    if ('text' in delta) {
      if (!delta.reasoning) text += delta.text;
    } else if (delta.stop === 'error') failure = delta.error ?? 'The chat model stopped.';
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
/** The main area's width, in CSS pixels, under which the tool row puts its
 *  colours, sides and sliders behind presses: the widest row, the brush
 *  with both sliders, then still fits beside the stage's inset. */
const ROOMY = 1040;

/** An element's width in CSS pixels, read again whenever it resizes. */
function useWidth(element: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = element.current!;
    const read = () => setWidth(node.clientWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

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

/** One area of a run of marked areas, as the run took it. */
interface Planned {
  swatch: Swatch;
  words: string;
  references: Picture[];
  mask: Uint8Array;
}

/** What a change of the whole picture asks for. */
interface Change {
  kind: 'edit' | 'change';
  from: Picture;
  prompt: string;
  strength: number;
  style: string | null;
  loras: Lora[];
  extra: Picture[];
  count: number;
}

export function Studio() {
  const [models, setModels] = useState<Models | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(PREFS);
  const [page, setPage] = useState<Page>('studio');
  const cramped = useWidthBelow(CRAMPED);
  const narrow = useWidthBelow(NARROW);
  const main = useRef<HTMLElement>(null);
  const mainWidth = useWidth(main);
  const [folded, setFolded] = useState(cramped);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [search, setSearch] = useState('');
  const [favourites, setFavourites] = useState(false);
  const [shown, setShown] = useState<Picture | null>(null);
  const [shownSize, setShownSize] = useState<{ width: number; height: number } | null>(null);
  const [shownFrom, setShownFrom] = useState<Picture | null>(null);
  const [comparing, setComparing] = useState<Comparing | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pair, setPair] = useState<[Picture, Picture] | null>(null);
  const [stripRun, setStripRun] = useState<Run | null>(null);
  const [strip, setStrip] = useState<Picture[]>([]);
  const [references, setReferences] = useState<Picture[]>([]);
  const [makeWords, setMakeWords] = useState('');
  const [changeWords, setChangeWords] = useState('');
  const [advanced, setAdvanced] = useState<Advanced>({ negative: '', steps: '', guidance: '', seed: '' });
  const [currentTool, setTool] = useState<Tool>('brush');
  const [swatch, setSwatch] = useState<Swatch>('rose');
  const [brushSize, setBrushSize] = useState(48);
  const [softEdge, setSoftEdge] = useState(8);
  const [sides, setSides] = useState<Sides>({ left: false, right: true, top: false, bottom: false, share: 0.25 });
  const [compareSet, setCompareSet] = useState<string | null>(null);
  const [compareRuns, setCompareRuns] = useState<{ run: Run; picture: Picture | null }[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [large, setLarge] = useState<{ items: Picture[]; start: number } | null>(null);
  const [deleting, setDeleting] = useState<Picture[] | null>(null);
  const [helping, setHelping] = useState(false);
  const [starting, setStarting] = useState(false);
  const [opened, setOpened] = useState(false);
  const marks = useMemo(() => new Marks(), []);
  useSyncExternalStore(marks.subscribe, () => marks.version);
  const composer = useRef<HTMLDivElement>(null);
  const shownBlob = useRef<{ path: string; blob: Blob } | null>(null);
  const shownBefore = useRef<Picture | null>(null);
  const stripRunRef = useRef<Run | null>(null);
  /** What starts each run again, by the run's id. */
  const agains = useRef(new Map<string, () => Promise<unknown>>());
  /** The areas of each run of marked areas, by the run's id. */
  const plans = useRef(new Map<string, { swatch: Swatch; removing: boolean }[]>());
  const compareSetRef = useRef<string | null>(null);
  const places = useRef<{ back: Place[]; forward: Place[] }>({ back: [], forward: [] });
  const here = useRef<Place>({ section: 'all', picture: null });
  /** True from a move that adds no step until the place has changed. */
  const quiet = useRef(false);
  const live = useLive();
  const locale = hostContext().locale ?? navigator.language;
  const tips = useFloatingTips('right');
  const barTips = useFloatingTips('bottom');

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
    setProblem(null);
    setShown(picture);
    setComparing(null);
    if (!picture) return;
    if (stripRunRef.current?.id !== picture.run) {
      setStripRun(await getRun(picture.run));
      setStrip(await picturesOfRun(picture.run));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await openLibrary();
      await tool('tidy', {});
      const view = hostContext()['hearthscale/widgetState'] as ViewState | null | undefined;
      if (view) {
        setPage(view.page);
        const picture = view.picture ? await getPicture(view.picture) : null;
        if (picture) await show(picture);
      }
      setOpened(true);
      const kept = (await call('hearthscale/store/get', { key: 'prefs' })).value as Partial<Prefs> | null;
      if (kept) setPrefsState({ ...PREFS, ...kept });
      await refreshModels();
      await recoverRuns();
      const set = await latestCompare();
      setCompareSet(set);
      await loadCompare(set);
    })().catch(failed('The library did not open.', null));
  }, [refreshModels, loadCompare, show]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    if (!opened) return;
    const state: ViewState = { page, picture: shown?.id ?? null };
    void call('hearthscale/ui/set-widget-state', { state });
  }, [opened, page, shown?.id]);

  useEffect(() => setFolded(cramped), [cramped]);

  // A problem belongs to what failed; another page leaves it behind.
  useEffect(() => setProblem(null), [page]);

  useEffect(() => on('hearthscale/models/chosen', () => void refreshModels()), [refreshModels]);

  useEffect(
    () =>
      onEnded(async (id, outcome, error) => {
        await refreshLibrary();
        const run = stripRunRef.current;
        if (id === run?.id) {
          const made = await picturesOfRun(id);
          setStripRun(await getRun(id));
          setStrip(made);
          if (outcome === 'done' && made[0]) await show(made[0]);
          if (outcome !== 'done' && !run.source && shownBefore.current) await show(shownBefore.current);
          if (outcome === 'failed' && error) {
            failed(UNDONE[run.action], agains.current.get(id) ?? null)(error);
          }
        }
        if (compareSetRef.current) await loadCompare(compareSetRef.current);
        if (outcome === 'done') await namedRef.current(id);
      }),
    [refreshLibrary, show, loadCompare],
  );

  useEffect(
    () =>
      onDownload((moved) => {
        if (moved.state !== 'downloading') {
          if (moved.state !== 'ready' && moved.reason) {
            failed('The model did not download.', () => call('hearthscale/models/install', { target: moved.card }))(
              moved.reason,
            );
          }
          void refreshModels();
        } else if (!models?.downloading.some((card) => card.id === moved.card)) {
          void refreshModels();
        }
      }),
    [refreshModels, models],
  );

  // Another picture starts with no marks and no added pictures, at the brush;
  // the same picture under a new path, or made a favourite, keeps them.
  useEffect(() => {
    setShownSize(null);
    setReferences([]);
    setTool('brush');
    setSwatch('rose');
    marks.reset(0, 0);
    if (!shown) return;
    let current = true;
    void sizeOf(shown.path).then((size) => {
      if (!current) return;
      setShownSize(size);
      marks.reset(size.width, size.height);
    });
    return () => {
      current = false;
    };
  }, [shown?.id, marks]);

  useEffect(() => {
    setShownFrom(null);
    shownBlob.current = null;
    if (!shown) return;
    let current = true;
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
  }, [shown?.path, shown?.run]);

  useEffect(() => {
    const id = shown?.id;
    setSelected((before) => (id ? (before.includes(id) ? before : [id]) : []));
  }, [shown?.id]);

  useEffect(() => {
    setSelected((before) => {
      const kept = before.filter((id) => pictures.some((p) => p.id === id));
      return kept.length === before.length ? before : kept;
    });
  }, [pictures]);

  useEffect(() => {
    setPair(null);
    if (selected.length !== 2) return;
    const two = selected.map((id) => pictures.find((p) => p.id === id));
    if (!two[0] || !two[1]) return;
    const [a, b] = (two as Picture[]).sort((x, y) => x.made - y.made);
    let current = true;
    void Promise.all([sizeOf(a.path), sizeOf(b.path)]).then(([x, y]) => {
      if (current && Math.abs(x.width / x.height - y.width / y.height) < 0.01) setPair([a, b]);
    });
    return () => {
      current = false;
    };
  }, [selected, pictures]);

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

  const stripLive = stripRun ? (live.get(stripRun.id) ?? null) : null;
  /** The run the stage shows in place of its picture: a new picture, or a
   *  change of the picture shown. */
  const stageLive =
    stripRun && stripLive && stripRun.action !== 'enlarge' && (stripRun.source ? stripRun.source === shown?.id : !shown)
      ? stripLive
      : null;
  const target = page === 'studio' ? shown : null;
  const changing = !!target && !!stageLive;
  const markable = !!target && abilities.fill && !!shownSize && marks.width === shownSize.width;
  const areas = markable ? marks.areas : [];
  const canChange = abilities.edit || abilities.change;

  let mode: PromptMode;
  if (page === 'compare') mode = 'compare';
  else if (!target || !canChange) mode = 'make';
  else if (markable && currentTool === 'extend') mode = 'extend';
  else if (areas.length > 0) mode = 'areas';
  else mode = 'change';

  const words = mode === 'make' || mode === 'compare' ? makeWords : changeWords;
  const setWords = mode === 'make' || mode === 'compare' ? setMakeWords : setChangeWords;
  const removing = areas.every((area) => !area.words.trim() && area.references.length === 0);
  const anySide = sides.left || sides.right || sides.top || sides.bottom;
  const comparable = prefs.compare.filter((id) => imageCards.some((c) => c.id === id)).length >= 2;

  const actionLabel = {
    make: 'Make',
    compare: 'Compare',
    change: 'Change the picture',
    extend: 'Extend the picture',
    areas: `${removing ? 'Remove' : 'Change'} ${areas.length} ${areas.length === 1 ? 'area' : 'areas'}`,
  }[mode];

  const ready = (() => {
    if (!model) return false;
    switch (mode) {
      case 'compare':
        return !!makeWords.trim() && comparable;
      case 'make':
        return !!makeWords.trim();
      case 'change':
        return !changing && !!changeWords.trim() && !!shownSize;
      case 'areas':
        return !changing;
      case 'extend':
        return !changing && anySide;
    }
  })();

  /** Why the action is off, where the person can change that. */
  const why = (() => {
    if (!model || ready) return null;
    if (changing) return 'Wait until this change is done';
    switch (mode) {
      case 'compare':
        return comparable ? 'Write what you want to see' : 'Choose two or more models';
      case 'make':
        return 'Write what you want to see';
      case 'change':
        return 'Write what to change';
      case 'extend':
        return 'Choose a side to extend';
      default:
        return null;
    }
  })();

  /** Shows what did not happen, with Hearthscale's words for it in a
   *  tooltip and, where `again` is given, a press that does it again. */
  function failed(text: string, again: (() => Promise<unknown>) | null) {
    return (error: unknown) =>
      setProblem({
        text,
        detail: reason(error) || null,
        retry: again && (() => (setProblem(null), void again().catch(failed(text, again)))),
      });
  }

  /** Shows a run as it starts: a change on the picture it changes, a new
   *  picture on an empty stage. */
  function showRun(run: Run, again: () => Promise<unknown>, from: Picture | null) {
    setProblem(null);
    agains.current.set(run.id, again);
    setStripRun(run);
    setStrip([]);
    setComparing(null);
    if (from) {
      if (shown?.id !== from.id) setShown(from);
    } else {
      shownBefore.current = shown;
      setShown(null);
    }
  }

  /** `again` restarts the run if it fails. */
  async function begin(
    run: Run,
    input: Record<string, unknown>,
    again: () => Promise<unknown>,
    loras: Lora[],
    from: Picture | null,
  ) {
    const card = imageCards.find((c) => c.id === run.model);
    const used = card ? fitting(card, loras, models?.adapters ?? []) : [];
    const started: Run = { ...run, loras: lorasOf(used) };
    if (started.action === 'enlarge') {
      setProblem(null);
      agains.current.set(started.id, again);
      setStripRun(started);
      setStrip([]);
    } else showRun(started, again, from);
    await startRun(started, withLoras(input, used), LABELS[started.action]);
  }

  async function hold(paths: string[]): Promise<string[]> {
    return (await tool<{ assets: string[] }>('hold', { paths })).assets;
  }

  async function submit() {
    if (!model || !ready || starting) return;
    setStarting(true);
    const undone = mode === 'make' || mode === 'compare' ? UNDONE[mode] : UNDONE.change;
    try {
      if (mode === 'compare') await compare();
      else if (mode === 'make') await make();
      else if (mode === 'areas') {
        const from = shown!;
        const size = shownSize!;
        const plan: Planned[] = areas.map((area) => ({
          swatch: area.swatch,
          words: area.words.trim(),
          references: area.references,
          mask: maskOf(area),
        }));
        const soft = softEdge;
        const loras = prefs.loras;
        marks.reset(size.width, size.height);
        await changeAreas(from, size, plan, soft, loras);
      } else if (mode === 'extend') {
        const from = shown!;
        const margins = marginsOf(shownSize!, sides, sides.share);
        const prompt = changeWords.trim();
        setChangeWords('');
        setTool('brush');
        await extend(from, margins, prompt, prefs.loras);
      } else {
        const prompt = changeWords.trim();
        setChangeWords('');
        await change({
          kind: abilities.edit ? 'edit' : 'change',
          from: shown!,
          prompt,
          strength: CHANGES.find((c) => c.id === prefs.change)!.strength,
          style: prefs.style,
          loras: prefs.loras,
          extra: abilities.edit ? references : [],
          count: prefs.count,
        });
      }
    } catch (error) {
      failed(undone, submit)(error);
    } finally {
      setStarting(false);
    }
  }

  async function make() {
    const { prompt, avoid } = withStyle(makeWords.trim(), prefs.style);
    const { width, height } = dimensions(prefs.shape, prefs.size, abilities.side);
    const settings = shared(abilities, advanced, avoid, prefs.count);
    const run = newRun({
      kind: 'image',
      action: 'make',
      model: model!.id,
      label: model!.label,
      prompt: makeWords.trim(),
      style: prefs.style,
      width,
      height,
      negative: settings.negative,
      steps: settings.steps,
      guidance: settings.guidance,
      seed: settings.seed,
      count: settings.count,
    });
    await begin(run, { prompt, ...sized(abilities, width, height), ...settings.input }, make, prefs.loras, null);
  }

  /** Changes the whole picture: by the words of an edit model that reads
   *  the picture and the prompt's pictures, or drawn again from it. */
  async function change(asked: Change) {
    const { kind, from } = asked;
    const size = from.id === shown?.id && shownSize ? shownSize : await sizeOf(from.path);
    const styled = withStyle(asked.prompt || from.prompt, asked.style);
    const settings = shared(abilities, advanced, styled.avoid, asked.count);
    const inputs = await hold([from.path, ...(kind === 'edit' ? asked.extra.map((p) => p.path) : [])]);
    const input =
      kind === 'edit'
        ? { prompt: styled.prompt, references: [...inputs] }
        : { prompt: styled.prompt, image: inputs[0], strength: asked.strength };
    const run = newRun({
      kind: 'image',
      action: kind,
      model: model!.id,
      label: model!.label,
      prompt: asked.prompt || from.prompt,
      style: asked.style,
      width: size.width,
      height: size.height,
      negative: settings.negative,
      steps: settings.steps,
      guidance: settings.guidance,
      seed: settings.seed,
      strength: kind === 'change' ? asked.strength : null,
      count: settings.count,
      source: from.id,
      inputs,
    });
    await begin(
      run,
      { ...input, ...sized(abilities, size.width, size.height), ...settings.input },
      () => change(asked),
      asked.loras,
      from,
    );
  }

  /** Grows the picture past its edges: the model draws the new border. */
  async function extend(from: Picture, margins: Margins, prompt: string, loras: Lora[]) {
    const settings = shared(abilities, advanced, '', 1);
    const grown = await extended(from.path, margins);
    const inputs: string[] = [];
    try {
      inputs.push(await upload('extended.png', grown.image));
      inputs.push(await upload('mask.png', grown.mask));
    } catch (error) {
      if (inputs.length) await tool('release', { assets: inputs });
      throw error;
    }
    const run = newRun({
      kind: 'image',
      action: 'extend',
      model: model!.id,
      label: model!.label,
      prompt: from.prompt,
      width: grown.width,
      height: grown.height,
      negative: settings.negative,
      steps: settings.steps,
      guidance: settings.guidance,
      seed: settings.seed,
      strength: 1,
      source: from.id,
      inputs,
    });
    await begin(
      run,
      {
        prompt: prompt || 'the rest of the scene',
        image: inputs[0],
        mask: inputs[1],
        strength: 1,
        ...sized(abilities, grown.width, grown.height),
        ...settings.input,
      },
      () => extend(from, margins, prompt, loras),
      loras,
      from,
    );
  }

  /** Changes each marked area in turn, each on the picture the one before
   *  left: the model draws the area's mask anew from its words, or takes
   *  away what is there where it has none, and only the pixels of the area
   *  take the new picture, blended over `soft` pixels at its edge. */
  async function changeAreas(
    from: Picture,
    size: { width: number; height: number },
    plan: Planned[],
    soft: number,
    loras: Lora[],
  ) {
    const card = model!;
    const able = abilities;
    const { width, height } = size;
    const settings = shared(able, advanced, '', 1);
    const used = fitting(card, loras, models?.adapters ?? []);
    const run = newRun({
      kind: 'image',
      action: 'mark',
      model: card.id,
      label: card.label,
      prompt: from.prompt,
      width,
      height,
      negative: settings.negative,
      steps: settings.steps,
      guidance: settings.guidance,
      seed: settings.seed,
      strength: 1,
      source: from.id,
      loras: lorasOf(used),
    });
    plans.current.set(
      run.id,
      plan.map((area) => ({ swatch: area.swatch, removing: !area.words && area.references.length === 0 })),
    );
    showRun(run, () => changeAreas(from, size, plan, soft, loras), from);
    await runSteps(run, plan.length, async (steps) => {
      const [first] = await hold([from.path]);
      await steps.hold(first);
      let current = first;
      const pixels = await pixelsOf(await blobOf(from.path), width, height);
      for (const [index, area] of plan.entries()) {
        const mask = await upload('mask.png', await maskPng(area.mask, width, height));
        await steps.hold(mask);
        const extra = area.references.length ? await hold(area.references.map((p) => p.path)) : [];
        await steps.hold(...extra);
        const removing = !area.words && area.references.length === 0;
        const prompt = areaPrompt(area.words, area.references.length, able.edit, markerName(area.swatch).toLowerCase());
        let reference = current;
        if (able.edit && !removing) {
          reference = await upload('marked.png', await pngOf(paintedWith(pixels, area.mask, area.swatch)));
          await steps.hold(reference);
        }
        const input = withLoras(
          {
            prompt,
            image: current,
            mask,
            strength: 1,
            ...(able.edit ? { references: [reference, ...extra] } : {}),
            ...sized(able, width, height),
            ...settings.input,
          },
          used,
        );
        const job = await steps.job(index, card.id, input);
        const outputs = (job.outputs ?? []).flatMap((output) => (output.asset ? [output.asset] : []));
        await steps.hold(...outputs);
        if (!outputs[0]) throw new Error('The model gave back no picture.');
        const answer = await fetch(assetUrl(outputs[0]));
        if (!answer.ok) throw new Error(await answer.text());
        const result = await pixelsOf(await answer.blob(), width, height);
        blendInto(pixels, result, blendOf(area.mask, width, height, soft));
        current = await upload('picture.png', await pngOf(pixels));
        await steps.hold(current);
        steps.preview(current);
      }
      await steps.handOver(current);
      return (await tool<{ path: string }>('keep', { asset: current, run: run.id }, 'Change')).path;
    });
  }

  async function compare() {
    const set = newId();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const { prompt, avoid } = withStyle(makeWords.trim(), prefs.style);
    setProblem(null);
    setCompareSet(set);
    for (const card of imageCards.filter((c) => prefs.compare.includes(c.id))) {
      const { width, height } = dimensions(prefs.shape, prefs.size, abilitiesOf(card).side);
      const settings = shared(abilitiesOf(card), { ...advanced, seed: String(seed) }, avoid, 1);
      const run = newRun({
        kind: 'image',
        action: 'make',
        model: card.id,
        label: card.label,
        prompt: makeWords.trim(),
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

  async function more(run: Run) {
    if (!model) return;
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
    await begin(
      next,
      { prompt: styled.prompt, ...sizes, ...settings.input },
      () => more(run),
      run.loras.map(({ id, weight }) => ({ id, weight })),
      null,
    );
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
    await begin(run, { image: inputs[0] }, () => enlarge(picture), [], picture);
  }

  /** Keeps a file the person opened in the library: as the picture to work
   *  on, as a picture of the prompt, or as a picture of one marked area. */
  async function openFile(file: Blob, into: 'stage' | 'prompt' | Swatch = 'stage') {
    setProblem(null);
    try {
      const asset = await upload('picture.png', await prepared(file));
      const run = newRun({ kind: 'opened', action: 'open', model: '', label: '', status: 'done' });
      const { path } = await tool<{ path: string }>('keep', { asset, run: run.id }, 'Open picture');
      await addRun(run);
      await finishRun(run, [{ path, seed: null }], Date.now());
      const title = file instanceof File ? shortName(file.name.replace(/\.[^.]*$/, '')) : '';
      await tool('name', { run: run.id, base: `${stamp(run.made)} ${title || 'Opened picture'}` });
      const picture = (await picturesOfRun(run.id))[0];
      await refreshLibrary();
      if (into === 'prompt') setReferences((before) => [...before, picture].slice(0, PROMPT_REFERENCES));
      else if (into === 'stage') {
        setPage('studio');
        await show(picture);
      } else marks.addReference(into, picture);
    } catch (error) {
      failed(UNDONE.open, () => openFile(file, into))(error);
    }
  }

  async function improve() {
    setHelping(true);
    const before = words;
    const put = setWords;
    try {
      const better = await complete(before.trim(), IMPROVE);
      if (better) {
        put(better);
        setToast({ text: 'Words improved', undo: () => put(before) });
      }
    } catch (error) {
      failed('Your words were not improved.', improve)(error);
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
      if (text) {
        setMakeWords(text);
        newPicture();
      }
    } catch (error) {
      failed('The picture was not described.', () => describe(picture))(error);
    } finally {
      if (assets.length) await tool('release', { assets });
      setHelping(false);
    }
  }

  async function useSettings(picture: Picture) {
    const run = await getRun(picture.run);
    if (!run) return;
    newPicture();
    setMakeWords(run.prompt);
    setAdvanced({
      negative: run.negative,
      steps: run.steps ? String(run.steps) : '',
      guidance: run.guidance !== null ? String(run.guidance) : '',
      seed: picture.seed !== null ? String(picture.seed) : '',
    });
    const fit = SHAPES.flatMap((shape) => SIZES.map((size) => ({ shape: shape.id, size: size.id }))).find(
      ({ shape, size }) => {
        const d = dimensions(shape, size, abilities.side);
        return d.width === run.width && d.height === run.height;
      },
    );
    setPrefs({
      style: run.style,
      loras: run.loras.map(({ id, weight }) => ({ id, weight })),
      ...(fit ?? {}),
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
      failed('The picture was not copied.', () => copy(picture))(error);
    }
  }

  async function copyPrompt(picture: Picture) {
    try {
      await navigator.clipboard.writeText(picture.prompt);
      setToast({ text: 'Prompt copied' });
    } catch (error) {
      failed('The prompt was not copied.', () => copyPrompt(picture))(error);
    }
  }

  async function reveal(picture: Picture) {
    try {
      await call('openai/files/open', { path: dataPath(picture.path.slice(0, picture.path.lastIndexOf('/'))) });
    } catch (error) {
      failed('The folder did not open.', null)(error);
    }
  }

  /** Lets go of pictures that left the library: the picture shown moves to
   *  the next one, and every other place that holds one drops it. */
  async function dropped(ids: Set<string>) {
    const kept = (p: Picture) => !ids.has(p.id);
    setReferences((before) => before.filter(kept));
    marks.forget(ids);
    setStrip((before) => before.filter(kept));
    setSelected((before) => before.filter((id) => !ids.has(id)));
    setLarge((before) => {
      const items = before?.items.filter(kept);
      return items?.length ? { items, start: Math.min(before!.start, items.length - 1) } : null;
    });
    if (shown && ids.has(shown.id)) {
      const at = pictures.findIndex((p) => p.id === shown.id);
      const next =
        at < 0 ? strip.find(kept) : (pictures.slice(at + 1).find(kept) ?? pictures.slice(0, at).reverse().find(kept));
      await show(next ?? null);
    }
    await refreshLibrary();
    if (compareSetRef.current) await loadCompare(compareSetRef.current);
  }
  const droppedRef = useRef(dropped);
  droppedRef.current = dropped;

  /** The words a finished run's files are named by: its prompt, or a short
   *  name the chat model gives a long prompt. */
  async function titleOf(run: Run): Promise<string> {
    const plain = shortName(run.prompt);
    if (!chat || run.prompt.trim().length <= LONGEST) return plain;
    try {
      return shortName(await complete(run.prompt.trim(), NAME)) || plain;
    } catch {
      return plain;
    }
  }

  /** Moves a finished run's pictures to files named by when and what they
   *  are, and shows them at their new paths. */
  async function named(id: string) {
    const run = await getRun(id);
    if (!run) return;
    try {
      const title =
        (await titleOf(run)) ||
        (run.action === 'enlarge' ? 'Enlarged picture' : run.source ? 'Changed picture' : 'Picture');
      await tool('name', { run: id, base: `${stamp(run.made)} ${title}` });
    } catch (error) {
      failed('The picture was not named.', null)(error);
      return;
    }
    const fresh = new Map((await picturesOfRun(id)).map((p) => [p.id, p]));
    const swap = (p: Picture) => fresh.get(p.id) ?? p;
    setShown((before) => before && swap(before));
    setShownFrom((before) => before && swap(before));
    setComparing((before) => before && { ...before, before: swap(before.before) });
    setStrip((before) => before.map(swap));
    setReferences((before) => before.map(swap));
    marks.renew(swap);
    setLarge((before) => before && { ...before, items: before.items.map(swap) });
    await refreshLibrary();
    if (compareSetRef.current) await loadCompare(compareSetRef.current);
  }
  const namedRef = useRef(named);
  namedRef.current = named;

  useEffect(
    () =>
      on('hearthscale/events/event', ({ name, data }) => {
        if (name === 'gone') void droppedRef.current(new Set(data as string[]));
      }),
    [],
  );

  async function remove(gone: Picture[]) {
    setDeleting(null);
    const ids = new Set(gone.map((p) => p.id));
    try {
      await tool('remove', { paths: gone.map((p) => p.path) }, 'Delete');
      await forgetPictures([...ids]);
      await dropped(ids);
    } catch (error) {
      failed(gone.length === 1 ? 'The picture was not deleted.' : 'The pictures were not deleted.', () => remove(gone))(
        error,
      );
    }
  }

  async function markFavourite(marked: Picture[], favourite: boolean) {
    for (const picture of marked) await setFavourite(picture.id, favourite);
    const ids = new Set(marked.map((p) => p.id));
    const flip = (p: Picture) => (ids.has(p.id) ? { ...p, favourite } : p);
    setShown((s) => s && flip(s));
    setStrip((list) => list.map(flip));
    await refreshLibrary();
  }

  /** Adds a picture of the library to the prompt: to the area of the
   *  colour in use while there are marks, else beside the picture shown. */
  function addingOf(picture: Picture): PictureActions['addToPrompt'] {
    if (!target || !abilities.edit || picture.id === target.id || mode === 'extend') return undefined;
    if (mode === 'areas') {
      const area = marks.find(swatch);
      if (!area || area.references.length >= AREA_REFERENCES || area.references.some((r) => r.id === picture.id)) {
        return undefined;
      }
      return {
        label: `Add to the ${markerName(swatch).toLowerCase()} area`,
        add: () => marks.addReference(swatch, picture),
      };
    }
    if (references.length >= PROMPT_REFERENCES || references.some((r) => r.id === picture.id)) return undefined;
    return { label: 'Add to the prompt', add: () => setReferences((before) => [...before, picture]) };
  }

  const actionsFor = (picture: Picture): PictureActions => ({
    addToPrompt: addingOf(picture),
    vary: abilities.change
      ? (how) => {
          const again = async () => {
            const run = await getRun(picture.run);
            if (run)
              await change({
                kind: 'change',
                from: picture,
                prompt: picture.prompt,
                strength: VARY[how],
                style: prefs.style,
                loras: run.loras.map(({ id, weight }) => ({ id, weight })),
                extra: [],
                count: prefs.count,
              });
          };
          void again().catch(failed(UNDONE.change, again));
        }
      : undefined,
    more:
      model && picture.action === 'make'
        ? () => {
            const again = async () => {
              const run = await getRun(picture.run);
              if (run) await more(run);
            };
            void again().catch(failed(UNDONE.make, again));
          }
        : undefined,
    enlarge:
      upscaler || (models?.absentUpscale.length ?? 0) > 0
        ? () => {
            const again = () => enlarge(picture);
            void again().catch(failed(UNDONE.enlarge, again));
          }
        : undefined,
    beforeAfter:
      picture.id === shown?.id && shownFrom
        ? () => setComparing({ before: shownFrom, beforeName: 'Before', afterName: 'After', label: 'Before and after' })
        : undefined,
    favourite: () => void markFavourite([picture], !picture.favourite),
    save: () => void saveAs(picture),
    copy: () => void copy(picture),
    copyPrompt: picture.prompt ? () => void copyPrompt(picture) : undefined,
    reveal: () => void reveal(picture),
    large: () => {
      const items = strip.some((p) => p.id === picture.id) ? strip : [picture];
      setLarge({ items, start: items.findIndex((p) => p.id === picture.id) });
    },
    settings: () => void useSettings(picture),
    remove: () => setDeleting([picture]),
  });

  const libraryActions: LibraryActions = {
    of: actionsFor,
    large: (picture) => setLarge({ items: pictures, start: pictures.findIndex((p) => p.id === picture.id) }),
    compare: pair
      ? () => {
          const [before, after] = pair;
          const named = before.label && after.label && before.label !== after.label;
          void show(after).then(() =>
            setComparing({
              before,
              beforeName: named ? before.label : 'Earlier',
              afterName: named ? after.label : 'Later',
              label: 'Compare',
            }),
          );
        }
      : null,
    favourite: (marked, on) => void markFavourite(marked, on),
    remove: (gone) => {
      if (gone.length > 0) setDeleting(gone);
    },
  };

  /** Runs a change of the whole picture that takes one press. */
  function quick(words: string) {
    if (!shown) return;
    const again = () =>
      change({
        kind: 'edit',
        from: shown,
        prompt: words,
        strength: 1,
        style: null,
        loras: prefs.loras,
        extra: [],
        count: 1,
      });
    void again().catch(failed(UNDONE.change, again));
  }

  const actions: PictureActions | null = shown ? actionsFor(shown) : null;
  const margins = mode === 'extend' && shownSize && anySide ? marginsOf(shownSize, sides, sides.share) : null;
  const columns: Column[] = compareRuns.map(({ run, picture }) => ({ run, picture, live: live.get(run.id) ?? null }));
  const fold = tips('fold', folded ? 'Show the library' : 'Hide the library');
  const fresh = barTips('new', 'New picture');
  const lightbox = large !== null && large.items.length > 0;
  /** A part the view draws over the prompt's footer, under which the model slot lies. */
  const covering = lightbox || !!deleting || (cramped && !folded);
  const suggestedImage = models?.downloading.find((card) => card.kind === 'image') ?? models?.absentImage[0] ?? null;
  const plan = stripRun ? plans.current.get(stripRun.id) : undefined;
  const step = stripLive?.step ?? null;
  const area = plan && step ? plan[step.index] : null;
  const liveLabel = !stripRun
    ? ''
    : area
      ? `${area.removing ? 'Removing' : 'Changing'} the ${markerName(area.swatch).toLowerCase()} area…`
      : stripRun.action === 'make'
        ? 'Making…'
        : stripRun.action === 'enlarge'
          ? 'Enlarging…'
          : stripRun.action === 'extend'
            ? 'Extending…'
            : 'Changing…';
  const stageProps: StageProps = {
    narrow,
    compact: mainWidth < ROOMY,
    picture: page === 'studio' ? shown : null,
    size: shownSize,
    comparing,
    onStopCompare: () => setComparing(null),
    live: stageLive,
    liveLabel,
    liveModel: stripRun?.label ?? '',
    noModel: !!models && imageCards.length === 0,
    unavailable: models?.unavailable ?? null,
    onRetry: () => void refreshModels(),
    suggestion: suggestedImage
      ? {
          label: suggestedImage.label,
          downloading: suggestedImage.state === 'downloading',
          license: suggestedImage.limitingLicense,
        }
      : null,
    onInstall: () => {
      if (!suggestedImage) return;
      const again = () => install(suggestedImage);
      void again().catch(failed('The model did not install.', again));
    },
    onIdea: setMakeWords,
    markable: markable && !changing,
    tool: currentTool,
    onTool: setTool,
    marks,
    swatch,
    onSwatch: (next) => {
      setSwatch(next);
      if (currentTool === 'eraser') setTool('brush');
    },
    brushSize,
    onBrushSize: setBrushSize,
    softEdge,
    onSoftEdge: setSoftEdge,
    sides,
    onSides: setSides,
    margins,
    actions,
  };
  const title =
    page === 'compare'
      ? 'Compare models'
      : shown
        ? pictureName(shown)
        : stripRun && stripLive
          ? nameOf(stripRun.prompt)
          : 'New picture';
  const away = () => {
    if (cramped) setFolded(true);
  };
  function newPicture() {
    setPage('studio');
    void show(null);
    setStripRun(null);
    setStrip([]);
  }

  /** What opens a place, or null where its picture is gone. */
  async function opening(to: Place): Promise<(() => void) | null> {
    if (to.section === 'compare') return () => setPage('compare');
    const picture = to.picture ? await getPicture(to.picture) : null;
    if (to.picture && !picture) return null;
    return () => {
      setFavourites(to.section === 'favourites');
      if (!picture) return newPicture();
      setPage('studio');
      void show(picture);
    };
  }

  async function walk(direction: 'back' | 'forward') {
    if (quiet.current) return;
    quiet.current = true;
    const other = direction === 'back' ? 'forward' : 'back';
    const list = places.current;
    while (list[direction].length) {
      const to = list[direction].pop()!;
      const open = samePlace(to, here.current) ? null : await opening(to);
      if (!open) continue;
      if (here.current.picture !== MAKING) list[other].push(here.current);
      away();
      open();
      return;
    }
    quiet.current = false;
  }

  useEffect(() =>
    on('hearthscale/ui/history', ({ direction }) => {
      void walk(direction).catch((error) => {
        quiet.current = false;
        failed(UNDONE.open, null)(error);
      });
    }),
  );

  const section = page === 'compare' ? 'compare' : favourites ? 'favourites' : 'all';
  const onStage = section === 'compare' ? null : (shown?.id ?? (stripRun?.status === 'making' ? MAKING : null));

  useEffect(() => {
    const left = here.current;
    here.current = { section, picture: onStage };
    if (!opened || samePlace(left, here.current)) return;
    if (quiet.current) quiet.current = false;
    else if (left.picture !== MAKING) {
      places.current.back.push(left);
      places.current.forward = [];
    }
  }, [opened, section, onStage]);

  useEffect(() => {
    void call('hearthscale/ui/cover', { covered: covering });
  }, [covering]);

  const quickShown = mode === 'change' && abilities.edit && !changing;

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
            shown={page === 'studio' ? (shown?.id ?? null) : null}
            selected={page === 'studio' ? selected : []}
            words={search}
            favourites={favourites}
            page={page}
            actions={libraryActions}
            onWords={setSearch}
            onFavourites={setFavourites}
            onSelect={(ids, picture) => {
              setSelected(ids);
              if (!picture) return;
              if (ids.length > 1 && picture.id !== shown?.id) quiet.current = true;
              setPage('studio');
              void show(picture);
            }}
            onOpen={away}
            onNew={() => {
              away();
              newPicture();
            }}
            onPage={(next) => (away(), setPage(next))}
          />
        </aside>
      )}
      <main className="is-main" ref={main}>
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
          {folded && page === 'studio' && shown && (
            <span {...fresh.hover} className="is-tipwrap">
              <IconButton aria-label="New picture" onClick={newPicture}>
                <Icon name="add-line" size={16} />
              </IconButton>
              {fresh.tip}
            </span>
          )}
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
                    <img src={fileUrl(picture.path)} alt={pictureName(picture)} />
                  </button>
                ))}
                {stripLive && plan && step
                  ? plan.map((each, index) => (
                      <div
                        key={each.swatch}
                        className="is-strip-item is-step hs-tinted"
                        data-making
                        data-swatch={each.swatch}
                        data-selected={index === step.index ? 'true' : undefined}
                      >
                        {index < step.index ? (
                          <Icon name="check-line" size={16} />
                        ) : index === step.index ? (
                          <Meter value={stripLive.fraction} label={`${markerName(each.swatch)} area`} variant="ring" />
                        ) : (
                          <span className="hs-swatch-dot" />
                        )}
                      </div>
                    ))
                  : stripLive &&
                    Array.from({ length: Math.max(1, stripRun.count - strip.length) }, (_, i) => (
                      <div key={`making-${i}`} className="is-strip-item" data-making>
                        <Meter value={stripLive.fraction} label="Progress" variant="ring" />
                      </div>
                    ))}
                {stripLive && !stageLive && <span className="is-strip-state">{liveLabel}</span>}
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
                      onClick={() => {
                        const again = () => more(stripRun);
                        void again().catch(failed(UNDONE.make, again));
                      }}
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
          {problem && <ProblemNotice problem={problem} onClose={() => setProblem(null)} />}
          {quickShown && (
            <div className="is-quick">
              {QUICK.map((each) => (
                <Chip key={each.id} icon={<Icon name={each.icon} size={14} />} onClick={() => quick(each.words)}>
                  {each.label}
                </Chip>
              ))}
            </div>
          )}
          <PromptBar
            mode={mode}
            words={words}
            onWords={setWords}
            onSubmit={() => void submit()}
            action={actionLabel}
            example={mode === 'areas' ? '' : EXAMPLES[mode]}
            ready={ready}
            why={why}
            busy={starting}
            target={target}
            references={mode === 'change' && abilities.edit ? references : []}
            onDropReference={(id) => setReferences((before) => before.filter((r) => r.id !== id))}
            onOpenFile={(file) => void openFile(file, mode === 'make' ? 'stage' : 'prompt')}
            canAddReference={abilities.edit && references.length < PROMPT_REFERENCES}
            areas={areas}
            swatch={swatch}
            onSwatch={(next) => {
              setSwatch(next);
              if (currentTool === 'eraser') setTool('brush');
            }}
            onAreaWords={(each, text) => marks.setWords(each, text)}
            onAreaFile={(each, file) => void openFile(file, each)}
            onDropAreaReference={(each, id) => marks.dropReference(each, id)}
            onDropArea={(each) => marks.drop(each)}
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
            change={mode === 'change' && !abilities.edit ? prefs.change : null}
            onChange={(change) => setPrefs({ change })}
            adapters={model ? (models?.adapters ?? []).filter((a) => a.fits?.includes(model.id)) : []}
            loras={prefs.loras}
            onLoras={(loras) => setPrefs({ loras })}
            advanced={advanced}
            onAdvanced={setAdvanced}
            onImprove={chat ? () => void improve() : null}
            onDescribe={chat?.vision && target ? () => void describe(target) : null}
            helping={helping}
          />
        </div>
      </main>
      {lightbox && (
        <Lightbox
          items={large.items.map((p) => ({
            src: fileUrl(p.path),
            name: pictureName(p),
            onSave: () => void saveAs(p),
          }))}
          start={Math.max(0, Math.min(large.start, large.items.length - 1))}
          onClose={() => setLarge(null)}
        />
      )}
      {deleting && (
        <ShellConfirm
          title={deleting.length === 1 ? 'Delete this picture?' : `Delete ${deleting.length} pictures?`}
          body={
            deleting.length === 1
              ? "Its file in the app's folder is deleted too."
              : "Their files in the app's folder are deleted too."
          }
          action={deleting.length === 1 ? 'Delete' : `Delete ${deleting.length} pictures`}
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
