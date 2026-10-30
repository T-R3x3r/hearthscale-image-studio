import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
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

export type Tool = 'none' | 'brush' | 'extend';

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
  bigger?: () => void;
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
  const ink = () => getComputedStyle(canvas.current!).getPropertyValue('--accent').trim();

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

export function Stage(props: {
  /** Whether the bar keeps only its main actions and puts the rest in the More menu. */
  narrow: boolean;
  picture: Picture | null;
  size: { width: number; height: number } | null;
  source: Picture | null;
  sourceOf: Picture | null;
  comparing: boolean;
  onStopCompare: () => void;
  live: Live | null;
  liveLabel: string;
  noModel: boolean;
  onGetModels: () => void;
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
  actions: PictureActions | null;
  onStopEditing: () => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [varyMenu, setVaryMenu] = useState<MenuAnchor | null>(null);
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
          <Meter value={props.live.fraction} label="How far the picture is" />
        </div>
      </div>
    );
  } else if (props.noModel) {
    body = (
      <EmptyState icon={<Icon name="image-ai-line" size={30} />} title="No image model">
        <Button variant="secondary" icon={<Icon name="download-cloud-2-line" size={14} />} onClick={props.onGetModels}>
          Get models
        </Button>
      </EmptyState>
    );
  } else {
    body = (
      <EmptyState icon={<Icon name="image-ai-line" size={30} />} title="Describe a picture">
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

  const actions = props.actions;
  const tip = (key: string, text: string) => tips(key, text);

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
        <span className="is-bar-label">Brush size</span>
        <div className="is-bar-slider">
          <Slider
            label="Brush size"
            min={8}
            max={160}
            step={4}
            value={props.brushSize}
            onChange={props.onBrushSize}
            shown={`${props.brushSize}`}
          />
        </div>
        <Chip selected={props.erasing} onClick={() => props.onErasing(!props.erasing)}>
          Rub out
        </Chip>
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
    bar = (
      <>
        {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
          <Chip key={side} selected={props.sides[side]} onClick={() => flip(side)}>
            {side[0].toUpperCase() + side.slice(1)}
          </Chip>
        ))}
        <span className="is-bar-label">How much more</span>
        <div className="is-bar-slider">
          <Slider
            label="How much more"
            min={0.1}
            max={0.5}
            step={0.05}
            value={props.sides.share}
            onChange={(share) => props.onSides({ ...props.sides, share })}
            shown={`${Math.round(props.sides.share * 100)}%`}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={() => props.onTool('none')}>
          Done
        </Button>
      </>
    );
  } else if (isSource) {
    bar = (
      <>
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon name="paint-brush-line" size={14} />}
          onClick={() => props.onTool('brush')}
        >
          Brush
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon name="expand-diagonal-line" size={14} />}
          onClick={() => props.onTool('extend')}
        >
          Extend
        </Button>
        <Button variant="ghost" size="sm" icon={<Icon name="close-line" size={14} />} onClick={props.onStopEditing}>
          Stop editing
        </Button>
      </>
    );
  } else if (picture && actions) {
    const favourite = tip('favourite', picture.favourite ? 'Remove from favourites' : 'Add to favourites');
    const save = tip('save', 'Save as');
    const more = tip('more', 'More');
    bar = (
      <>
        {actions.edit && (
          <Button variant="secondary" size="sm" icon={<Icon name="image-edit-line" size={14} />} onClick={actions.edit}>
            Edit this
          </Button>
        )}
        {actions.vary && !props.narrow && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="shuffle-line" size={14} />}
            trailingIcon={<Icon name="arrow-down-s-line" size={14} />}
            onClick={(e) => setVaryMenu(anchorFrom('vary', e))}
          >
            Vary
          </Button>
        )}
        {actions.bigger && !props.narrow && (
          <Button variant="secondary" size="sm" icon={<Icon name="zoom-in-line" size={14} />} onClick={actions.bigger}>
            Bigger
          </Button>
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
            <IconButton aria-label="Save as" onClick={actions.save}>
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
    <div className="is-stage">
      <div className="is-stage-area" ref={area}>
        {body}
      </div>
      <div className="is-stage-bar">{bar}</div>
      {varyMenu && actions?.vary && (
        <MenuSurface anchor={varyMenu} dir="up" onDismiss={() => setVaryMenu(null)}>
          <MItem label="Vary a little" onClick={() => (setVaryMenu(null), actions.vary!('little'))} />
          <MItem label="Vary a lot" onClick={() => (setVaryMenu(null), actions.vary!('lot'))} />
        </MenuSurface>
      )}
      {menu && actions && (
        <MenuSurface anchor={menu} dir="up" onDismiss={() => setMenu(null)}>
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
          {props.narrow && actions.bigger && (
            <MItem
              icon={<Icon name="zoom-in-line" size={14} />}
              label="Bigger"
              onClick={() => (setMenu(null), actions.bigger!())}
            />
          )}
          {props.narrow && (
            <MItem
              icon={<Icon name="download-2-line" size={14} />}
              label="Save as"
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
              label="Compare with the picture before"
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
