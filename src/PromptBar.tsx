import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import {
  Button,
  Icon,
  IconButton,
  MDivider,
  MItem,
  MSection,
  MenuSurface,
  Popover,
  Slider,
  TextField,
  ToggleRow,
  anchorFrom,
  useFloatingTips,
  type IconName,
  type MenuAnchor,
  type Swatch,
} from '@hearthscale/app-ui';
import { call, fileUrl } from './bridge';
import { pictureName, type Picture } from './records';
import type { Abilities, Lora } from './models';
import type { ModelCard } from '@hearthscale/app';
import { CHANGES, SHAPES, SIZES, STYLES, type ChangeId, type ShapeId, type SizeId } from './recipes';
import { AREA_REFERENCES, markerName, type Area } from './marks';
import { explained } from './explained';

export interface Advanced {
  negative: string;
  steps: string;
  guidance: string;
  seed: string;
}

/** A press of the composer's footer, in the composer's own tool look. */
function Tool(props: {
  label: string;
  icon: IconName;
  disabled?: boolean;
  spin?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="hs-composer-tool hs-hovbox-ink is-tool"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={16} className={props.spin ? 'hs-spin' : undefined} />
    </button>
  );
}

function Menu(props: {
  label: string;
  value: string;
  icon?: ReactNode;
  short: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const tips = useFloatingTips('top');
  const tip = tips('trigger', props.short ? props.label : undefined);
  return (
    <>
      <button
        type="button"
        className="hs-model-trigger hs-hovbox-ink"
        aria-label={props.label}
        onClick={(e) => setAnchor(anchorFrom(props.label, e))}
        {...tip.hover}
      >
        {props.icon}
        <span className="hs-model-trigger-name hs-cut">{props.value}</span>
        <Icon name="arrow-down-s-line" size={14} className="hs-model-trigger-chevron" />
        {tip.tip}
      </button>
      {anchor && (
        <MenuSurface anchor={anchor} dir="up" onDismiss={() => setAnchor(null)}>
          {props.children(() => setAnchor(null))}
        </MenuSurface>
      )}
    </>
  );
}

/** A setting set on a scale, under its label, as a form's fields are. */
function SliderField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div className="hs-text-field">
      <span className="hs-field-label">{props.label}</span>
      <Slider
        label={props.label}
        value={props.value}
        onChange={props.onChange}
        min={props.min}
        max={props.max}
        step={props.step}
        shown={String(props.value)}
      />
    </div>
  );
}

/** Where Hearthscale draws its picker of the app's image model. The place
 *  takes the footer's free room, so the picker, drawn at its left, follows
 *  the other controls whatever the length of the model's name. */
function ModelSlot() {
  const place = useRef<HTMLSpanElement>(null);
  const reserved = useRef('');
  const reserve = () => {
    const box = place.current!.getBoundingClientRect();
    const insets = {
      left: box.left,
      top: box.top,
      right: window.innerWidth - box.right,
      bottom: window.innerHeight - box.bottom,
    };
    const key = JSON.stringify(insets);
    if (key === reserved.current) return;
    reserved.current = key;
    void call('hearthscale/ui/slots', { slots: [{ id: 'model', kind: 'model', model: 'image', insets }] });
  };
  useLayoutEffect(reserve);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => reserve());
    observer.observe(place.current!);
    observer.observe(document.documentElement);
    return () => {
      observer.disconnect();
      reserved.current = '';
      void call('hearthscale/ui/slots', { slots: [] });
    };
  }, []);
  return <span ref={place} className="is-model-slot" />;
}

/** How the composer's footer fits: `short` while the pickers' names do not
 *  fit, so the pickers show their icons alone; `wrap` while even the icons
 *  do not, so the footer takes a second line. Each picker's whole name is
 *  counted, so the result holds while names are hidden, and every part is
 *  counted on one line, the second line's model and main action each on
 *  its own, so it holds while the footer wraps. */
