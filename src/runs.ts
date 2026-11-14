import { useSyncExternalStore } from 'react';
import type { Job } from '@hearthscale/app';
import { call, dataPath, on, reason, tool } from './bridge';
import { addRun, finishRun, makingRuns, updateRun, type Run } from './records';

/** Where a run stands while its job runs. */
export interface Live {
  status: Job['status'];
  fraction: number;
  phase: string | null;
  preview: string | null;
  waiting: string | null;
  started: number | null;
  job: string | null;
  /** The step a run of several jobs is on, from 0. */
  step: number | null;
}

type Ended = (run: string, outcome: 'done' | 'failed' | 'cancelled', error?: string) => void;

const live = new Map<string, Live>();
const runs = new Map<string, Run>();
const byJob = new Map<string, string>();
const settled = new Set<string>();
const watchers = new Set<() => void>();
const enders = new Set<Ended>();
let version = 0;

function changed() {
  version++;
  for (const fn of watchers) fn();
}

function ended(run: string, outcome: 'done' | 'failed' | 'cancelled', error?: string) {
  live.delete(run);
  changed();
  for (const fn of enders) fn(run, outcome, error);
}

/** The runs still running, by run id; it changes as their jobs move. */
export function useLive(): Map<string, Live> {
  useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    () => version,
  );
  return live;
}

/** Calls `fn` when a run ends. */
export function onEnded(fn: Ended): () => void {
  enders.add(fn);
  return () => enders.delete(fn);
}

async function release(run: Run) {
  if (run.inputs.length === 0) return;
  await tool('release', { assets: run.inputs });
}

async function fail(run: Run, outcome: 'failed' | 'cancelled', error: string | null) {
  if (settled.has(run.id)) return;
  settled.add(run.id);
  try {
    await updateRun(run.id, { status: outcome, error, finished: Date.now() });
    await release(run);
  } finally {
    ended(run.id, outcome, error ?? undefined);
  }
}

async function complete(run: Run, pictures: { path: string; seed: number | null }[]) {
  if (settled.has(run.id)) return;
  settled.add(run.id);
  try {
    await finishRun(run, pictures, Date.now());
    await release(run);
  } finally {
    ended(run.id, 'done');
  }
}

async function apply(job: Job) {
  const id = byJob.get(job.id);
  const run = id ? runs.get(id) : undefined;
  if (!run || settled.has(run.id)) return;
  if (job.status === 'completed') {
    const seeds = (job.data?.seeds as number[] | undefined) ?? [];
    const pictures = (job.outputs ?? [])
      .filter((output) => output.path)
      .map((output, index) => ({ path: output.path!, seed: seeds[index] ?? null }));
    await complete(run, pictures);
    return;
  }
  if (job.status === 'failed' || job.status === 'cancelled') {
    await fail(run, job.status, job.error ?? null);
    return;
  }
  const before = live.get(run.id);
  const now: Live = {
    status: job.status,
    fraction: job.progress?.fraction ?? 0,
    phase: job.progress?.phase ?? null,
    preview: job.progress?.preview ?? null,
    waiting: job.waiting ?? null,
    started: before?.started ?? null,
    job: job.id,
    step: null,
  };
  const started = await starting(run, now);
  if (settled.has(run.id)) return;
  live.set(run.id, started);
  changed();
}

/** What follows each job a run of several jobs submits, by the job's id. */
const steps = new Map<string, (job: Job) => void>();

on('hearthscale/jobs/progress', ({ job }) => {
  steps.get(job.id)?.(job);
  void apply(job);
});

/** The end of a step whose job was cancelled. */
class Cancelled extends Error {}

/** Marks the run as started once its first job runs. */
async function starting(run: Run, now: Live): Promise<Live> {
  if (now.started || now.status !== 'running' || now.waiting) return now;
  const started = { ...now, started: Date.now() };
  await updateRun(run.id, { started: started.started });
  return started;
}

