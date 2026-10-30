import { useRef, useState, type ReactNode } from 'react';
import type { ModelCard } from '@hearthscale/app';
import {
  Button,
  Icon,
  IconButton,
  MDivider,
  MItem,
  MSection,
  MenuSurface,
  Popover,
  SegmentedControl,
  Slider,
  TextField,
  anchorFrom,
  useFloatingTips,
  type MenuAnchor,
} from '@hearthscale/app-ui';
import { fileUrl } from './bridge';
import type { Picture } from './records';
import type { Abilities } from './models';
import { gigabytes } from './models';
import { SHAPES, SIZES, STYLES, type ShapeId, type SizeId } from './recipes';

export interface Advanced {
  negative: string;
  steps: string;
  guidance: string;
  seed: string;
}

export type Mode = 'edit' | 'redraw';

function Menu(props: { label: string; value: string; icon?: ReactNode; children: (close: () => void) => ReactNode }) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={props.icon}
        trailingIcon={<Icon name="arrow-down-s-line" size={14} />}
        aria-label={props.label}
        onClick={(e) => setAnchor(anchorFrom(props.label, e))}
      >
        {props.value}
      </Button>
      {anchor && (
        <MenuSurface anchor={anchor} dir="up" maxHeight={360} onDismiss={() => setAnchor(null)}>
          {props.children(() => setAnchor(null))}
        </MenuSurface>
      )}
    </>
  );
}

export function PromptBar(props: {
  words: string;
  onWords: (words: string) => void;
  onSubmit: () => void;
  action: string;
  ready: boolean;
  busy: boolean;
  source: Picture | null;
  references: Picture[];
  onDropSource: () => void;
  onDropReference: (id: string) => void;
  onOpenFile: (file: File) => void;
  canAddReference: boolean;
  models: ModelCard[];
  model: ModelCard | null;
  abilities: Abilities;
  onModel: (id: string) => void;
  onGetModels: () => void;
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
  mode: Mode;
  onMode: (mode: Mode) => void;
  showMode: boolean;
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
  const more = tips('advanced', 'More settings');
  const chips = [props.source, ...props.references].filter((p): p is Picture => !!p);

  return (
    <div className="is-prompt hs-card" data-variant="glass">
      {chips.length > 0 && (
        <div className="is-prompt-pictures">
          {chips.map((picture, index) => (
            <span key={picture.id} className="is-prompt-picture">
              <img src={fileUrl(picture.path)} alt={picture.prompt} />
              {chips.length > 1 && <span className="is-prompt-number">{index + 1}</span>}
              <button
                className="is-prompt-drop"
                aria-label="Remove from the prompt"
                onClick={() => (index === 0 ? props.onDropSource() : props.onDropReference(picture.id))}
              >
                <Icon name="close-line" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        className="hs-ta is-words"
        rows={2}
        value={props.words}
        placeholder={props.source ? 'Describe the change' : 'Describe a picture'}
        aria-label="Prompt"
        onChange={(e) => props.onWords(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (props.ready) props.onSubmit();
          }
        }}
      />
      <div className="is-prompt-row">
        {!props.comparing && (!props.source || props.canAddReference) && (
          <span {...add.hover} className="is-tipwrap">
            <IconButton
              aria-label={props.source ? 'Add a picture to the prompt' : 'Open a picture'}
              onClick={() => file.current?.click()}
            >
              <Icon name="image-add-line" size={16} />
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
            if (picked) props.onOpenFile(picked);
          }}
        />
        {!props.comparing && (
          <Menu
            label="Image model"
            value={props.model?.label ?? 'No image model'}
            icon={<Icon name="image-ai-line" size={14} />}
          >
            {(close) => (
              <>
                {props.models.map((card) => (
                  <MItem
                    key={card.id}
                    label={card.label}
                    chip={gigabytes(card.sizeBytes)}
                    checked={card.id === props.model?.id}
                    onClick={() => (close(), props.onModel(card.id))}
                  />
                ))}
                {props.models.length > 0 && <MDivider />}
                <MItem
                  icon={<Icon name="download-cloud-2-line" size={14} />}
                  label="Get more models"
                  onClick={() => (close(), props.onGetModels())}
                />
              </>
            )}
          </Menu>
        )}
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
          <Menu label="How many" value={props.count === 1 ? '1 picture' : `${props.count} pictures`}>
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
          <IconButton aria-label="More settings" onClick={(e) => setAdvancedAt(e.currentTarget)}>
            <Icon name="equalizer-line" size={16} />
          </IconButton>
          {more.tip}
        </span>
        {props.showMode && (
          <SegmentedControl
            label="How to change the picture"
            value={props.mode}
            options={[
              { value: 'edit', label: 'Follow my words' },
              { value: 'redraw', label: 'Redraw' },
            ]}
            onChange={props.onMode}
          />
        )}
        {props.amount !== null && <span className="is-bar-label">How much</span>}
        {props.amount !== null && (
          <div className="is-amount">
            <Slider
              label="How much to change"
              value={props.amount}
              onChange={props.onAmount}
              min={0.05}
              max={1}
              step={0.05}
              shown={`${Math.round(props.amount * 100)}%`}
            />
          </div>
        )}
        <span className="is-grow" />
        {props.onDescribe && (
          <span {...describe.hover} className="is-tipwrap">
            <IconButton aria-label="Describe this picture" disabled={props.helping} onClick={props.onDescribe}>
              <Icon name="eye-line" size={16} />
            </IconButton>
            {describe.tip}
          </span>
        )}
        {props.onImprove && (
          <span {...improve.hover} className="is-tipwrap">
            <IconButton
              aria-label="Improve my words"
              disabled={props.helping || !props.words.trim()}
              onClick={props.onImprove}
            >
              <Icon
                name={props.helping ? 'loader-4-line' : 'magic-line'}
                size={16}
                className={props.helping ? 'hs-spin' : undefined}
              />
            </IconButton>
            {improve.tip}
          </span>
        )}
        <Button variant="primary" size="sm" disabled={!props.ready || props.busy} onClick={props.onSubmit}>
          {props.action}
        </Button>
      </div>
      {advancedAt && (
        <Popover anchor={advancedAt} placement="top-start" label="More settings" onDismiss={() => setAdvancedAt(null)}>
          <div className="is-advanced">
            {props.abilities.negative && (
              <TextField label="Leave out" value={props.advanced.negative} onChange={set('negative')} data-autofocus />
            )}
            {props.abilities.steps && (
              <TextField
                label="Steps"
                inputMode="numeric"
                placeholder="Model's own"
                value={props.advanced.steps}
                onChange={set('steps')}
              />
            )}
            {props.abilities.guidance && (
              <TextField
                label="Follow the words"
                inputMode="decimal"
                placeholder="Model's own"
                value={props.advanced.guidance}
                onChange={set('guidance')}
              />
            )}
            {props.abilities.seed && (
              <TextField
                label="Variation number"
                inputMode="numeric"
                placeholder="New each time"
                value={props.advanced.seed}
                onChange={set('seed')}
              />
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
