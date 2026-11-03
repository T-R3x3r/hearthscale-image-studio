import type { AppContext, Backend, FolderFire } from '@hearthscale/app';

let ctx: AppContext;

/** A job saves its pictures into its run's own folder; naming moves each
 *  one up into `pictures/` under a name a person can read. */
const PICTURES = 'pictures';
const folderOf = (run: string) => `${PICTURES}/${run}`;

let queue: Promise<unknown> = Promise.resolve();

/** Runs the changes of the library one after another, so a check of the
 *  library never sees a file moved before its row. */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => undefined).then(work);
  queue = next;
  return next;
}

/** Forgets the pictures whose files are gone from the data folder and tells
 *  the views which ones. */
async function forgetMissing(): Promise<string[]> {
  const rows = await ctx.db.query('SELECT id, path FROM pictures');
  const listed = new Map<string, Set<string>>();
  const gone: string[] = [];
  for (const row of rows) {
    const path = String(row.path);
    const cut = path.lastIndexOf('/');
    const folder = path.slice(0, cut);
    let held = listed.get(folder);
    if (!held) {
      const there = await ctx.fs.stat({ root: 'data', path: folder });
      held = new Set(there?.kind === 'folder' ? (await ctx.fs.list({ root: 'data', path: folder })).files : []);
      listed.set(folder, held);
    }
    if (!held.has(path.slice(cut + 1))) gone.push(String(row.id));
  }
  if (gone.length === 0) return [];
  await ctx.db.batch(gone.map((id) => ({ sql: 'DELETE FROM pictures WHERE id = ?', params: [id] })));
  await ctx.events.emit({ name: 'gone', data: gone, durable: false });
  return gone;
}

/** Moves the pictures of a run out of its folder to `pictures/<base>.png`,
 *  numbered when the run made more than one, with "(2)" and up where a
 *  file of that name exists. */
async function nameRun(run: string, base: string): Promise<number> {
  const rows = await ctx.db.query('SELECT id, path FROM pictures WHERE run = ? ORDER BY idx', [run]);
  const taken = new Set((await ctx.fs.list({ root: 'data', path: PICTURES })).files.map((name) => name.toLowerCase()));
  let moved = 0;
  for (const [index, row] of rows.entries()) {
    const from = String(row.path);
    if (!from.startsWith(`${folderOf(run)}/`)) continue;
    const stem = rows.length > 1 ? `${base} ${index + 1}` : base;
    let name = `${stem}.png`;
    for (let copy = 2; taken.has(name.toLowerCase()); copy++) name = `${stem} (${copy}).png`;
    taken.add(name.toLowerCase());
    const to = `${PICTURES}/${name}`;
    await ctx.fs.rename({ root: 'data', path: from }, to);
    await ctx.db.exec('UPDATE pictures SET path = ? WHERE id = ?', [to, row.id]);
    moved++;
  }
  await removeIfEmpty(folderOf(run));
  return moved;
}

async function removeIfEmpty(folder: string) {
  if (folder === PICTURES || !(await ctx.fs.stat({ root: 'data', path: folder }))) return;
  const left = await ctx.fs.list({ root: 'data', path: folder });
  if (left.files.length === 0 && left.dirs.length === 0) await ctx.fs.remove({ root: 'data', path: folder });
}

const backend: Backend = {
  async activate(context) {
    ctx = context;
    await ctx.fs.mkdir({ root: 'data', path: PICTURES });
    ctx.triggers.on('pictures', (fire) => {
      const { change, many } = fire as FolderFire;
      if (change === 'removed' || many)
        inTurn(forgetMissing).catch((error) => ctx.log('warn', `The library was not checked: ${String(error)}`));
    });
    await ctx.triggers.watch('pictures', { root: 'data', path: PICTURES });
  },
  tools: {
    async tidy() {
      return { gone: await inTurn(forgetMissing) };
    },

    async name(input) {
      const { run, base } = input as { run: string; base: string };
      return { named: await inTurn(() => nameRun(run, base)) };
    },

    async make(input) {
      const {
        run,
        kind,
        model,
        input: request,
      } = input as {
        run: string;
        kind: 'image' | 'upscale';
        model: string;
        input: Record<string, unknown>;
      };
      const job = await ctx.jobs.submit({
        kind,
        model,
        input: request,
        save: { root: 'data', path: folderOf(run) },
      });
      await ctx.db.exec('UPDATE runs SET job = ? WHERE id = ?', [job.id, run]);
      return { job };
    },

    async hold(input) {
      const { paths } = input as { paths: string[] };
      const assets: string[] = [];
      try {
        for (const path of paths) assets.push(await ctx.assets.import({ root: 'data', path }, 'image/png'));
      } catch (error) {
        for (const asset of assets) await ctx.assets.release(asset);
        throw error;
      }
      return { assets };
    },

    async release(input) {
      const { assets } = input as { assets: string[] };
      for (const asset of assets) await ctx.assets.release(asset);
      return { released: assets.length };
    },

    async keep(input) {
      const { asset, run } = input as { asset: string; run: string };
      const path = `${folderOf(run)}/image.png`;
      try {
        await ctx.fs.mkdir({ root: 'data', path: folderOf(run) });
        await ctx.fs.export(asset, { root: 'data', path });
      } finally {
        await ctx.assets.release(asset);
      }
      return { path };
    },

    async remove(input) {
      const { paths } = input as { paths: string[] };
      for (const path of paths) {
        await ctx.fs.remove({ root: 'data', path });
        await removeIfEmpty(path.slice(0, path.lastIndexOf('/')));
      }
      return { removed: paths.length };
    },
  },
};

export default backend;
