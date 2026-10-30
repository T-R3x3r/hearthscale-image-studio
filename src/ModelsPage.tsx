import { useEffect, useState } from 'react';
import type { HubListing, HubRepository, InstallTarget, ModelCard, ModelServer } from '@hearthscale/app';
import {
  Button,
  Chip,
  Icon,
  Meter,
  Notice,
  PageTitle,
  SettingsSection,
  TextInput,
  useFloatingTips,
} from '@hearthscale/app-ui';
import { call, reason } from './bridge';
import { gigabytes, type Models } from './models';

export type Downloads = Map<string, { receivedBytes: number; totalBytes: number }>;

function Row(props: { title: string; sub?: string; children?: React.ReactNode; onOpen?: () => void; open?: boolean }) {
  return (
    <div className="is-model-row" data-open={props.open}>
      {props.onOpen ? (
        <button className="is-model-name" onClick={props.onOpen}>
          <Icon name={props.open ? 'arrow-down-s-line' : 'arrow-right-s-line'} size={14} />
          <span>{props.title}</span>
          {props.sub && <span className="is-model-sub">{props.sub}</span>}
        </button>
      ) : (
        <div className="is-model-name">
          <span>{props.title}</span>
          {props.sub && <span className="is-model-sub">{props.sub}</span>}
        </div>
      )}
      <div className="is-model-actions">{props.children}</div>
    </div>
  );
}

