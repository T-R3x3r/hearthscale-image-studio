import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  Button,
  Icon,
  MDivider,
  MItem,
  MenuSurface,
  TextInput,
  VirtualList,
  type MenuAnchor,
  type VirtualListHandle,
} from '@hearthscale/app-ui';
import { fileUrl } from './bridge';
import { pictureName, type Picture } from './records';
import type { PictureActions } from './Stage';
import { Details } from './Details';

const PER_ROW = 3;

/** The classes of a row of the library's navigation: the kit's hover plate,
 *  and its selected plate or its resting ink. */
const navRow = (on: boolean) => `is-nav-row hs-hovbox-ink ${on ? 'hs-boxsel' : 'hs-inkmut'}`;

type Row = { kind: 'day'; label: string } | { kind: 'pictures'; pictures: Picture[] };

function dayLabel(made: number, locale: string): string {
  const day = new Date(made);
  const today = new Date();
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(today) - start(day)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return day.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

/** The rows of the library: a heading for each day, then its pictures. */
function rowsOf(pictures: Picture[], locale: string): Row[] {
  const rows: Row[] = [];
  let day = '';
  let row: Picture[] = [];
  const close = () => {
    if (row.length) rows.push({ kind: 'pictures', pictures: row });
    row = [];
  };
  for (const picture of pictures) {
    const label = dayLabel(picture.made, locale);
    if (label !== day) {
      close();
      rows.push({ kind: 'day', label });
      day = label;
    }
    row.push(picture);
    if (row.length === PER_ROW) close();
  }
  close();
  return rows;
}

function placesOf(rows: Row[]): Map<string, { row: number; column: number }> {
  const places = new Map<string, { row: number; column: number }>();
  rows.forEach((row, index) => {
    if (row.kind === 'pictures') row.pictures.forEach((p, column) => places.set(p.id, { row: index, column }));
  });
  return places;
}

export interface LibraryActions {
  of: (picture: Picture) => PictureActions;
  large: (picture: Picture) => void;
  compare: (() => void) | null;
  favourite: (pictures: Picture[], on: boolean) => void;
  remove: (pictures: Picture[]) => void;
}

function PictureMenu(props: {
  pictures: Picture[];
  actions: LibraryActions;
  close: () => void;
  onDetails: (picture: Picture) => void;
  onRemove: (pictures: Picture[]) => void;
}) {
  const { pictures, close } = props;
  const run = (action: () => void) => () => (close(), action());
  const allFavourite = pictures.every((p) => p.favourite);
  const favourite = (
    <MItem
      icon={<Icon name="heart-line" size={14} />}
      label={allFavourite ? 'Remove from favourites' : 'Add to favourites'}
      onClick={run(() => props.actions.favourite(pictures, !allFavourite))}
    />
  );
  if (pictures.length > 1) {
    return (
      <>
        {props.actions.compare && (
          <MItem
            icon={<Icon name="contrast-2-line" size={14} />}
            label="Compare"
            onClick={run(props.actions.compare)}
          />
        )}
        {favourite}
        <MDivider />
        <MItem
          icon={<Icon name="delete-bin-line" size={14} />}
          label={`Delete ${pictures.length} pictures`}
          danger
          onClick={run(() => props.onRemove(pictures))}
        />
      </>
    );
  }
  const picture = pictures[0];
  const actions = props.actions.of(picture);
  return (
    <>
      <MItem
        icon={<Icon name="fullscreen-line" size={14} />}
        label="View large"
        onClick={run(() => props.actions.large(picture))}
      />
      <MItem
        icon={<Icon name="information-line" size={14} />}
        label="Details"
        onClick={run(() => props.onDetails(picture))}
      />
      {actions.edit && (
        <MItem icon={<Icon name="image-edit-line" size={14} />} label="Edit this" onClick={run(actions.edit)} />
      )}
      {actions.addToPrompt && (
        <MItem
          icon={<Icon name="image-add-line" size={14} />}
          label="Add to the prompt"
          onClick={run(actions.addToPrompt)}
        />
      )}
      {actions.vary && (
        <>
          <MItem
            icon={<Icon name="shuffle-line" size={14} />}
            label="Vary a little"
            onClick={run(() => actions.vary!('little'))}
          />
          <MItem
            icon={<Icon name="shuffle-line" size={14} />}
            label="Vary a lot"
            onClick={run(() => actions.vary!('lot'))}
          />
        </>
      )}
      {actions.more && (
        <MItem icon={<Icon name="add-line" size={14} />} label="Make more like this" onClick={run(actions.more)} />
      )}
      {actions.enlarge && (
        <MItem icon={<Icon name="zoom-in-line" size={14} />} label="Enlarge" onClick={run(actions.enlarge)} />
      )}
      {actions.compareSource && (
        <MItem
          icon={<Icon name="contrast-2-line" size={14} />}
          label="Compare with the original"
          onClick={run(actions.compareSource)}
        />
      )}
      <MDivider />
      <MItem icon={<Icon name="restart-line" size={14} />} label="Use these settings" onClick={run(actions.settings)} />
      <MItem icon={<Icon name="file-copy-line" size={14} />} label="Copy" onClick={run(actions.copy)} />
      {actions.copyPrompt && (
        <MItem icon={<Icon name="file-text-line" size={14} />} label="Copy prompt" onClick={run(actions.copyPrompt)} />
      )}
      <MItem icon={<Icon name="download-2-line" size={14} />} label="Save as…" onClick={run(actions.save)} />
      <MItem icon={<Icon name="folder-open-line" size={14} />} label="Show in folder" onClick={run(actions.reveal)} />
      {favourite}
      <MDivider />
      <MItem
        icon={<Icon name="delete-bin-line" size={14} />}
        label="Delete"
        danger
        onClick={run(() => props.onRemove(pictures))}
      />
    </>
  );
}

export function Library(props: {
  pictures: Picture[];
  locale: string;
  shown: string | null;
  selected: string[];
  words: string;
  favourites: boolean;
  page: 'studio' | 'compare';
  actions: LibraryActions;
  onWords: (words: string) => void;
  onFavourites: (on: boolean) => void;
  onSelect: (ids: string[], show: Picture | null) => void;
  onOpen: () => void;
  onNew: () => void;
  onPage: (page: 'studio' | 'compare') => void;
}) {
  const rows = useMemo(() => rowsOf(props.pictures, props.locale), [props.pictures, props.locale]);
  const places = useMemo(() => placesOf(rows), [rows]);
  const list = useRef<VirtualListHandle>(null);
  const anchor = useRef<string | null>(null);
  const refocus = useRef<string[] | null>(null);
  const [menu, setMenu] = useState<{ at: MenuAnchor; pictures: Picture[] } | null>(null);
  const [details, setDetails] = useState<{ picture: Picture; at: HTMLElement } | null>(null);
  const selected = new Set(props.selected);
  const chosen = () => props.pictures.filter((p) => selected.has(p.id));
  const current = places.has(props.shown ?? '') ? props.shown : (props.pictures[0]?.id ?? null);

  const thumbOf = (id: string) => document.querySelector<HTMLElement>(`[data-picture="${id}"]`);

  /** Retries until the virtual list draws the row. */
  const focus = (id: string) => {
    const place = places.get(id);
    if (!place) return;
    list.current?.scrollToIndex(place.row, 'auto');
    let tries = 0;
    const attempt = () => {
      const thumb = thumbOf(id);
      if (thumb) thumb.focus();
      else if (tries++ < 10) setTimeout(attempt, 30);
    };
    attempt();
  };

  const remove = (pictures: Picture[]) => {
    refocus.current = pictures.map((p) => p.id);
    props.actions.remove(pictures);
  };

  useEffect(() => {
    const gone = refocus.current?.every((id) => !places.has(id));
    const lost = !document.activeElement || document.activeElement === document.body;
    if (gone && lost && props.shown && places.has(props.shown)) {
      refocus.current = null;
      focus(props.shown);
    }
  });

  const range = (to: Picture) => {
    const from = props.pictures.findIndex((p) => p.id === (anchor.current ?? props.shown));
    const end = props.pictures.findIndex((p) => p.id === to.id);
    if (from < 0) return [to.id];
    return props.pictures.slice(Math.min(from, end), Math.max(from, end) + 1).map((p) => p.id);
  };

  const pick = (picture: Picture, how: { toggle: boolean; extend: boolean }) => {
    if (how.extend) return props.onSelect(range(picture), picture);
    if (how.toggle) {
      anchor.current = picture.id;
      if (!selected.has(picture.id)) return props.onSelect([...props.selected, picture.id], picture);
      const left = props.selected.filter((id) => id !== picture.id);
      if (left.length === 0) return;
      const show =
        picture.id === props.shown ? (props.pictures.find((p) => p.id === left[left.length - 1]) ?? null) : null;
      return props.onSelect(left, show);
    }
    anchor.current = picture.id;
    props.onSelect([picture.id], picture);
  };

  const open = (picture: Picture, element: HTMLElement) => {
    const pictures = selected.has(picture.id) ? chosen() : [picture];
    if (!selected.has(picture.id)) pick(picture, { toggle: false, extend: false });
    setMenu({ at: { key: picture.id, element }, pictures });
  };

  const neighbour = (picture: Picture, key: string): Picture | null => {
    const index = props.pictures.findIndex((p) => p.id === picture.id);
    if (key === 'ArrowLeft') return props.pictures[index - 1] ?? null;
    if (key === 'ArrowRight') return props.pictures[index + 1] ?? null;
    if (key === 'Home') return props.pictures[0] ?? null;
    if (key === 'End') return props.pictures[props.pictures.length - 1] ?? null;
    const place = places.get(picture.id)!;
    const step = key === 'ArrowUp' ? -1 : 1;
    for (let r = place.row + step; r >= 0 && r < rows.length; r += step) {
      const row = rows[r];
      if (row.kind === 'pictures') return row.pictures[Math.min(place.column, row.pictures.length - 1)];
    }
    return null;
  };

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, picture: Picture) => {
    const key = event.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      const next = neighbour(picture, key);
      if (!next) return;
      if (event.shiftKey) props.onSelect(range(next), next);
      else pick(next, { toggle: false, extend: false });
      focus(next.id);
    } else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      remove(chosen());
    } else if (key === ' ') {
      event.preventDefault();
      props.actions.large(picture);
    } else if (key === 'a' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      props.onSelect(
        props.pictures.map((p) => p.id),
        null,
      );
    } else if (key === 'Escape' && props.selected.length > 1 && props.shown && places.has(props.shown)) {
      event.preventDefault();
      anchor.current = props.shown;
      props.onSelect([props.shown], null);
      focus(props.shown);
    }
  };

  const click = (event: MouseEvent<HTMLButtonElement>, picture: Picture) => {
    const toggle = event.ctrlKey || event.metaKey;
    pick(picture, { toggle, extend: event.shiftKey });
    if (!toggle && !event.shiftKey) props.onOpen();
  };

  return (
    <div className="hs-sidebar-column">
      <div className="is-library-head">
        <div className="is-library-top">
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            icon={<Icon name="add-line" size={14} />}
            onClick={props.onNew}
          >
            New picture
          </Button>
        </div>
        <nav className="is-library-nav">
          <button
            className={navRow(props.page === 'studio' && !props.favourites)}
            onClick={() => (props.onFavourites(false), props.onPage('studio'))}
          >
            <Icon name="gallery-line" size={16} />
            All pictures
          </button>
          <button
            className={navRow(props.page === 'studio' && props.favourites)}
            onClick={() => (props.onFavourites(true), props.onPage('studio'))}
          >
            <Icon name="heart-line" size={16} />
            Favourites
          </button>
          <button className={navRow(props.page === 'compare')} onClick={() => props.onPage('compare')}>
            <Icon name="layout-column-line" size={16} />
            Compare models
          </button>
        </nav>
        <TextInput
          value={props.words}
          placeholder="Search pictures"
          aria-label="Search pictures"
          spellCheck={false}
          onChange={(e) => props.onWords(e.target.value)}
        />
      </div>
      {rows.length === 0 ? (
        <div className="is-library-empty">
          {props.words ? 'No pictures match' : props.favourites ? 'No favourites yet' : 'No pictures yet'}
        </div>
      ) : (
        <VirtualList
          ref={list}
          className="is-library-list"
          count={rows.length}
          estimate={68}
          rowKey={(i) => {
            const row = rows[i];
            return row.kind === 'day' ? `day-${row.label}` : row.pictures[0].id;
          }}
          row={(i) => {
            const row = rows[i];
            if (row.kind === 'day') return <div className="is-day">{row.label}</div>;
            return (
              <div className="is-thumbs">
                {row.pictures.map((picture) => (
                  <button
                    key={picture.id}
                    className="is-thumb"
                    data-picture={picture.id}
                    data-on={selected.has(picture.id)}
                    aria-pressed={selected.has(picture.id)}
                    aria-label={pictureName(picture)}
                    tabIndex={picture.id === current ? 0 : -1}
                    onClick={(event) => click(event, picture)}
                    onKeyDown={(event) => keyDown(event, picture)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      open(picture, event.currentTarget);
                    }}
                  >
                    <img src={fileUrl(picture.path)} alt="" loading="lazy" decoding="async" />
                    {picture.favourite && <Icon name="heart-fill" size={12} className="is-thumb-mark" />}
                  </button>
                ))}
              </div>
            );
          }}
        />
      )}
      {menu && (
        <MenuSurface
          anchor={menu.at}
          dir="right"
          keyboard
          onDismiss={() => {
            setMenu(null);
            thumbOf(menu.at.key)?.focus();
          }}
        >
          <PictureMenu
            pictures={menu.pictures}
            actions={props.actions}
            close={() => setMenu(null)}
            onDetails={(picture) => setDetails({ picture, at: menu.at.element })}
            onRemove={remove}
          />
        </MenuSurface>
      )}
      {details && (
        <Details
          picture={details.picture}
          anchor={details.at}
          placement="right-start"
          onDismiss={() => setDetails(null)}
        />
      )}
    </div>
  );
}
