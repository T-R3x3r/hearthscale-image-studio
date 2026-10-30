import { useEffect, useState } from 'react';
import type { HubCandidate, HubListing, HubRepository, InstallTarget, ModelCard, ModelServer } from '@hearthscale/app';
import {
  Button,
  Chip,
  Icon,
  LinkRow,
  ListRow,
  Meter,
  Notice,
  SegmentedControl,
  SettingsCard,
  SettingsSection,
  StatusWord,
  TextInput,
  useFloatingTips,
} from '@hearthscale/app-ui';
import { call, reason } from './bridge';
import { gigabytes, type Models } from './models';

export type Downloads = Map<string, { receivedBytes: number; totalBytes: number }>;

/** Why a file of a repository cannot be installed, in plain words. */
function whyNot(file: HubCandidate): string | undefined {
  if (file.reason) return file.reason;
  if (!file.verifiable) return 'The repository states no checksum for this file.';
  if (file.requires.some((need) => need.options.length === 0)) return 'A file this model needs is not on Hugging Face.';
  return undefined;
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

  const size = (bytes: number | undefined) => <span className="is-size">{gigabytes(bytes)}</span>;
  const installButton = (onClick: () => void, disabled = false) => (
    <Button
      variant="secondary"
      size="sm"
      disabled={disabled}
      icon={<Icon name="download-2-line" size={14} />}
      onClick={onClick}
    >
      Install
    </Button>
  );
  const progressOf = (card: ModelCard) => props.downloads.get(card.id) ?? card.progress;
  const absent = [...props.models.absentImage, ...props.models.absentUpscale];

  return (
    <div className="hs-scroll hs-settings-scroll is-page">
      <main className="hs-settings-content">
        {problem && <Notice>{problem}</Notice>}

        {props.models.downloading.length > 0 && (
          <>
            <SettingsSection first>Downloading</SettingsSection>
            <SettingsCard>
              {props.models.downloading.map((card) => {
                const progress = progressOf(card);
                const share = progress && progress.totalBytes ? progress.receivedBytes / progress.totalBytes : 0;
                return (
                  <ListRow
                    key={card.id}
                    title={card.label}
                    actions={
                      <>
                        <span className="is-model-meter">
                          <Meter value={share} label={`Download of ${card.label}`} />
                        </span>
                        <span className="is-size">{Math.round(share * 100)}%</span>
                      </>
                    }
                  />
                );
              })}
            </SettingsCard>
          </>
        )}

        <SettingsSection first={props.models.downloading.length === 0}>On this computer</SettingsSection>
        <SettingsCard>
          {props.models.image.length === 0 && <ListRow title="No image model yet" />}
          {props.models.image.map((card) => (
            <ListRow
              key={card.id}
              title={card.label}
              actions={
                <>
                  {size(card.sizeBytes)}
                  {card.id === props.current ? (
                    <StatusWord tone="ok">In use</StatusWord>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => props.onUse(card.id)}>
                      Use
                    </Button>
                  )}
                </>
              }
            />
          ))}
          {props.models.upscale.map((card) => (
            <ListRow
              key={card.id}
              title={card.label}
              actions={
                <>
                  {size(card.sizeBytes)}
                  <Chip>Used by Enlarge</Chip>
                </>
              }
            />
          ))}
        </SettingsCard>

        {absent.length > 0 && (
          <>
            <SettingsSection>Suggested</SettingsSection>
            <SettingsCard>
              {absent.map((card) => (
                <ListRow
                  key={card.id}
                  title={card.label}
                  actions={
                    <>
                      {size(card.sizeBytes)}
                      {card.kind === 'upscale' && <Chip>Used by Enlarge</Chip>}
                      {installButton(() => void install(card.id))}
                    </>
                  }
                />
              ))}
            </SettingsCard>
          </>
        )}

        <SettingsSection
          action={
            open ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Icon name="arrow-left-line" size={14} />}
                onClick={() => setOpen(null)}
              >
                Back to the results
              </Button>
            ) : undefined
          }
        >
          {open ? open.repo : 'Hugging Face'}
        </SettingsSection>
        {!open && (
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
        )}
        {!open && servers.length > 1 && (
          <SegmentedControl
            label="The Server that installs the model"
            value={server ?? ''}
            options={servers.map((s) => ({ value: s.id, label: s.name }))}
            onChange={setServer}
          />
        )}
        {!open && found && (
          <SettingsCard>
            {found.length === 0 && <ListRow title="No image models found" />}
            {found.map((repo) => (
              <LinkRow
                key={repo.repo}
                title={repo.repo}
                value={
                  repo.gated ? (
                    <StatusWord tone="warn">Needs a sign-in</StatusWord>
                  ) : (
                    <span className="is-size">{repo.downloads.toLocaleString()} downloads</span>
                  )
                }
                onOpen={() => void look(repo.repo)}
              />
            ))}
          </SettingsCard>
        )}
        {open && (
          <SettingsCard>
            {open.candidates.length === 0 && <ListRow title="No file here runs on this Server" />}
            {open.candidates.map((file) => {
              const why = whyNot(file);
              const tip = tips(file.path, why);
              return (
                <ListRow
                  key={file.path}
                  title={file.quantization || file.path}
                  actions={
                    <>
                      {size(file.sizeBytes)}
                      <span {...tip.hover} className="is-tipwrap">
                        {installButton(
                          () =>
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
                            }),
                          !!why || !server,
                        )}
                        {tip.tip}
                      </span>
                    </>
                  }
                />
              );
            })}
          </SettingsCard>
        )}
      </main>
    </div>
  );
}
