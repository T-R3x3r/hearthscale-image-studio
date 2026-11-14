import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  MDivider,
  MItem,
  MenuSurface,
  PictureCompare,
  Popover,
  Slider,
  StatusWord,
  anchorFrom,
  useFloatingTips,
  type IconName,
  type MenuAnchor,
  type Swatch,
} from '@hearthscale/app-ui';
import { app, assetUrl, fileUrl } from './bridge';
import { pictureName, type Picture } from './records';
import type { Live } from './runs';
import { IDEAS } from './recipes';
import type { Margins } from './pictures';
import { MARKERS, markerName, type Marks, type Point } from './marks';
import { ProblemNotice } from './Problem';
import { Details } from './Details';
import { explained } from './explained';

/** What a press on the picture does: paint a colour, draw a box of it,
 *  erase marks, or grow the picture past its edges. */
export type Tool = 'brush' | 'rectangle' | 'eraser' | 'extend';

export interface Sides {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
  share: number;
}

/** Two pictures side by side: the picture shown and the one it came from,
 *  or two pictures the person picked. */
export interface Comparing {
  before: Picture;
  beforeName: string;
  afterName: string;
  /** The words of the bar's press that ends it. */
  label: string;
}

/** What the person can do with the picture on the stage. */
export interface PictureActions {
  addToPrompt?: { label: string; add: () => void };
  vary?: (how: 'little' | 'lot') => void;
  more?: () => void;
  enlarge?: () => void;
  beforeAfter?: () => void;
  favourite: () => void;
  save: () => void;
  copy: () => void;
  copyPrompt?: () => void;
  reveal: () => void;
  large: () => void;
  settings: () => void;
  remove: () => void;
}

