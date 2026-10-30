import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import {
  Button,
  Icon,
  MDivider,
  MItem,
  MSection,
  MenuSurface,
  Popover,
  Slider,
  TextField,
  anchorFrom,
  useFloatingTips,
  type IconName,
  type MenuAnchor,
} from '@hearthscale/app-ui';
import { call, fileUrl } from './bridge';
import type { Picture } from './records';
import type { Abilities } from './models';
import { SHAPES, SIZES, STYLES, type ShapeId, type SizeId } from './recipes';

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

function Menu(props: { label: string; value: string; icon?: ReactNode; children: (close: () => void) => ReactNode }) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  return (
    <>
      <button
        type="button"
        className="hs-model-trigger hs-hovbox-ink"
        aria-label={props.label}
        onClick={(e) => setAnchor(anchorFrom(props.label, e))}
      >
        {props.icon}
        <span className="hs-model-trigger-name">{props.value}</span>
        <Icon name="arrow-down-s-line" size={14} className="hs-model-trigger-chevron" />
      </button>
      {anchor && (
        <MenuSurface anchor={anchor} dir="up" onDismiss={() => setAnchor(null)}>
          {props.children(() => setAnchor(null))}
        </MenuSurface>
      )}
    </>
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

export function PromptBar(props: {
  words: string;
  onWords: (words: string) => void;
  onSubmit: () => void;
  action: string;
  /** Words the prompt shows while it is empty, as an example for the action. */
  example: string;
  ready: boolean;
  busy: boolean;
  source: Picture | null;
  references: Picture[];
  onDropSource: () => void;
  onDropReference: (id: string) => void;
  onOpenFile: (file: File) => void;
  canAddReference: boolean;
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
  showCount: boolean;
  comparing: boolean;
  advanced: Advanced;
  onAdvanced: (advanced: Advanced) => void;
  amount: number | null;
  onAmount: (amount: number) => void;
  onImprove: (() => void) | null;
  onDescribe: (() => void) | null;
  helping: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [advancedAt, setAdvancedAt] = useState<HTMLElement | null>(null);
  const tips = useFloatingTips('top');
  const set = (field: keyof Advanced) => (e: { target: { value: string } }) =>
    props.onAdvanced({ ...props.advanced, [field]: e.target.value });
  const add = tips('add', props.source ? 'Add a picture to the prompt' : 'Open a picture');
  const improve = tips('improve', 'Improve my words');
  const describe = tips('describe', 'Describe this picture');
  const { negative, steps, guidance, seed } = props.abilities;
  const settable = negative || steps || guidance || seed;
  const more = tips('advanced', settable ? 'More settings' : 'This model takes no more settings');
  /** A control with a tooltip that explains the app's word on it. */
  const explained = (key: string, text: string, control: ReactNode) => {
    const t = tips(key, text);
    return (
      <span {...t.hover} className="is-tipwrap">
        {control}
        {t.tip}
      </span>
    );
  };
  const chips = [props.source, ...props.references].filter((p): p is Picture => !!p);

  return (
    <div className="hs-composer" ref={props.composer}>
      <div className="hs-composer-main">
        {chips.length > 0 && (
          <div className="hs-composer-shelf">
            <div className="hs-shelf-tiles">
              {chips.map((picture, index) => (
                <div key={picture.id} className="hs-shelf-tile">
                  <img className="is-shelf-picture" src={fileUrl(picture.path)} alt={picture.prompt} />
                  {chips.length > 1 && <span className="is-prompt-number">{index + 1}</span>}
                  <button
                    className="hs-shelf-remove"
                    aria-label="Remove from the prompt"
                    onClick={() => (index === 0 ? props.onDropSource() : props.onDropReference(picture.id))}
                  >
                    <Icon name="close-line" size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
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
        <div className="hs-composer-footer is-prompt-row">
          {!props.comparing && (!props.source || props.canAddReference) && (
            <span {...add.hover} className="is-tipwrap">
              <Tool
                label={props.source ? 'Add a picture to the prompt' : 'Open a picture'}
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
          {!props.source && (
            <>
              <Menu
                label="Shape and size"
                value={`${SHAPES.find((s) => s.id === props.shape)!.label}, ${SIZES.find((s) => s.id === props.size)!.label.toLowerCase()}`}
                icon={<Icon name="aspect-ratio-line" size={14} />}
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
            </>
          )}
          <Menu
            label="Style"
            value={STYLES.find((s) => s.id === props.style)?.label ?? 'No style'}
            icon={<Icon name="palette-line" size={14} />}
          >
            {(close) => (
              <>
                <MItem label="No style" checked={props.style === null} onClick={() => (close(), props.onStyle(null))} />
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
          {props.showCount && props.abilities.count > 1 && (
            <Menu label="Number of pictures" value={props.count === 1 ? '1 picture' : `${props.count} pictures`}>
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
          {props.amount !== null &&
            explained(
              'amount',
              'How far the new picture may move from this one',
              <span className="is-bar-label">Amount</span>,
            )}
          {props.amount !== null && (
            <div className="is-amount">
              <Slider
                label="Amount"
                value={props.amount}
                onChange={props.onAmount}
                min={0.05}
                max={1}
                step={0.05}
                shown={`${Math.round(props.amount * 100)}%`}
              />
            </div>
          )}
          {props.comparing ? <span className="hs-composer-fill" /> : <ModelSlot />}
          <span className="is-prompt-end">
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
            {props.onImprove && (
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
            <Button variant="primary" size="sm" disabled={!props.ready || props.busy} onClick={props.onSubmit}>
              {props.action}
            </Button>
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
                'steps',
                'More steps take longer and can add detail',
                <TextField
                  label="Steps"
                  inputMode="numeric"
                  placeholder="Automatic"
                  value={props.advanced.steps}
                  onChange={set('steps')}
                />,
              )}
            {props.abilities.guidance &&
              explained(
                'guidance',
                'How closely the picture follows the words',
                <TextField
                  label="Prompt strength"
                  inputMode="decimal"
                  placeholder="Automatic"
                  value={props.advanced.guidance}
                  onChange={set('guidance')}
                />,
              )}
            {props.abilities.seed &&
              explained(
                'seed',
                'The same number and the same words make the same picture again',
                <TextField
                  label="Variation number"
                  inputMode="numeric"
                  placeholder="Random"
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