/** Starts a run: keeps its record, then submits its job through the
 *  backend, which saves the pictures into the run's folder. */
export async function startRun(run: Run, input: Record<string, unknown>, label: string): Promise<void> {
  await addRun(run);
  runs.set(run.id, run);
  live.set(run.id, {
    status: 'queued',
    fraction: 0,
    phase: null,
    preview: null,
    waiting: null,
    started: null,
    job: null,
    step: null,
  });
  changed();
  let job: Job;
  try {
    ({ job } = await tool<{ job: Job }>('make', { run: run.id, kind: run.kind, model: run.model, input }, label));
  } catch (error) {
    await fail(run, 'failed', reason(error));
    return;
  }
  byJob.set(job.id, run.id);
  if (cancelling.delete(run.id)) await call('hearthscale/jobs/cancel', { id: job.id });
  await apply(job);
  await apply((await call('hearthscale/jobs/get', { id: job.id })).job);
}

/** Runs the person cancelled: a run whose job had no id yet cancels it once
 *  it has one, and a run of several jobs submits no further job. */
const cancelling = new Set<string>();

export async function cancelRun(run: string): Promise<void> {
  cancelling.add(run);
  const job = live.get(run)?.job;
  if (!job) return;
  try {
    await call('hearthscale/jobs/cancel', { id: job });
  } catch {
    // The job had ended: a run of several jobs stops before its next step.
  }
}

/** What a run of several jobs does with each step. */
interface Steps {
  /** Runs one image job of the view and answers its record once it
   *  completed. It throws when the job failed or was cancelled. */
  job(index: number, model: string, input: Record<string, unknown>): Promise<Job>;
  /** Shows a picture as the run's preview until its next job sends one. */
  preview(asset: string): void;
  /** Counts assets as the run's, so they are released when it ends. */
  hold(...assets: string[]): Promise<void>;
  /** Hands an asset of the run to another owner, which releases it. */
  handOver(asset: string): Promise<void>;
}

/** The store key under which a run of several jobs keeps the time it last
 *  moved, so another view can tell a run in progress from one left behind. */
const drivenKey = (run: string) => `driven:${run}`;

/** How long after its last move a run of several jobs counts as driven. */
const DRIVEN_MS = 60_000;

async function moved(run: Run) {
  await call('hearthscale/store/set', { key: drivenKey(run.id), value: Date.now() });
}

async function stepJob(run: Run, index: number, model: string, input: Record<string, unknown>): Promise<Job> {
  if (cancelling.has(run.id)) throw new Cancelled();
  const { job } = await call('hearthscale/jobs/submit', { kind: 'image', model, input });
  await updateRun(run.id, { job: job.id });
  await moved(run);
  if (cancelling.has(run.id)) await call('hearthscale/jobs/cancel', { id: job.id });
  return new Promise<Job>((resolve, reject) => {
    const follow = (now: Job) => {
      if (!steps.has(now.id)) return;
      if (now.status === 'completed' || now.status === 'failed' || now.status === 'cancelled') {
        steps.delete(now.id);
        if (now.status === 'completed') resolve(now);
        else if (now.status === 'failed') reject(new Error(now.error ?? 'The picture was not made.'));
        else reject(new Cancelled());
        return;
      }
      const before = live.get(run.id);
      if (!before) return;
      void starting(run, {
        ...before,
        status: now.status,
        fraction: now.progress?.fraction ?? 0,
        phase: now.progress?.phase ?? null,
        preview: now.progress?.preview ?? before.preview,
        waiting: now.waiting ?? null,
        job: now.id,
        step: index,
      }).then((next) => {
        if (!settled.has(run.id) && steps.has(now.id)) {
          live.set(run.id, next);
          changed();
        }
      });
    };
    steps.set(job.id, follow);
    follow(job);
    void call('hearthscale/jobs/get', { id: job.id }).then(({ job: now }) => follow(now), reject);
  });
}