/** The largest box of a width-to-height ratio that fits the stage. */
function useFit(area: RefObject<HTMLElement | null>, width: number, height: number) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = area.current;
    if (!element || !width || !height) return;
    const fit = () => {
      const scale = Math.min(element.clientWidth / width, element.clientHeight / height);
      setBox({ width: Math.floor(width * scale), height: Math.floor(height * scale) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [area, width, height]);
  return box;
}

/** The marks over the picture, one canvas per colour at the picture's own
 *  size, and the press that paints, erases or draws a box. */
function MarkLayer(props: { marks: Marks; tool: Tool; swatch: Swatch; brushSize: number }) {
  const { marks } = props;
  const root = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const press = useRef<{ start: Point; last: Point; size: number } | null>(null);
  const version = useSyncExternalStore(marks.subscribe, () => marks.version);

  useLayoutEffect(() => {
    layer.current!.replaceChildren(...marks.areas.map((area) => area.canvas));
  }, [marks, version]);

  useLayoutEffect(() => {
    const element = root.current!;
    const read = () => {
      if (element.clientWidth > 0) marks.scale = marks.width / element.clientWidth;
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [marks]);

  useEffect(() => {
    const later = () => requestAnimationFrame(() => marks.recolor());
    app.addEventListener('hostcontextchanged', later);
    return () => app.removeEventListener('hostcontextchanged', later);
  }, [marks]);

  const at = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      point: {
        x: ((event.clientX - rect.left) / rect.width) * marks.width,
        y: ((event.clientY - rect.top) / rect.height) * marks.height,
      },
      local: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      scale: marks.width / rect.width,
    };
  };
  const painting = props.tool === 'brush' || props.tool === 'eraser';
  const paint = (from: Point, to: Point, size: number) =>
    marks.stroke(props.tool === 'eraser' ? null : props.swatch, from, to, size);

  const placeRing = (local: Point) => {
    const element = ring.current;
    if (!element) return;
    element.style.transform = `translate(${local.x - props.brushSize / 2}px, ${local.y - props.brushSize / 2}px)`;
    element.dataset.shown = 'true';
  };
  const placeBox = (from: Point, to: Point, scale: number) => {
    const element = box.current!;
    element.style.left = `${Math.min(from.x, to.x) / scale}px`;
    element.style.top = `${Math.min(from.y, to.y) / scale}px`;
    element.style.width = `${Math.abs(to.x - from.x) / scale}px`;
    element.style.height = `${Math.abs(to.y - from.y) / scale}px`;
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const pressed = press.current;
    press.current = null;
    if (!pressed) return;
    if (props.tool === 'rectangle') {
      const { point } = at(event);
      box.current!.dataset.shown = 'false';
      const x = Math.max(0, Math.min(pressed.start.x, point.x));
      const y = Math.max(0, Math.min(pressed.start.y, point.y));
      const width = Math.min(marks.width, Math.max(pressed.start.x, point.x)) - x;
      const height = Math.min(marks.height, Math.max(pressed.start.y, point.y)) - y;
      if (width >= 1 && height >= 1) marks.rectangle(props.swatch, x, y, width, height);
    }
    marks.settle();
  };

  return (
    <div
      ref={root}
      className="is-marks"
      data-tool={props.tool}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const { point, scale } = at(event);
        const size = props.brushSize * scale;
        press.current = { start: point, last: point, size };
        if (painting) paint(point, point, size);
        else {
          box.current!.dataset.shown = 'true';
          placeBox(point, point, scale);
        }
      }}
      onPointerMove={(event) => {
        const { point, local, scale } = at(event);
        if (painting) placeRing(local);
        const pressed = press.current;
        if (!pressed || event.buttons !== 1) return;
        if (painting) paint(pressed.last, point, pressed.size);
        else placeBox(pressed.start, point, scale);
        pressed.last = point;
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={() => {
        if (ring.current) ring.current.dataset.shown = 'false';
      }}
    >
      <div ref={layer} className="is-marks-layers" />
      {painting && (
        <div
          ref={ring}
          className="is-mark-ring"
          data-shown="false"
          style={{ width: props.brushSize, height: props.brushSize }}
        />
      )}
      <div ref={box} className="is-mark-box" data-swatch={props.swatch} data-shown="false" />
    </div>
  );
}

/** A press of the bar that stays on: as high as the bar's buttons, on the
 *  selected plate while it is on. */
function BarToggle(props: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`is-bar-toggle hs-hovbox-ink ${props.on ? 'hs-boxsel' : 'hs-inkmut'}`}
      aria-pressed={props.on}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** One slider of the bar. */
interface BarSliderSpec {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  shown: string;
}

/** Sliders of the bar: each beside its label, or in a compact bar behind
 *  one press that opens them all, each under its label. The press shows
 *  the one slider's label, or, for several, `icon`, and its name and
 *  tooltip name them all. */
function BarSlider(props: { compact: boolean; sliders: BarSliderSpec[]; icon?: IconName }) {
  const [at, setAt] = useState<HTMLElement | null>(null);
  const tips = useFloatingTips('bottom');
  const slider = (spec: BarSliderSpec) => (
    <Slider
      label={spec.label}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      value={spec.value}
      onChange={spec.onChange}
      shown={spec.shown}
    />
  );
  if (!props.compact) {
    return (
      <>
        {props.sliders.map((spec) => (
          <span key={spec.label} className="is-bar-field">
            <span className="is-bar-label">{spec.label}</span>
            <div className="is-bar-slider">{slider(spec)}</div>
          </span>
        ))}
      </>
    );
  }
  const title = props.sliders.map((spec, i) => (i === 0 ? spec.label : spec.label.toLowerCase())).join(' and ');
  return (
    <>
      {props.icon && props.sliders.length > 1 ? (
        explained(
          tips,
          'sliders',
          title,
          <IconButton aria-label={title} onClick={(e) => setAt(e.currentTarget)}>
            <Icon name={props.icon} size={16} />
          </IconButton>,
        )
      ) : (
        <Button
          variant="ghost"
          size="sm"
          trailingIcon={<Icon name="arrow-down-s-line" size={14} />}
          onClick={(e) => setAt(e.currentTarget)}
        >
          {title}
        </Button>
      )}
      {at && (
        <Popover anchor={at} placement="bottom" label={title} onDismiss={() => setAt(null)}>
          <div className="is-bar-popover">
            {props.sliders.map((spec) => (
              <div key={spec.label} className="hs-text-field">
                <span className="hs-field-label">{spec.label}</span>
                {slider(spec)}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

/** What the stage, its tool row and its bar show, and what they report. */
export interface StageProps {
  /** Whether the bar keeps only its main actions and puts the rest in the More menu. */
  narrow: boolean;
  picture: Picture | null;
  size: { width: number; height: number } | null;
  comparing: Comparing | null;
  onStopCompare: () => void;
  /** The run the stage shows while it runs, in place of its picture. */
  live: Live | null;
  /** The task in progress, such as "Making…". */
  liveLabel: string;
  /** The model the task runs on, which the label's tooltip names. */
  liveModel: string;
  noModel: boolean;
  /** Why no image model can run, where no Server offers one to install. */
  unavailable: string | null;
  onRetry: () => void;
  /** The image model recommended for the device when none is there, or the one on its way. */
  suggestion: { label: string; downloading: boolean; license?: string } | null;
  onInstall: () => void;
  onIdea: (words: string) => void;
  /** Whether the picture takes marks and Extend: the model draws a part of a picture anew. */
  markable: boolean;
  tool: Tool;
  onTool: (tool: Tool) => void;
  marks: Marks;
  swatch: Swatch;
  onSwatch: (swatch: Swatch) => void;
  brushSize: number;
  onBrushSize: (size: number) => void;
  softEdge: number;
  onSoftEdge: (soft: number) => void;
  sides: Sides;
  onSides: (sides: Sides) => void;
  margins: Margins | null;
  actions: PictureActions | null;
}

export function Stage(props: StageProps) {
  const area = useRef<HTMLDivElement>(null);
  const tips = useFloatingTips('top');
  const { picture, size, margins } = props;
  const tools = props.markable && !!picture && !props.comparing && !props.live;
  const marking = tools && props.tool !== 'extend';
  const framed =
    size && margins
      ? { width: size.width + margins.left + margins.right, height: size.height + margins.top + margins.bottom }
      : size;
  const box = useFit(area, framed?.width ?? 0, framed?.height ?? 0);
  const waiting = tips('waiting', props.live?.waiting ?? undefined);
  const runsOn = tips('model', props.liveModel ? `With ${props.liveModel}` : undefined);
  const license = tips(
    'license',
    props.suggestion?.license ? `${props.suggestion.license} limits commercial use` : undefined,
  );

  let body;
  if (props.live) {
    body = (
      <div className="is-making">
        {props.live.preview ? (
          <img className="is-preview" src={assetUrl(props.live.preview)} alt="The picture so far" />
        ) : (
          <Icon name="image-ai-line" size={40} className="is-making-mark" />
        )}
        <div className="is-making-state">
          {props.live.waiting ? (
            <span {...waiting.hover} className="is-tipwrap">
              <StatusWord tone="info">Waiting</StatusWord>
              {waiting.tip}
            </span>
          ) : (
            <span {...runsOn.hover} className="is-tipwrap">
              {props.liveLabel}
              {runsOn.tip}
            </span>
          )}
        </div>
      </div>
    );
  } else if (props.comparing && picture) {
    body = (
      <div className="is-compare-one" style={{ width: box.width }}>
        <PictureCompare
          before={{ src: fileUrl(props.comparing.before.path), name: props.comparing.beforeName }}
          after={{ src: fileUrl(picture.path), name: props.comparing.afterName }}
        />
      </div>
    );
  } else if (picture && size && framed) {
    const scale = box.width / framed.width;
    body = (
      <div
        className="is-frame"
        style={{ width: box.width, height: box.height }}
        data-extend={props.tool === 'extend' && !!margins}
      >
        <img
          className="is-picture"
          src={fileUrl(picture.path)}
          alt={pictureName(picture)}
          style={
            margins
              ? {
                  left: margins.left * scale,
                  top: margins.top * scale,
                  width: size.width * scale,
                  height: size.height * scale,
                }
              : undefined
          }
        />
        {marking ? (
          <MarkLayer marks={props.marks} tool={props.tool} swatch={props.swatch} brushSize={props.brushSize} />
        ) : (
          props.actions &&
          !props.markable && <button className="is-frame-open" aria-label="View large" onClick={props.actions.large} />
        )}
      </div>
    );
  } else if (props.noModel) {
    body = props.suggestion?.downloading ? (
      <EmptyState icon={<Icon name="image-ai-line" size={30} />} title={`Downloading ${props.suggestion.label}…`} />
    ) : props.suggestion ? (
      <EmptyState icon={<Icon name="image-ai-line" size={30} />} title="No image model">
        <span {...license.hover} className="is-tipwrap">
          <Button variant="secondary" icon={<Icon name="download-2-line" size={14} />} onClick={props.onInstall}>
            Install {props.suggestion.label}
          </Button>
          {license.tip}
        </span>
      </EmptyState>
    ) : (
      <ProblemNotice
        problem={{ text: 'No image model can run now.', detail: props.unavailable, retry: props.onRetry }}
      />
    );
  } else {
    body = (
      <EmptyState icon={<Icon name="image-ai-line" size={30} />} title="Start from an idea">
        <div className="is-ideas">
          {IDEAS.map((idea) => (
            <Chip key={idea} onClick={() => props.onIdea(idea)}>
              {idea}
            </Chip>
          ))}
        </div>
      </EmptyState>
    );
  }

  return (
    <div className="is-stage" data-tools={tools}>
      {tools && <MarkBar {...props} />}
      <div className="is-stage-area" ref={area}>
        {body}
      </div>
    </div>
  );
}

/** Whether a row shows its compact form: whether its full form, measured
 *  while it shows, is wider than the row. Each `form`, such as a tool, has
 *  a full form of its own width. */
function useCompact(row: RefObject<HTMLElement | null>, form: string): boolean {
  const [compact, setCompact] = useState(false);
  const shown = useRef({ compact, form });
  const needs = useRef(new Map<string, number>());
  shown.current = { compact, form };
  const measure = () => {
    const element = row.current;
    if (!element) return;
    const room = element.clientWidth;
    const now = shown.current;
    if (!now.compact) {
      const parts = [...element.children];
      let need = parseFloat(getComputedStyle(element).columnGap) * (parts.length - 1);
      for (const part of parts) {
        const own = getComputedStyle(part);
        need += part.getBoundingClientRect().width + parseFloat(own.marginLeft) + parseFloat(own.marginRight);
      }
      needs.current.set(now.form, need);
      if (need > room) setCompact(true);
    } else {
      const need = needs.current.get(now.form);
      if (need === undefined || need <= room) setCompact(false);
    }
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => measure());
    observer.observe(row.current!);
    return () => observer.disconnect();
  }, []);
  return compact;
}

/** The tools of the picture: the brush, the box and the eraser with the
 *  colour they mark in, or the sides Extend grows. */
function MarkBar(props: StageProps) {
  const [colours, setColours] = useState<MenuAnchor | null>(null);
  const [sidesMenu, setSidesMenu] = useState<MenuAnchor | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const compact = useCompact(row, props.tool);
  const tips = useFloatingTips('bottom');
  const name = markerName(props.swatch);
  const tool = (id: Tool, icon: IconName, label: string, text: string) =>
    explained(
      tips,
      `tool-${id}`,
      text,
      <IconButton
        aria-label={label}
        aria-pressed={props.tool === id}
        className={props.tool === id ? 'hs-boxsel' : undefined}
        onClick={() => props.onTool(id)}
      >
        <Icon name={icon} size={16} />
      </IconButton>,
    );
  const marked = !!props.marks.find(props.swatch);

  let options: ReactNode;
  if (props.tool === 'extend') {
    const flip = (side: 'left' | 'right' | 'top' | 'bottom') =>
      props.onSides({ ...props.sides, [side]: !props.sides[side] });
    const sides = (['left', 'right', 'top', 'bottom'] as const).map((side) => ({
      side,
      label: side[0].toUpperCase() + side.slice(1),
    }));
    options = (
      <>
        {compact ? (
          <Button
            variant="ghost"
            size="sm"
            trailingIcon={<Icon name="arrow-down-s-line" size={14} />}
            onClick={(e) => setSidesMenu(anchorFrom('sides', e))}
          >
            Sides
          </Button>
        ) : (
          sides.map(({ side, label }) => (
            <BarToggle key={side} on={props.sides[side]} onClick={() => flip(side)}>
              {label}
            </BarToggle>
          ))
        )}
        {sidesMenu && (
          <MenuSurface anchor={sidesMenu} dir="down" onDismiss={() => setSidesMenu(null)}>
            {sides.map(({ side, label }) => (
              <MItem key={side} label={label} checked={props.sides[side]} onClick={() => flip(side)} />
            ))}
          </MenuSurface>
        )}
        <BarSlider
          compact={compact}
          sliders={[
            {
              label: 'Extend by',
              min: 0.1,
              max: 0.5,
              step: 0.05,
              value: props.sides.share,
              onChange: (share) => props.onSides({ ...props.sides, share }),
              shown: `${Math.round(props.sides.share * 100)}%`,
            },
          ]}
        />
      </>
    );
  } else {
    const sliders: BarSliderSpec[] = [
      ...(props.tool === 'rectangle'
        ? []
        : [
            {
              label: 'Brush size',
              min: 8,
              max: 160,
              step: 4,
              value: props.brushSize,
              onChange: props.onBrushSize,
              shown: `${props.brushSize}`,
            },
          ]),
      {
        label: 'Soft edge',
        min: 0,
        max: 48,
        step: 4,
        value: props.softEdge,
        onChange: props.onSoftEdge,
        shown: props.softEdge === 0 ? 'Off' : `${props.softEdge}`,
      },
    ];
    const invert = (
      <IconButton aria-label="Invert" disabled={!marked} onClick={() => props.marks.invert(props.swatch)}>
        <Icon name="contrast-line" size={16} />
      </IconButton>
    );
    options = (
      <>
        <span className="is-bar-divider" />
        {compact ? (
          <>
            {explained(
              tips,
              'colour',
              'Colour: each colour marks one area',
              <button
                type="button"
                className="is-colour-pick hs-hovbox-ink"
                data-swatch={props.swatch}
                aria-label={`Colour, ${name}`}
                onClick={(e) => setColours(anchorFrom('colours', e))}
              >
                <span className="hs-swatch-dot" />
                <Icon name="arrow-down-s-line" size={14} />
              </button>,
            )}
            {colours && (
              <MenuSurface anchor={colours} dir="down" onDismiss={() => setColours(null)}>
                {MARKERS.map((marker) => (
                  <MItem
                    key={marker.swatch}
                    icon={<span data-swatch={marker.swatch} className="hs-swatch-dot" />}
                    label={marker.name}
                    checked={marker.swatch === props.swatch}
                    onClick={() => (setColours(null), props.onSwatch(marker.swatch))}
                  />
                ))}
              </MenuSurface>
            )}
          </>
        ) : (
          <span className="is-colours" role="radiogroup" aria-label="Colour">
            {MARKERS.map((marker) =>
              explained(
                tips,
                `colour-${marker.swatch}`,
                `Mark in ${marker.name.toLowerCase()}`,
                <button
                  type="button"
                  role="radio"
                  className={`is-colour hs-hovbox-ink ${marker.swatch === props.swatch ? 'hs-boxsel' : ''}`}
                  data-swatch={marker.swatch}
                  aria-checked={marker.swatch === props.swatch}
                  aria-label={marker.name}
                  onClick={() => props.onSwatch(marker.swatch)}
                >
                  <span className="hs-swatch-dot" />
                </button>,
              ),
            )}
          </span>
        )}
        <BarSlider compact={compact} sliders={sliders} icon="equalizer-line" />
        {explained(
          tips,
          'invert',
          marked ? 'Mark everything that is not marked' : `Mark a part in ${name.toLowerCase()} first`,
          invert,
        )}
      </>
    );
  }

  return (
    <div ref={row} className="is-markbar">
      <span className="is-tools" role="toolbar" aria-label="Tools">
        {tool('brush', 'paint-brush-line', 'Brush', 'Brush: paint over a part to change it')}
        {tool('rectangle', 'rectangle-line', 'Box', 'Box: drag over a part to change it')}
        {tool('eraser', 'eraser-line', 'Eraser', 'Eraser: erase marks')}
        {tool('extend', 'expand-diagonal-line', 'Extend', 'Extend: grow the picture past its edges')}
      </span>
      {options}
    </div>
  );
}

/** The actions of the picture on the stage. */
export function StageBar(props: StageProps) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [varyMenu, setVaryMenu] = useState<MenuAnchor | null>(null);
  const [detailsAt, setDetailsAt] = useState<HTMLElement | null>(null);
  const tips = useFloatingTips('bottom');
  const { picture } = props;
  const actions = props.actions;

  let bar = null;
  if (props.comparing) {
    bar = (
      <BarToggle on onClick={props.onStopCompare}>
        {props.comparing.label}
      </BarToggle>
    );
  } else if (picture && actions) {
    const favourite = tips('favourite', picture.favourite ? 'Remove from favourites' : 'Add to favourites');
    const save = tips('save', 'Save as…');
    const more = tips('more', 'More');
    bar = (
      <>
        {actions.beforeAfter &&
          (props.narrow
            ? explained(
                tips,
                'before-after',
                'Before and after',
                <IconButton aria-label="Before and after" onClick={actions.beforeAfter}>
                  <Icon name="split-cells-horizontal" size={16} />
                </IconButton>,
              )
            : explained(
                tips,
                'before-after',
                'Slide to see the picture before this change',
                <BarToggle on={false} onClick={actions.beforeAfter}>
                  Before and after
                </BarToggle>,
              ))}
        {actions.vary &&
          !props.narrow &&
          explained(
            tips,
            'vary',
            'New pictures close to this one',
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon name="shuffle-line" size={14} />}
              trailingIcon={<Icon name="arrow-down-s-line" size={14} />}
              onClick={(e) => setVaryMenu(anchorFrom('vary', e))}
            >
              Vary
            </Button>,
          )}
        {actions.enlarge &&
          !props.narrow &&
          explained(
            tips,
            'enlarge',
            'A larger, sharper copy',
            <Button variant="ghost" size="sm" icon={<Icon name="zoom-in-line" size={14} />} onClick={actions.enlarge}>
              Enlarge
            </Button>,
          )}
        <span {...favourite.hover} className="is-tipwrap">
          <IconButton
            className={picture.favourite ? 'hs-boxsel' : undefined}
            aria-label={picture.favourite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={picture.favourite}
            onClick={actions.favourite}
          >
            <Icon name="heart-line" size={16} />
          </IconButton>
          {favourite.tip}
        </span>
        {!props.narrow && (
          <span {...save.hover} className="is-tipwrap">
            <IconButton aria-label="Save as…" onClick={actions.save}>
              <Icon name="download-2-line" size={16} />
            </IconButton>
            {save.tip}
          </span>
        )}
        <span {...more.hover} className="is-tipwrap">
          <IconButton aria-label="More" onClick={(e) => setMenu(anchorFrom('more', e))}>
            <Icon name="more-line" size={16} />
          </IconButton>
          {more.tip}
        </span>
      </>
    );
  }

  return (
    <div className="is-bar-group">
      {bar}
      {varyMenu && actions?.vary && (
        <MenuSurface anchor={varyMenu} dir="down" onDismiss={() => setVaryMenu(null)}>
          <MItem label="Vary a little" onClick={() => (setVaryMenu(null), actions.vary!('little'))} />
          <MItem label="Vary a lot" onClick={() => (setVaryMenu(null), actions.vary!('lot'))} />
        </MenuSurface>
      )}
      {menu && actions && (
        <MenuSurface anchor={menu} dir="down" onDismiss={() => setMenu(null)}>
          {props.narrow && actions.vary && (
            <>
              <MItem
                icon={<Icon name="shuffle-line" size={14} />}
                label="Vary a little"
                onClick={() => (setMenu(null), actions.vary!('little'))}
              />
              <MItem
                icon={<Icon name="shuffle-line" size={14} />}
                label="Vary a lot"
                onClick={() => (setMenu(null), actions.vary!('lot'))}
              />
            </>
          )}
          {props.narrow && actions.enlarge && (
            <MItem
              icon={<Icon name="zoom-in-line" size={14} />}
              label="Enlarge"
              onClick={() => (setMenu(null), actions.enlarge!())}
            />
          )}
          {props.narrow && (
            <MItem
              icon={<Icon name="download-2-line" size={14} />}
              label="Save as…"
              onClick={() => (setMenu(null), actions.save())}
            />
          )}
          {actions.addToPrompt && (
            <MItem
              icon={<Icon name="image-add-line" size={14} />}
              label={actions.addToPrompt.label}
              onClick={() => (setMenu(null), actions.addToPrompt!.add())}
            />
          )}
          <MItem
            icon={<Icon name="fullscreen-line" size={14} />}
            label="View large"
            onClick={() => (setMenu(null), actions.large())}
          />
          <MItem
            icon={<Icon name="information-line" size={14} />}
            label="Details"
            onClick={() => (setMenu(null), setDetailsAt(menu.element))}
          />
          <MItem
            icon={<Icon name="file-copy-line" size={14} />}
            label="Copy"
            onClick={() => (setMenu(null), actions.copy())}
          />
          {actions.copyPrompt && (
            <MItem
              icon={<Icon name="file-text-line" size={14} />}
              label="Copy prompt"
              onClick={() => (setMenu(null), actions.copyPrompt!())}
            />
          )}
          <MItem
            icon={<Icon name="folder-open-line" size={14} />}
            label="Show in folder"
            onClick={() => (setMenu(null), actions.reveal())}
          />
          <MItem
            icon={<Icon name="restart-line" size={14} />}
            label="Use these settings"
            onClick={() => (setMenu(null), actions.settings())}
          />
          <MDivider />
          <MItem
            icon={<Icon name="delete-bin-line" size={14} />}
            label="Delete"
            danger
            onClick={() => (setMenu(null), actions.remove())}
          />
        </MenuSurface>
      )}
      {detailsAt && picture && (
        <Details picture={picture} anchor={detailsAt} placement="bottom-end" onDismiss={() => setDetailsAt(null)} />
      )}
    </div>
  );
}
