import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react';
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  MDivider,
  MItem,
  MenuSurface,
  Meter,
  PictureCompare,
  Popover,
  SegmentedControl,
  Slider,
  StatusWord,
  anchorFrom,
  useFloatingTips,
  type MenuAnchor,
} from '@hearthscale/app-ui';
import { app, assetUrl, fileUrl } from './bridge';
import type { Picture } from './records';
import type { Live } from './runs';
import { IDEAS } from './recipes';
import { paintStrokes, type Margins, type Stroke } from './pictures';
import { ProblemNotice } from './Problem';

export type Tool = 'none' | 'brush' | 'extend';

/** How a change of a picture works: by the edit model's words, or drawn again. */
export type Mode = 'edit' | 'redraw';

export interface Sides {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
  share: number;
}

/** What the person can do with the picture on the stage. */
export interface PictureActions {
  edit?: () => void;
  addToPrompt?: () => void;
  vary?: (how: 'little' | 'lot') => void;
  enlarge?: () => void;
  plainBackground?: () => void;
  compareSource?: () => void;
  favourite: () => void;
  save: () => void;
  copy: () => void;
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

/** The strokes of the brush over the picture, kept at the picture's own size
 *  and drawn again from the strokes whenever the canvas loses its pixels or
 *  the theme changes its ink. */
function Brush(props: {
  strokes: Stroke[];
  width: number;
  height: number;
  size: number;
  erase: boolean;
  /** Whether the brush paints; the strokes stay in sight either way. */
  active: boolean;
  onStroke: (stroke: Stroke) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Stroke | null>(null);
  const ink = () => getComputedStyle(canvas.current!).getPropertyValue('--selection-ink').trim();

  useEffect(() => {
    const element = canvas.current!;
    const repaint = () => {
      element.width = props.width;
      element.height = props.height;
      paintStrokes(element.getContext('2d')!, props.strokes, ink());
    };
    const later = () => requestAnimationFrame(repaint);
    repaint();
    element.addEventListener('contextrestored', repaint);
    app.addEventListener('hostcontextchanged', later);
    return () => {
      element.removeEventListener('contextrestored', repaint);
      app.removeEventListener('hostcontextchanged', later);
    };
  }, [props.strokes, props.width, props.height]);

  const at = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * props.width,
      y: ((event.clientY - rect.top) / rect.height) * props.height,
      scale: props.width / rect.width,
    };
  };
  const extend = (event: PointerEvent<HTMLCanvasElement>) => {
    const stroke = drawing.current;
    if (!stroke) return;
    const { x, y } = at(event);
    const last = stroke.points[stroke.points.length - 1];
    stroke.points.push({ x, y });
    paintStrokes(canvas.current!.getContext('2d')!, [{ ...stroke, points: [last, { x, y }] }], ink());
  };
  const finish = () => {
    if (drawing.current) props.onStroke(drawing.current);
    drawing.current = null;
  };
  return (
    <canvas
      ref={canvas}
      className="is-strokes"
      data-active={props.active}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const { x, y, scale } = at(event);
        drawing.current = { size: props.size * scale, erase: props.erase, points: [{ x, y }] };
        paintStrokes(canvas.current!.getContext('2d')!, [drawing.current], ink());
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) extend(event);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
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

/** A slider of the bar: beside its label, or in a compact bar behind a
 *  press of the label that opens it. */
function BarSlider(props: {
  compact: boolean;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  shown: string;
}) {
  const [at, setAt] = useState<HTMLElement | null>(null);
  const slider = (
    <Slider
      label={props.label}
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      onChange={props.onChange}
      shown={props.shown}
    />
  );
  if (!props.compact) {
    return (
      <>
        <span className="is-bar-label">{props.label}</span>
        <div className="is-bar-slider">{slider}</div>
      </>
    );
  }
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        trailingIcon={<Icon name="arrow-down-s-line" size={14} />}
        onClick={(e) => setAt(e.currentTarget)}
      >
        {props.label}
      </Button>
      {at && (
        <Popover anchor={at} placement="bottom-end" label={props.label} onDismiss={() => setAt(null)}>
          <div className="is-bar-popover">{slider}</div>
        </Popover>
      )}
    </>
  );
}

