import { useMemo } from 'react';
import { Button, Icon, TextInput, VirtualList } from '@hearthscale/app-ui';
import { fileUrl } from './bridge';
import type { Picture } from './records';

const PER_ROW = 3;

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

export function Library(props: {
  pictures: Picture[];
  locale: string;
  shown: string | null;
  words: string;
  favourites: boolean;
  page: 'studio' | 'compare' | 'models';
  onWords: (words: string) => void;
  onFavourites: (on: boolean) => void;
  onShow: (picture: Picture) => void;
  onNew: () => void;
  onPage: (page: 'studio' | 'compare' | 'models') => void;
}) {
  const rows = useMemo(() => rowsOf(props.pictures, props.locale), [props.pictures, props.locale]);
  return (
    <div className="is-library">
      <div className="is-library-head">
        <Button variant="secondary" size="sm" fullWidth icon={<Icon name="add-line" size={14} />} onClick={props.onNew}>
          New picture
        </Button>
        <nav className="is-library-nav">
          <button
            className="is-nav-row"
            data-on={props.page === 'studio' && !props.favourites}
            onClick={() => (props.onFavourites(false), props.onPage('studio'))}
          >
            <Icon name="gallery-line" size={16} />
            All pictures
          </button>
          <button
            className="is-nav-row"
            data-on={props.page === 'studio' && props.favourites}
            onClick={() => (props.onFavourites(true), props.onPage('studio'))}
          >
            <Icon name="heart-line" size={16} />
            Favourites
          </button>
          <button className="is-nav-row" data-on={props.page === 'compare'} onClick={() => props.onPage('compare')}>
            <Icon name="layout-column-line" size={16} />
            Compare models
          </button>
          <button className="is-nav-row" data-on={props.page === 'models'} onClick={() => props.onPage('models')}>
            <Icon name="download-cloud-2-line" size={16} />
            Get models
          </button>
        </nav>
        <TextInput
          value={props.words}
          placeholder="Search"
          aria-label="Search pictures"
          onChange={(e) => props.onWords(e.target.value)}
        />
      </div>
      {rows.length === 0 ? (
        <div className="is-library-empty">
          {props.words || props.favourites ? 'No pictures match' : 'No pictures yet'}
        </div>
      ) : (
        <VirtualList
          className="is-library-list"
          count={rows.length}
          estimate={96}
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
                    data-on={picture.id === props.shown}
                    title={picture.prompt}
                    onClick={() => props.onShow(picture)}
                  >
                    <img src={fileUrl(picture.path)} alt={picture.prompt} loading="lazy" decoding="async" />
                    {picture.favourite && <Icon name="heart-fill" size={12} className="is-thumb-mark" />}
                  </button>
                ))}
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