function useShortRow(row: RefObject<HTMLDivElement | null>): { short: boolean; wrap: boolean } {
  const [fit, setFit] = useState({ short: false, wrap: false });
  const measure = () => {
    const el = row.current!;
    const style = getComputedStyle(el);
    const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const nameGap = parseFloat(style.getPropertyValue('--gap-inline')) || 0;
    const parts = [...el.children]
      .flatMap((part) => (part.classList.contains('is-prompt-go') ? [...part.children] : [part]))
      .filter((part) => getComputedStyle(part).display !== 'none');
    let need = parseFloat(style.columnGap) * (parts.length - 1);
    let names = 0;
    for (const part of parts) {
      const own = getComputedStyle(part);
      need += Number(own.flexGrow) > 0 ? parseFloat(own.minWidth) || 0 : part.getBoundingClientRect().width;
      for (const name of part.querySelectorAll<HTMLElement>('.hs-model-trigger-name')) {
        const shown = name.getBoundingClientRect().width + parseFloat(getComputedStyle(name).marginRight);
        need += name.scrollWidth - shown;
        names += name.scrollWidth + nameGap;
      }
    }
    setFit((was) => {
      const short = need > (was.short ? room - 1 : room);
      const wrap = need - names > (was.wrap ? room - 1 : room);
      return short === was.short && wrap === was.wrap ? was : { short, wrap };
    });
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => measure());
    observer.observe(row.current!);
    return () => observer.disconnect();
  }, []);
  return fit;
}

function Loras(props: { adapters: ModelCard[]; on: Lora[]; onChange: (on: Lora[]) => void; short: boolean }) {
  const [at, setAt] = useState<HTMLElement | null>(null);
  const tips = useFloatingTips('top');
  const tip = tips('trigger', props.short ? 'LoRAs' : undefined);
  const used = props.on.filter((lora) => props.adapters.some((a) => a.id === lora.id));
  const flip = (id: string) =>
    props.onChange(
      props.on.some((lora) => lora.id === id)
        ? props.on.filter((lora) => lora.id !== id)
        : [...props.on, { id, weight: 1 }],
    );
  return (
    <>
      <button
        type="button"
        className="hs-model-trigger hs-hovbox-ink"
        aria-label="LoRAs"
        onClick={(e) => setAt(e.currentTarget)}
        {...tip.hover}
      >
        <Icon name="puzzle-line" size={14} />
        <span className="hs-model-trigger-name hs-cut">
          {used.length === 0 ? 'No LoRA' : used.length === 1 ? '1 LoRA' : `${used.length} LoRAs`}
        </span>
        <Icon name="arrow-down-s-line" size={14} className="hs-model-trigger-chevron" />
        {tip.tip}
      </button>
      {at && (
        <Popover anchor={at} placement="top-start" label="LoRAs" onDismiss={() => setAt(null)}>
          <div className="is-advanced">
            {props.adapters.map((adapter) => {
              const lora = props.on.find((l) => l.id === adapter.id);
              return (
                <div key={adapter.id} className="is-lora">
                  <ToggleRow title={adapter.label} on={!!lora} onFlip={() => flip(adapter.id)} />
                  {lora && (
                    <SliderField
                      label="Strength"
                      min={0}
                      max={2}
                      step={0.05}
                      value={lora.weight}
                      onChange={(weight) =>
                        props.onChange(props.on.map((l) => (l.id === adapter.id ? { ...l, weight } : l)))
                      }
                    />
                  )}
                </div>
              );
            })}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void call('hearthscale/ui/open-explore', { kind: 'adapter' })}
            >
              Get more LoRAs
            </Button>
          </div>
        </Popover>
      )}
    </>
  );
}

/** What the prompt makes: a new picture, a change of the picture shown,
 *  a change of its marked areas, a larger picture, or one picture of
 *  each model to compare. */
export type PromptMode = 'make' | 'change' | 'areas' | 'extend' | 'compare';

/** One marked area as a row of the prompt: its colour, what goes there,
 *  its pictures, and the press that deletes its marks. */