export function ModelsPage(props: {
  models: Models;
  downloads: Downloads;
  current: string | null;
  onUse: (card: string) => void;
  onInstalled: () => void;
}) {
  const [servers, setServers] = useState<ModelServer[]>([]);
  const [server, setServer] = useState<string | null>(null);
  const [words, setWords] = useState('');
  const [found, setFound] = useState<HubRepository[] | null>(null);
  const [open, setOpen] = useState<HubListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tips = useFloatingTips('top');

  useEffect(() => {
    void call('hearthscale/models/servers', {}).then(({ servers: list }) => {
      setServers(list);
      setServer(
        (list.find((s) => s.here && s.status === 'ready') ?? list.find((s) => s.status === 'ready'))?.id ?? null,
      );
    });
  }, []);

  const install = async (target: InstallTarget) => {
    setProblem(null);
    try {
      const { card } = await call('hearthscale/models/install', { target });
      if (card) props.onInstalled();
    } catch (error) {
      setProblem(reason(error));
    }
  };

  const search = async () => {
    if (!server) return;
    setBusy(true);
    setProblem(null);
    setOpen(null);
    try {
      const { repositories } = await call('hearthscale/models/discover', {
        server,
        task: 'image',
        search: words.trim() || undefined,
      });
      setFound(repositories);
    } catch (error) {
      setProblem(reason(error));
    } finally {
      setBusy(false);
    }
  };

  const look = async (repo: string) => {
    if (!server) return;
    if (open?.repo === repo) {
      setOpen(null);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { listing } = await call('hearthscale/models/repository', { server, repo });
      setOpen(listing);
    } catch (error) {
      setProblem(reason(error));
    } finally {
      setBusy(false);
    }
  };

  const progressOf = (card: ModelCard) => props.downloads.get(card.id) ?? card.progress;
  const downloading = props.models.downloading;
  const ready = props.models.image;

  return (
    <div className="is-page">
      <div className="is-page-body">
        <PageTitle>Get models</PageTitle>
        {problem && <Notice>{problem}</Notice>}

        {downloading.length > 0 && (
          <>
            <SettingsSection first>Downloading</SettingsSection>
            <div className="is-model-list">
              {downloading.map((card) => {
                const progress = progressOf(card);
                const share = progress && progress.totalBytes ? progress.receivedBytes / progress.totalBytes : 0;
                return (
                  <Row key={card.id} title={card.label} sub={gigabytes(card.sizeBytes)}>
                    <div className="is-model-meter">
                      <Meter value={share} label={`How much of ${card.label} has arrived`} />
                    </div>
                  </Row>
                );
              })}
            </div>
          </>
        )}

        <SettingsSection first={downloading.length === 0}>On this computer</SettingsSection>
        <div className="is-model-list">
          {ready.length === 0 && <div className="is-model-none">No image model yet</div>}
          {ready.map((card) => (
            <Row key={card.id} title={card.label} sub={gigabytes(card.sizeBytes)}>
              {card.id === props.current ? (
                <Chip tone="ok">In use</Chip>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => props.onUse(card.id)}>
                  Use
                </Button>
              )}
            </Row>
          ))}
          {props.models.upscale.map((card) => (
            <Row key={card.id} title={card.label} sub={gigabytes(card.sizeBytes)}>
              <Chip>For Bigger</Chip>
            </Row>
          ))}
        </div>

        {(props.models.absentImage.length > 0 || props.models.absentUpscale.length > 0) && (
          <>
            <SettingsSection>Suggested</SettingsSection>
            <div className="is-model-list">
              {props.models.absentImage.map((card) => (
                <Row key={card.id} title={card.label} sub={gigabytes(card.sizeBytes)}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icon name="download-2-line" size={14} />}
                    onClick={() => void install(card.id)}
                  >
                    Install
                  </Button>
                </Row>
              ))}
              {props.models.absentUpscale.map((card) => (
                <Row key={card.id} title={card.label} sub={gigabytes(card.sizeBytes)}>
                  <Chip>For Bigger</Chip>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icon name="download-2-line" size={14} />}
                    onClick={() => void install(card.id)}
                  >
                    Install
                  </Button>
                </Row>
              ))}
            </div>
          </>
        )}

        <SettingsSection>Hugging Face</SettingsSection>
        <div className="is-model-search">
          <TextInput
            value={words}
            placeholder="Search image models"
            aria-label="Search image models"
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search();
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !server}
            icon={<Icon name="search-line" size={14} />}
            onClick={() => void search()}
          >
            Search
          </Button>
        </div>
        {servers.length > 1 && (
          <div className="is-model-servers">
            {servers.map((s) => (
              <Chip key={s.id} selected={s.id === server} onClick={() => setServer(s.id)}>
                {s.name}
              </Chip>
            ))}
          </div>
        )}
        {found && (
          <div className="is-model-list">
            {found.length === 0 && <div className="is-model-none">No image models found</div>}
            {found.map((repo) => (
              <div key={repo.repo}>
                <Row
                  title={repo.repo}
                  sub={`${repo.downloads.toLocaleString()} downloads`}
                  open={open?.repo === repo.repo}
                  onOpen={() => void look(repo.repo)}
                >
                  {repo.gated && <Chip tone="warn">Needs a sign-in</Chip>}
                </Row>
                {open?.repo === repo.repo && (
                  <div className="is-model-files">
                    {open.candidates.length === 0 && (
                      <div className="is-model-none">No file here runs on this Server</div>
                    )}
                    {open.candidates.map((file) => {
                      const why =
                        file.reason ??
                        (!file.verifiable
                          ? 'The repository states no checksum for this file.'
                          : file.requires.some((need) => need.options.length === 0)
                            ? 'A file this model needs is not on Hugging Face.'
                            : undefined);
                      const tip = tips(file.path, why);
                      return (
                        <Row key={file.path} title={file.quantization || file.path} sub={gigabytes(file.sizeBytes)}>
                          <span {...tip.hover} className="is-tipwrap">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!!why || !server}
                              icon={<Icon name="download-2-line" size={14} />}
                              onClick={() =>
                                void install({
                                  server: server!,
                                  kind: 'image',
                                  repo: open.repo,
                                  file: file.path,
                                  companions: file.requires.map((need) => ({
                                    role: need.role,
                                    repo: need.options[0].repo,
                                    file: need.options[0].path,
                                  })),
                                })
                              }
                            >
                              Install
                            </Button>
                            {tip.tip}
                          </span>
                        </Row>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