/** What the stage and its bar show, and what they report. */
export interface StageProps {
  /** Whether the bar keeps only its main actions and puts the rest in the More menu. */
  narrow: boolean;
  /** Whether the tools' bars put their sides and their sliders behind presses that open them. */
  compact: boolean;
  picture: Picture | null;
  size: { width: number; height: number } | null;
  source: Picture | null;
  sourceOf: Picture | null;
  comparing: boolean;
  onStopCompare: () => void;
  live: Live | null;
  liveLabel: string;
  noModel: boolean;
  /** Why no image model can run, where no Server offers one to install. */
  unavailable: string | null;
  onRetry: () => void;
  /** The image model the Server suggests when none is there, or the one it downloads. */
  suggestion: { label: string; downloading: boolean } | null;
  onInstall: () => void;
  onIdea: (words: string) => void;
  tool: Tool;
  onTool: (tool: Tool) => void;
  strokes: Stroke[];
  brushSize: number;
  onBrushSize: (size: number) => void;
  erasing: boolean;
  onErasing: (on: boolean) => void;
  painted: boolean;
  onStroke: (stroke: Stroke) => void;
  onClearStrokes: () => void;
  sides: Sides;
  onSides: (sides: Sides) => void;
  margins: Margins | null;
  mode: Mode;
  onMode: (mode: Mode) => void;
  /** Whether the model can change a picture both ways, so the bar offers the choice. */
  showMode: boolean;
  actions: PictureActions | null;
  onStopEditing: () => void;
}

export function Stage(props: StageProps) {
  const area = useRef<HTMLDivElement>(null);
  const tips = useFloatingTips('top');
  const { picture, size, margins } = props;
  const isSource = !!picture && picture.id === props.source?.id;
  const framed =
    size && margins
      ? { width: size.width + margins.left + margins.right, height: size.height + margins.top + margins.bottom }
      : size;
  const box = useFit(area, framed?.width ?? 0, framed?.height ?? 0);
  const waiting = tips('waiting', props.live?.waiting ?? undefined);

  let body;
  if (props.comparing && picture && props.sourceOf) {
    body = (
      <div className="is-compare-one" style={{ width: box.width }}>
        <PictureCompare
          before={{ src: fileUrl(props.sourceOf.path), name: 'Before' }}
          after={{ src: fileUrl(picture.path), name: 'After' }}
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
          alt={picture.prompt}
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
        {props.actions && props.tool === 'none' && !props.painted && (
          <button className="is-frame-open" aria-label="View large" onClick={props.actions.large} />
        )}
        {(props.tool === 'brush' || props.painted) && isSource && (
          <Brush
            strokes={props.strokes}
            width={size.width}
            height={size.height}
            size={props.brushSize}
            erase={props.erasing}
            active={props.tool === 'brush'}
            onStroke={props.onStroke}
          />
        )}
      </div>
    );
  } else if (props.live) {
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
            <span>{props.liveLabel}</span>
          )}
          <Meter value={props.live.fraction} label="Progress" />
        </div>
      </div>
    );
  } else if (props.noModel) {
    body = props.suggestion?.downloading ? (
      <EmptyState icon={<Icon name="image-ai-line" size={30} />} title={`Downloading ${props.suggestion.label}…`} />
    ) : props.suggestion ? (
      <EmptyState icon={<Icon name="image-ai-line" size={30} />} title="No image model">
        <Button variant="secondary" icon={<Icon name="download-2-line" size={14} />} onClick={props.onInstall}>
          Install {props.suggestion.label}
        </Button>
      </EmptyState>
    ) : (
      <ProblemNotice
        problem={{ text: 'No image model can run now.', detail: props.unavailable, retry: props.onRetry }}
      />
    );
  } else {
    body = (
      <EmptyState icon={<Icon name="image-ai-line" size={30} />} title="New picture">
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
    <div className="is-stage">
      <div className="is-stage-area" ref={area}>
        {body}
      </div>
    </div>
  );
}