function AreaRow(props: {
  area: Area;
  current: boolean;
  references: boolean;
  onSwatch: () => void;
  onWords: (words: string) => void;
  onFile: (file: File) => void;
  onDropReference: (id: string) => void;
  onDrop: () => void;
  onSubmit: () => void;
}) {
  const { area } = props;
  const file = useRef<HTMLInputElement>(null);
  const tips = useFloatingTips('top');
  const name = markerName(area.swatch).toLowerCase();
  const pick = tips('pick', `Mark in ${name}`);
  const add = tips('add', `Add a picture of what goes in the ${name} area`);
  const drop = tips('drop', `Delete the ${name} marks`);
  const empty = tips('empty', area.words ? undefined : 'Leave empty to remove what is marked');
  return (
    <div className="is-area" data-swatch={area.swatch} data-current={props.current}>
      <span {...pick.hover} className="is-tipwrap">
        <button
          type="button"
          className={`is-colour hs-hovbox-ink ${props.current ? 'hs-boxsel' : ''}`}
          aria-label={`Mark in ${name}`}
          aria-pressed={props.current}
          onClick={props.onSwatch}
        >
          <span className="hs-swatch-dot" />
        </button>
        {pick.tip}
      </span>
      <span {...empty.hover} className="is-tipwrap is-area-field">
        <input
          className="is-area-words"
          value={area.words}
          placeholder="A wooden bench"
          aria-label={`${markerName(area.swatch)} area`}
          onFocus={props.onSwatch}
          onChange={(e) => props.onWords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              props.onSubmit();
            }
          }}
        />
        {empty.tip}
      </span>
      {props.references &&
        area.references.map((picture) => (
          <div key={picture.id} className="is-area-picture">
            <img className="is-shelf-picture" src={fileUrl(picture.path)} alt={pictureName(picture)} />
            <button
              className="hs-shelf-remove"
              aria-label={`Remove from the ${name} area`}
              onClick={() => props.onDropReference(picture.id)}
            >
              <Icon name="close-line" size={12} />
            </button>
          </div>
        ))}
      {props.references && area.references.length < AREA_REFERENCES && (
        <span {...add.hover} className="is-tipwrap">
          <IconButton size="sm" aria-label={`Add a picture to the ${name} area`} onClick={() => file.current?.click()}>
            <Icon name="image-add-line" size={14} />
          </IconButton>
          {add.tip}
        </span>
      )}
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked) props.onFile(picked);
        }}
      />
      <span {...drop.hover} className="is-tipwrap">
        <IconButton size="sm" aria-label={`Delete the ${name} marks`} onClick={props.onDrop}>
          <Icon name="delete-bin-line" size={14} />
        </IconButton>
        {drop.tip}
      </span>
    </div>
  );
}

