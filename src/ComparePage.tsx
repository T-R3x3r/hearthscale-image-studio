import type { ModelCard } from '@hearthscale/app';
import { Button, Chip, Icon, Meter, Notice, PageTitle, StatusWord, useFloatingTips } from '@hearthscale/app-ui';
import { assetUrl, fileUrl } from './bridge';
import type { Picture, Run } from './records';
import type { Live } from './runs';

/** The most models one compare runs. */
const COMPARE_MOST = 4;

export interface Column {
  run: Run;
  picture: Picture | null;
  live: Live | null;
}

function seconds(run: Run): string | null {
  if (run.status !== 'done' || !run.started || !run.finished) return null;
  return `${((run.finished - run.started) / 1000).toFixed(1)} s`;
}

export function ComparePage(props: {
  models: ModelCard[];
  picked: string[];
  onPick: (ids: string[]) => void;
  current: string | null;
  columns: Column[];
  onShow: (picture: Picture) => void;
  onUse: (card: string) => void;
  onCancel: (run: string) => void;
}) {
  const tips = useFloatingTips('top');
  const flip = (id: string) => {
    if (props.picked.includes(id)) props.onPick(props.picked.filter((p) => p !== id));
    else if (props.picked.length < COMPARE_MOST) props.onPick([...props.picked, id]);
  };
  return (
    <div className="hs-scroll hs-settings-scroll is-page">
      <main className="is-compare-page">
        <PageTitle>Compare models</PageTitle>
        {props.models.length < 2 ? (
          <Notice>Compare needs two image models or more on this computer.</Notice>
        ) : (
          <div className="is-compare-pick">
            {props.models.map((card) => (
              <Chip key={card.id} selected={props.picked.includes(card.id)} onClick={() => flip(card.id)}>
                {card.label}
              </Chip>
            ))}
          </div>
        )}
        {props.columns.length > 0 && (
          <>
            <div className="is-compare-prompt">{props.columns[0].run.prompt}</div>
            <div
              className="is-compare-grid"
              style={{ gridTemplateColumns: `repeat(${props.columns.length}, minmax(0, var(--compare-column)))` }}
            >
              {props.columns.map(({ run, picture, live }) => (
                <div key={run.id} className="is-compare-column">
                  <div className="is-compare-head">
                    <span className="is-compare-name">{run.label}</span>
                    <span className="is-compare-time">{seconds(run) ?? ''}</span>
                  </div>
                  <div className="is-compare-cell">
                    {picture ? (
                      <button className="is-compare-picture" onClick={() => props.onShow(picture)}>
                        <img src={fileUrl(picture.path)} alt={run.prompt} />
                      </button>
                    ) : live ? (
                      <div className="is-compare-making">
                        {live.preview ? (
                          <img src={assetUrl(live.preview)} alt="The picture so far" />
                        ) : (
                          <Icon name="image-ai-line" size={28} className="is-making-mark" />
                        )}
                        <Meter value={live.fraction} label={`How far ${run.label} is`} />
                        <Button variant="ghost" size="sm" onClick={() => props.onCancel(run.id)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      (() => {
                        const why = tips(run.id, run.error ?? undefined);
                        return (
                          <span {...why.hover} className="is-tipwrap">
                            {run.status === 'cancelled' ? (
                              <StatusWord tone="dim">Cancelled</StatusWord>
                            ) : (
                              <StatusWord tone="bad">Failed</StatusWord>
                            )}
                            {why.tip}
                          </span>
                        );
                      })()
                    )}
                  </div>
                  {picture &&
                    (run.model === props.current ? (
                      <StatusWord tone="ok">In use</StatusWord>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Icon name="check-line" size={14} />}
                        onClick={() => props.onUse(run.model)}
                      >
                        Use this model
                      </Button>
                    ))}
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