/** Starts a run of several image jobs the view submits one after another.
 *  `work` runs them and answers the path of the run's picture in the data
 *  folder; the run fails with its error, or ends cancelled. */
export async function runSteps(run: Run, work: (steps: Steps) => Promise<string>): Promise<void> {
  runs.set(run.id, run);
  live.set(run.id, {
    status: 'queued',
    fraction: 0,
    phase: null,
    preview: null,
    waiting: null,
    started: null,
    job: null,
    step: 0,
  });
  changed();
  const own: Steps = {
    job: (index, model, input) => stepJob(run, index, model, input),
    preview: (asset) => {
      const now = live.get(run.id);
      if (!now || settled.has(run.id)) return;
      live.set(run.id, { ...now, preview: asset, fraction: 0, status: 'queued' });
      changed();
    },
    hold: async (...assets) => {
      run.inputs.push(...assets);
      await updateRun(run.id, { inputs: run.inputs });
      await moved(run);
    },
    handOver: async (asset) => {
      if (cancelling.has(run.id)) throw new Cancelled();
      run.inputs = run.inputs.filter((held) => held !== asset);
      await updateRun(run.id, { inputs: run.inputs });
    },
  };
  try {
    await addRun(run);
    await moved(run);
    const path = await work(own);
    await complete(run, [{ path, seed: null }]);
  } catch (error) {
    if (error instanceof Cancelled) await fail(run, 'cancelled', null);
    else await fail(run, 'failed', reason(error));
  } finally {
    cancelling.delete(run.id);
    await call('hearthscale/store/delete', { key: drivenKey(run.id) });
  }
}

/** How long a run's job may take to get its id before the run counts as lost. */
const SUBMITTING_MS = 120_000;

/** Picks up the runs that were still making when the view last closed:
 *  a job Hearthscale still holds is followed, and a run whose job it no
 *  longer knows keeps the pictures its folder holds. A run still waiting
 *  for its job's id is left to the view that submits it. */
export async function recoverRuns(): Promise<void> {
  for (const run of await makingRuns()) {
    if (runs.has(run.id) || (!run.job && Date.now() - run.made < SUBMITTING_MS)) continue;
    if (run.action === 'mark') {
      await recoverSteps(run);
      continue;
    }
    runs.set(run.id, run);
    if (run.job) {
      byJob.set(run.job, run.id);
      try {
        await apply((await call('hearthscale/jobs/get', { id: run.job })).job);
        continue;
      } catch {
        // The job ended before Hearthscale last started; its folder tells.
      }
    }
    try {
      const { files } = await call('hearthscale/fs/list', { path: dataPath(`pictures/${run.id}`) });
      const kept = files.filter((name) => name.endsWith('.png')).sort();
      if (kept.length > 0) {
        await complete(
          run,
          kept.map((name) => ({ path: `pictures/${run.id}/${name}`, seed: null })),
        );
        continue;
      }
    } catch {
      // No folder: the job wrote nothing.
    }
    await fail(run, 'failed', 'Hearthscale stopped before the pictures were done. Make them again.');
  }
}

/** A run of several jobs goes on only in the view that drives it. Another
 *  view leaves it alone while its job runs, and between two jobs while it
 *  moved less than DRIVEN_MS ago; a run no view drives fails. */
async function recoverSteps(run: Run) {
  if (run.job) {
    try {
      const { job } = await call('hearthscale/jobs/get', { id: run.job });
      if (job.status === 'queued' || job.status === 'running') return;
    } catch {
      // Hearthscale no longer knows the job: its last move tells.
    }
  }
  const { value } = await call('hearthscale/store/get', { key: drivenKey(run.id) });
  if (typeof value === 'number' && Date.now() - value < DRIVEN_MS) return;
  runs.set(run.id, run);
  await fail(run, 'failed', 'The window closed before the change was done. Change the picture again.');
  await call('hearthscale/store/delete', { key: drivenKey(run.id) });
}

/** A new id for a run, safe as a folder name. */
export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