export function PromptBar(props: {
  mode: PromptMode;
  words: string;
  onWords: (words: string) => void;
  onSubmit: () => void;
  action: string;
  /** Words the prompt shows while it is empty, as an example for the action. */
  example: string;
  ready: boolean;
  /** Why the action is off, where the person can change that. */
  why: string | null;
  busy: boolean;
  /** The picture the words change, shown first among the pictures of the prompt. */
  target: Picture | null;
  references: Picture[];
  onDropReference: (id: string) => void;
  onOpenFile: (file: File) => void;
  canAddReference: boolean;
  areas: Area[];
  swatch: Swatch;
  onSwatch: (swatch: Swatch) => void;
  onAreaWords: (swatch: Swatch, words: string) => void;
  onAreaFile: (swatch: Swatch, file: File) => void;
  onDropAreaReference: (swatch: Swatch, id: string) => void;
  onDropArea: (swatch: Swatch) => void;
  abilities: Abilities;
  /** The composer's box, which the view's toast sits above. */
  composer: RefObject<HTMLDivElement | null>;
  shape: ShapeId;
  onShape: (shape: ShapeId) => void;
  size: SizeId;
  onSize: (size: SizeId) => void;
  style: string | null;
  onStyle: (style: string | null) => void;
  count: number;
  onCount: (count: number) => void;
  /** How far a change of the whole picture moves from it, where the model draws it again. */
  change: ChangeId | null;
  onChange: (change: ChangeId) => void;
  adapters: ModelCard[];
  loras: Lora[];
  onLoras: (loras: Lora[]) => void;
  advanced: Advanced;
  onAdvanced: (advanced: Advanced) => void;
  onImprove: (() => void) | null;
  onDescribe: (() => void) | null;
  helping: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const { short, wrap } = useShortRow(footer);
  const [advancedAt, setAdvancedAt] = useState<HTMLElement | null>(null);
  const tips = useFloatingTips('top');
  const { mode } = props;
  const set = (field: keyof Advanced) => (e: { target: { value: string } }) =>
    props.onAdvanced({ ...props.advanced, [field]: e.target.value });
  const add = tips('add', mode === 'make' ? 'Open a picture' : 'Add a picture to the prompt');
  const improve = tips('improve', 'Improve my words');
  const describe = tips('describe', 'Describe this picture as words for a new picture');
  const off = tips('why', props.why ?? undefined);
  const changeTip = tips('change', 'How far the picture may move from this one');
  const { negative, steps, guidance, seed } = props.abilities;
  const settable = negative || steps || guidance || seed;
  const more = tips('advanced', settable ? 'More settings' : 'This model takes no more settings');
  const chips =
    mode === 'change' && props.target && props.references.length > 0 ? [props.target, ...props.references] : [];
  const worded = mode === 'make' || mode === 'change' || mode === 'extend' || mode === 'compare';
  const styled = mode === 'make' || mode === 'change' || mode === 'compare';

  return (
    <div className="hs-composer" ref={props.composer}>
      <div className="hs-composer-main">
        {chips.length > 0 && (
          <div className="hs-composer-shelf">
            <div className="hs-shelf-tiles">
              {chips.map((picture, index) => (
                <div key={picture.id} className="hs-shelf-tile">
                  <img className="is-shelf-picture" src={fileUrl(picture.path)} alt={pictureName(picture)} />
                  <span className="is-prompt-number">{index + 1}</span>
                  {index > 0 && (
                    <button
                      className="hs-shelf-remove"
                      aria-label="Remove from the prompt"
                      onClick={() => props.onDropReference(picture.id)}
                    >
                      <Icon name="close-line" size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {mode === 'areas' ? (
          <div className="hs-composer-field is-areas">
            {props.areas.map((area) => (
              <AreaRow
                key={area.swatch}
                area={area}
                current={area.swatch === props.swatch}
                references={props.abilities.edit}
                onSwatch={() => props.onSwatch(area.swatch)}
                onWords={(words) => props.onAreaWords(area.swatch, words)}
                onFile={(picked) => props.onAreaFile(area.swatch, picked)}
                onDropReference={(id) => props.onDropAreaReference(area.swatch, id)}
                onDrop={() => props.onDropArea(area.swatch)}
                onSubmit={() => props.ready && props.onSubmit()}
              />
            ))}
          </div>
        ) : (
          <div className="hs-composer-field">
            <textarea
              className="hs-composer-editor is-words"
              rows={2}
              value={props.words}
              placeholder={props.example}
              aria-label="Prompt"
              onChange={(e) => props.onWords(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (props.ready) props.onSubmit();
                }
              }}
            />
          </div>
        )}
        <div
          ref={footer}
          className="hs-composer-footer is-prompt-row"
          data-short={short ? 'true' : undefined}
          data-wrap={wrap ? 'true' : undefined}
        >
          {(mode === 'make' || (mode === 'change' && props.canAddReference)) && (
            <span {...add.hover} className="is-tipwrap">
              <Tool
                label={mode === 'make' ? 'Open a picture' : 'Add a picture to the prompt'}
                icon="attachment-2"
                onClick={() => file.current?.click()}
              />
              {add.tip}
            </span>
          )}
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (picked) props.onOpenFile(picked);
            }}
          />
          {(mode === 'make' || mode === 'compare') && (
            <Menu
              label="Shape and size"
              value={`${SHAPES.find((s) => s.id === props.shape)!.label}, ${SIZES.find((s) => s.id === props.size)!.label.toLowerCase()}`}
              icon={<Icon name="aspect-ratio-line" size={14} />}
              short={short}
            >
              {(close) => (
                <>
                  <MSection>Shape</MSection>
                  {SHAPES.map((shape) => (
                    <MItem
                      key={shape.id}
                      label={shape.label}
                      checked={shape.id === props.shape}
                      onClick={() => (close(), props.onShape(shape.id))}
                    />
                  ))}
                  <MDivider />
                  <MSection>Size</MSection>
                  {SIZES.map((size) => (
                    <MItem
                      key={size.id}
                      label={size.label}
                      checked={size.id === props.size}
                      onClick={() => (close(), props.onSize(size.id))}
                    />
                  ))}
                </>
              )}
            </Menu>
          )}
          {props.change && (
            <span {...changeTip.hover} className="is-tipwrap">
              <Menu
                label="Amount of change"
                value={CHANGES.find((c) => c.id === props.change)!.label}
                icon={<Icon name="contrast-drop-line" size={14} />}
                short={short}
              >
                {(close) =>
                  CHANGES.map((change) => (
                    <MItem
                      key={change.id}
                      label={change.label}
                      checked={change.id === props.change}
                      onClick={() => (close(), props.onChange(change.id))}
                    />
                  ))
                }
              </Menu>
              {changeTip.tip}
            </span>
          )}
          {styled && (
            <Menu
              label="Style"
              value={STYLES.find((s) => s.id === props.style)?.label ?? 'No style'}
              icon={<Icon name="palette-line" size={14} />}
              short={short}
            >
              {(close) => (
                <>
                  <MItem
                    label="No style"
                    checked={props.style === null}
                    onClick={() => (close(), props.onStyle(null))}
                  />
                  <MDivider />
                  {STYLES.map((style) => (
                    <MItem
                      key={style.id}
                      label={style.label}
                      checked={style.id === props.style}
                      onClick={() => (close(), props.onStyle(style.id))}
                    />
                  ))}
                </>
              )}
            </Menu>
          )}
          {props.abilities.loras && mode !== 'compare' && (
            <Loras adapters={props.adapters} on={props.loras} onChange={props.onLoras} short={short} />
          )}
          {(mode === 'make' || mode === 'change') && props.abilities.count > 1 && (
            <Menu
              label="Number of pictures"
              value={props.count === 1 ? '1 picture' : `${props.count} pictures`}
              icon={<Icon name="stack-line" size={14} />}
              short={short}
            >
              {(close) =>
                [1, 2, 4]
                  .filter((n) => n <= props.abilities.count)
                  .map((n) => (
                    <MItem
                      key={n}
                      label={n === 1 ? '1 picture' : `${n} pictures`}
                      checked={n === props.count}
                      onClick={() => (close(), props.onCount(n))}
                    />
                  ))
              }
            </Menu>
          )}
          <span {...more.hover} className="is-tipwrap">
            <Tool
              label="More settings"
              icon="equalizer-line"
              disabled={!settable}
              onClick={(e) => setAdvancedAt(e.currentTarget)}
            />
            {more.tip}
          </span>
          {(props.onDescribe || (props.onImprove && worded)) && (
            <span className="is-prompt-tools">
              {props.onDescribe && (
                <span {...describe.hover} className="is-tipwrap">
                  <Tool
                    label="Describe this picture"
                    icon="eye-line"
                    disabled={props.helping}
                    onClick={props.onDescribe}
                  />
                  {describe.tip}
                </span>
              )}
              {props.onImprove && worded && (
                <span {...improve.hover} className="is-tipwrap">
                  <Tool
                    label="Improve my words"
                    icon={props.helping ? 'loader-4-line' : 'quill-pen-line'}
                    spin={props.helping}
                    disabled={props.helping || !props.words.trim()}
                    onClick={props.onImprove}
                  />
                  {improve.tip}
                </span>
              )}
            </span>
          )}
          <span className="is-prompt-go">
            {mode === 'compare' ? <span className="hs-composer-fill" /> : <ModelSlot />}
            <span {...off.hover} className="is-tipwrap is-prompt-action">
              <Button variant="primary" size="sm" disabled={!props.ready || props.busy} onClick={props.onSubmit}>
                {props.action}
              </Button>
              {off.tip}
            </span>
          </span>
        </div>
      </div>
      {advancedAt && (
        <Popover anchor={advancedAt} placement="top-start" label="More settings" onDismiss={() => setAdvancedAt(null)}>
          <div className="is-advanced">
            {props.abilities.negative && (
              <TextField
                label="Things to leave out"
                placeholder="Text, blur, extra fingers"
                value={props.advanced.negative}
                onChange={set('negative')}
                data-autofocus
              />
            )}
            {props.abilities.steps &&
              explained(
                tips,
                'steps',
                'More detail takes longer',
                <SliderField
                  label="Detail"
                  min={1}
                  max={50}
                  step={1}
                  value={Number(props.advanced.steps) || props.abilities.stepsDefault}
                  onChange={(value) => props.onAdvanced({ ...props.advanced, steps: String(value) })}
                />,
              )}
            {props.abilities.guidance &&
              explained(
                tips,
                'guidance',
                'How closely the picture follows your words',
                <SliderField
                  label="Follow the words"
                  min={0}
                  max={20}
                  step={0.5}
                  value={
                    props.advanced.guidance === '' ? props.abilities.guidanceDefault : Number(props.advanced.guidance)
                  }
                  onChange={(value) => props.onAdvanced({ ...props.advanced, guidance: String(value) })}
                />,
              )}
            {props.abilities.seed &&
              explained(
                tips,
                'seed',
                'The same number and the same words make the same picture again',
                <TextField
                  label="Picture number"
                  inputMode="numeric"
                  placeholder="1234"
                  value={props.advanced.seed}
                  onChange={set('seed')}
                />,
              )}
          </div>
        </Popover>
      )}
    </div>
  );
}