/** The actions of the picture on the stage, or the options of the tool in use. */
export function StageBar(props: StageProps) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [sidesMenu, setSidesMenu] = useState<MenuAnchor | null>(null);
  const [varyMenu, setVaryMenu] = useState<MenuAnchor | null>(null);
  const tips = useFloatingTips('bottom');
  const { picture } = props;
  const isSource = !!picture && picture.id === props.source?.id;
  const actions = props.actions;
  const tip = (key: string, text: string) => tips(key, text);
  /** A control with a tooltip that explains the app's word on it. */
  const explained = (key: string, text: string, control: ReactNode) => {
    const t = tip(key, text);
    return (
      <span {...t.hover} className="is-tipwrap">
        {control}
        {t.tip}
      </span>
    );
  };

  let bar = null;
  if (props.comparing) {
    bar = (
      <Button variant="ghost" size="sm" icon={<Icon name="arrow-left-line" size={14} />} onClick={props.onStopCompare}>
        Back to the picture
      </Button>
    );
  } else if (isSource && props.tool === 'brush') {
    bar = (
      <>
        <BarSlider
          compact={props.compact}
          label="Brush size"
          min={8}
          max={160}
          step={4}
          value={props.brushSize}
          onChange={props.onBrushSize}
          shown={`${props.brushSize}`}
        />
        {explained(
          'eraser',
          'Rub out brush strokes',
          <BarToggle on={props.erasing} onClick={() => props.onErasing(!props.erasing)}>
            Rub out
          </BarToggle>,
        )}
        <Button variant="ghost" size="sm" onClick={props.onClearStrokes}>
          Clear
        </Button>
        <Button variant="secondary" size="sm" onClick={() => props.onTool('none')}>
          Done
        </Button>
      </>
    );
  } else if (isSource && props.tool === 'extend') {
    const flip = (side: 'left' | 'right' | 'top' | 'bottom') =>
      props.onSides({ ...props.sides, [side]: !props.sides[side] });
    const sides = (['left', 'right', 'top', 'bottom'] as const).map((side) => ({
      side,
      label: side[0].toUpperCase() + side.slice(1),
    }));
    bar = (
      <>
        {props.compact ? (
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
          compact={props.compact}
          label="Extend by"
          min={0.1}
          max={0.5}
          step={0.05}
          value={props.sides.share}
          onChange={(share) => props.onSides({ ...props.sides, share })}
          shown={`${Math.round(props.sides.share * 100)}%`}
        />
        <Button variant="secondary" size="sm" onClick={() => props.onTool('none')}>
          Done
        </Button>
      </>
    );
  } else if (isSource) {
    bar = (
      <>
        {props.showMode &&
          explained(
            'mode',
            'Edit changes what you name; Redraw paints the picture again from your words',
            <SegmentedControl
              label="How to change the picture"
              value={props.mode}
              options={[
                { value: 'edit', label: 'Edit' },
                { value: 'redraw', label: 'Redraw' },
              ]}
              onChange={props.onMode}
            />,
          )}
        {props.narrow ? (
          <>
            {explained(
              'brush',
              'Brush: paint over a part to fill it or erase it',
              <IconButton aria-label="Brush" onClick={() => props.onTool('brush')}>
                <Icon name="paint-brush-line" size={16} />
              </IconButton>,
            )}
            {explained(
              'extend',
              'Extend: grow the picture past its edges',
              <IconButton aria-label="Extend" onClick={() => props.onTool('extend')}>
                <Icon name="expand-diagonal-line" size={16} />
              </IconButton>,
            )}
            {explained(
              'stop',
              'Stop editing',
              <IconButton aria-label="Stop editing" onClick={props.onStopEditing}>
                <Icon name="close-line" size={16} />
              </IconButton>,
            )}
          </>
        ) : (
          <>
            {explained(
              'brush',
              'Paint over a part to fill it or erase it',
              <Button
                variant="ghost"
                size="sm"
                icon={<Icon name="paint-brush-line" size={14} />}
                onClick={() => props.onTool('brush')}
              >
                Brush
              </Button>,
            )}
            {explained(
              'extend',
              'Grow the picture past its edges',
              <Button
                variant="ghost"
                size="sm"
                icon={<Icon name="expand-diagonal-line" size={14} />}
                onClick={() => props.onTool('extend')}
              >
                Extend
              </Button>,
            )}
            <Button variant="ghost" size="sm" icon={<Icon name="close-line" size={14} />} onClick={props.onStopEditing}>
              Stop editing
            </Button>
          </>
        )}
      </>
    );
  } else if (picture && actions) {
    const favourite = tip('favourite', picture.favourite ? 'Remove from favourites' : 'Add to favourites');
    const save = tip('save', 'Save as…');
    const more = tip('more', 'More');
    bar = (
      <>
        {actions.edit && (
          <Button variant="ghost" size="sm" icon={<Icon name="image-edit-line" size={14} />} onClick={actions.edit}>
            Edit this
          </Button>
        )}
        {actions.vary &&
          !props.narrow &&
          explained(
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
            'enlarge',
            'A larger, sharper copy',
            <Button variant="ghost" size="sm" icon={<Icon name="zoom-in-line" size={14} />} onClick={actions.enlarge}>
              Enlarge
            </Button>,
          )}
        <span {...favourite.hover} className="is-tipwrap">
          <IconButton
            aria-label={picture.favourite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={picture.favourite}
            onClick={actions.favourite}
          >
            <Icon name={picture.favourite ? 'heart-fill' : 'heart-line'} size={16} />
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
              label="Add to the prompt"
              onClick={() => (setMenu(null), actions.addToPrompt!())}
            />
          )}
          {actions.plainBackground && (
            <MItem
              icon={<Icon name="scissors-cut-line" size={14} />}
              label="Remove background"
              onClick={() => (setMenu(null), actions.plainBackground!())}
            />
          )}
          {actions.compareSource && (
            <MItem
              icon={<Icon name="contrast-2-line" size={14} />}
              label="Compare with the original"
              onClick={() => (setMenu(null), actions.compareSource!())}
            />
          )}
          <MItem
            icon={<Icon name="fullscreen-line" size={14} />}
            label="View large"
            onClick={() => (setMenu(null), actions.large())}
          />
          <MItem
            icon={<Icon name="file-copy-line" size={14} />}
            label="Copy"
            onClick={() => (setMenu(null), actions.copy())}
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
    </div>
  );
}
