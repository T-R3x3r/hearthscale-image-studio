import { call } from './bridge';

/** What the person asked for: one job and the pictures it made. */
export interface Run {
  id: string;
  made: number;
  kind: 'image' | 'upscale' | 'opened';
  action: Action;
  model: string;
  label: string;
  prompt: string;
  negative: string;
  style: string | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  guidance: number | null;
  seed: number | null;
  strength: number | null;
  count: number;
  source: string | null;
  compare: string | null;
  job: string | null;
  inputs: string[];
  status: 'making' | 'done' | 'failed' | 'cancelled';
  error: string | null;
  started: number | null;
  finished: number | null;
}

export type Action = 'make' | 'change' | 'edit' | 'fill' | 'erase' | 'extend' | 'enlarge' | 'open';

/** One picture of a run, as a file of the app's data folder. */
export interface Picture {
  id: string;
  run: string;
  idx: number;
  path: string;
  seed: number | null;
  favourite: boolean;
  made: number;
  prompt: string;
  label: string;
  action: Action;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  made INTEGER NOT NULL,
  kind TEXT NOT NULL,
  action TEXT NOT NULL,
  model TEXT NOT NULL,
  label TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  negative TEXT NOT NULL DEFAULT '',
  style TEXT,
  width INTEGER,
  height INTEGER,
  steps INTEGER,
  guidance REAL,
  seed INTEGER,
  strength REAL,
  count INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  compare TEXT,
  job TEXT,
  inputs TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  error TEXT,
  started INTEGER,
  finished INTEGER
);
CREATE TABLE IF NOT EXISTS pictures (
  id TEXT PRIMARY KEY,
  run TEXT NOT NULL REFERENCES runs (id),
  idx INTEGER NOT NULL,
  path TEXT NOT NULL,
  seed INTEGER,
  favourite INTEGER NOT NULL DEFAULT 0,
  made INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pictures_made ON pictures (made);
CREATE INDEX IF NOT EXISTS pictures_run ON pictures (run);
CREATE INDEX IF NOT EXISTS runs_compare ON runs (compare);
`;

export async function openLibrary(): Promise<void> {
  await call('hearthscale/db/exec', { sql: SCHEMA });
}

type Row = Record<string, unknown>;

function runOf(row: Row): Run {
  return { ...(row as unknown as Run), inputs: JSON.parse(String(row.inputs ?? '[]')) as string[] };
}

function pictureOf(row: Row): Picture {
  return { ...(row as unknown as Picture), favourite: row.favourite === 1 || row.favourite === true };
}

const PICTURE_COLUMNS = `p.id, p.run, p.idx, p.path, p.seed, p.favourite, p.made, r.prompt, r.label, r.action`;

export async function addRun(run: Run): Promise<void> {
  await call('hearthscale/db/exec', {
    sql: `INSERT INTO runs (id, made, kind, action, model, label, prompt, negative, style, width, height, steps,
      guidance, seed, strength, count, source, compare, job, inputs, status, error, started, finished)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      run.id,
      run.made,
      run.kind,
      run.action,
      run.model,
      run.label,
      run.prompt,
      run.negative,
      run.style,
      run.width,
      run.height,
      run.steps,
      run.guidance,
      run.seed,
      run.strength,
      run.count,
      run.source,
      run.compare,
      run.job,
      JSON.stringify(run.inputs),
      run.status,
      run.error,
      run.started,
      run.finished,
    ],
  });
}

export async function updateRun(
  id: string,
  fields: Partial<Pick<Run, 'status' | 'error' | 'started' | 'finished'>>,
): Promise<void> {
  const names = Object.keys(fields) as (keyof typeof fields)[];
  if (names.length === 0) return;
  await call('hearthscale/db/exec', {
    sql: `UPDATE runs SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ?`,
    params: [...names.map((name) => fields[name] ?? null), id],
  });
}

/** Ends a run with its pictures, in one transaction. */
export async function finishRun(
  run: Run,
  pictures: { path: string; seed: number | null }[],
  finished: number,
): Promise<void> {
  await call('hearthscale/db/batch', {
    statements: [
      ...pictures.map((picture, idx) => ({
        sql: 'INSERT OR IGNORE INTO pictures (id, run, idx, path, seed, favourite, made) VALUES (?, ?, ?, ?, ?, 0, ?)',
        params: [`${run.id}-${idx + 1}`, run.id, idx, picture.path, picture.seed, finished],
      })),
      { sql: "UPDATE runs SET status = 'done', finished = ? WHERE id = ?", params: [finished, run.id] },
    ],
  });
}

export async function getRun(id: string): Promise<Run | null> {
  const { rows } = await call('hearthscale/db/query', { sql: 'SELECT * FROM runs WHERE id = ?', params: [id] });
  return rows[0] ? runOf(rows[0]) : null;
}

export async function makingRuns(): Promise<Run[]> {
  const { rows } = await call('hearthscale/db/query', { sql: "SELECT * FROM runs WHERE status = 'making'" });
  return rows.map(runOf);
}

export async function picturesOfRun(run: string): Promise<Picture[]> {
  const { rows } = await call('hearthscale/db/query', {
    sql: `SELECT ${PICTURE_COLUMNS} FROM pictures p JOIN runs r ON r.id = p.run WHERE p.run = ? ORDER BY p.idx`,
    params: [run],
  });
  return rows.map(pictureOf);
}

export async function getPicture(id: string): Promise<Picture | null> {
  const { rows } = await call('hearthscale/db/query', {
    sql: `SELECT ${PICTURE_COLUMNS} FROM pictures p JOIN runs r ON r.id = p.run WHERE p.id = ?`,
    params: [id],
  });
  return rows[0] ? pictureOf(rows[0]) : null;
}

/** The pictures of the library, newest first, matching the words and the filter. */
export async function listPictures(filter: { words: string; favourites: boolean }): Promise<Picture[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.words.trim()) {
    where.push("r.prompt LIKE ? ESCAPE '\\'");
    params.push(`%${filter.words.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (filter.favourites) where.push('p.favourite = 1');
  const { rows } = await call('hearthscale/db/query', {
    sql: `SELECT ${PICTURE_COLUMNS} FROM pictures p JOIN runs r ON r.id = p.run
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.made DESC, p.idx`,
    params,
  });
  return rows.map(pictureOf);
}

export async function runsOfCompare(compare: string): Promise<Run[]> {
  const { rows } = await call('hearthscale/db/query', {
    sql: 'SELECT * FROM runs WHERE compare = ? ORDER BY made',
    params: [compare],
  });
  return rows.map(runOf);
}

export async function latestCompare(): Promise<string | null> {
  const { rows } = await call('hearthscale/db/query', {
    sql: 'SELECT compare FROM runs WHERE compare IS NOT NULL ORDER BY made DESC LIMIT 1',
  });
  return rows[0] ? String(rows[0].compare) : null;
}

export async function setFavourite(id: string, favourite: boolean): Promise<void> {
  await call('hearthscale/db/exec', {
    sql: 'UPDATE pictures SET favourite = ? WHERE id = ?',
    params: [favourite ? 1 : 0, id],
  });
}

export async function forgetPictures(ids: string[]): Promise<void> {
  await call('hearthscale/db/batch', {
    statements: ids.map((id) => ({ sql: 'DELETE FROM pictures WHERE id = ?', params: [id] })),
  });
}
