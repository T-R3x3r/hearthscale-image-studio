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
  await updateRun(run.id, { status: outcome, error, finished: Date.now() });
  await release(run);
  ended(run.id, outcome, error ?? undefined);
}

async function complete(run: Run, pictures: { path: string; seed: number | null }[]) {
  if (settled.has(run.id)) return;
  settled.add(run.id);
  await finishRun(run, pictures, Date.now());
  await release(run);
  ended(run.id, 'done');
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
  };
  if (!now.started && job.status === 'running' && !job.waiting) {
    now.started = Date.now();
    await updateRun(run.id, { started: now.started });
  }
  live.set(run.id, now);
  changed();
}

on('hearthscale/jobs/progress', ({ job }) => void apply(job));

/** Starts a run: keeps its record, then submits its job through the
 *  backend, which saves the pictures into the run's folder. */
export async function startRun(run: Run, input: Record<string, unknown>, label: string): Promise<void> {
  await addRun(run);
  runs.set(run.id, run);
  live.set(run.id, { status: 'queued', fraction: 0, phase: null, preview: null, waiting: null, started: null, job: null });
  changed();
  let job: Job;
  try {
    ({ job } = await tool<{ job: Job }>('make', { run: run.id, kind: run.kind, model: run.model, input }, label));
  } catch (error) {
    await fail(run, 'failed', reason(error));
    return;
  }
  byJob.set(job.id, run.id);
  await updateRun(run.id, { job: job.id });
  await apply(job);
  await apply((await call('hearthscale/jobs/get', { id: job.id })).job);
}

export async function cancelRun(run: string): Promise<void> {
  const job = live.get(run)?.job;
  if (job) await call('hearthscale/jobs/cancel', { id: job });
}

/** Picks up the runs that were still making when the view last closed:
 *  a job Hearthscale still holds is followed, and a run whose job it no
 *  longer knows keeps the pictures its folder holds. */
export async function recoverRuns(): Promise<void> {
  for (const run of await makingRuns()) {
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
        await complete(run, kept.map((name) => ({ path: `pictures/${run.id}/${name}`, seed: null })));
        continue;
      }
    } catch {
      // No folder: the job wrote nothing.
    }
    await fail(run, 'failed', 'Hearthscale stopped before the pictures were done.');
  }
}

/** A new id for a run, safe as a folder name. */
export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
