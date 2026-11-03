import type { AppContext, Backend, FolderFire } from '@hearthscale/app';

let ctx: AppContext;

/** Every picture of a run lives in the run's own folder of the data mount. */
const PICTURES = 'pictures';
const folderOf = (run: string) => `${PICTURES}/${run}`;

let tidying: Promise<string[]> = Promise.resolve([]);

/** Forgets the pictures whose files are gone from the data folder and tells
 *  the views which ones; checks run one after another. */
function tidy(): Promise<string[]> {
  tidying = tidying.catch(() => []).then(forgetMissing);
  return tidying;
}

async function forgetMissing(): Promise<string[]> {
  const rows = await ctx.db.query('SELECT id, path FROM pictures');
  if (rows.length === 0) return [];
  const runs = new Set((await ctx.fs.list({ root: 'data', path: PICTURES })).dirs);
  const files = new Map<string, Set<string>>();
  const gone: string[] = [];
  for (const row of rows) {
    const path = String(row.path);
    const cut = path.lastIndexOf('/');
    const folder = path.slice(0, cut);
    const run = folder.slice(PICTURES.length + 1);
    if (!runs.has(run)) {
      gone.push(String(row.id));
      continue;
    }
    let held = files.get(folder);
    if (!held) {
      held = new Set((await ctx.fs.list({ root: 'data', path: folder })).files);
      files.set(folder, held);
    }
    if (!held.has(path.slice(cut + 1))) gone.push(String(row.id));
  }
  if (gone.length === 0) return [];
  await ctx.db.batch(gone.map((id) => ({ sql: 'DELETE FROM pictures WHERE id = ?', params: [id] })));
  await ctx.events.emit({ name: 'gone', data: gone, durable: false });
  return gone;
}

const backend: Backend = {
  async activate(context) {
    ctx = context;
    await ctx.fs.mkdir({ root: 'data', path: PICTURES });
    ctx.triggers.on('pictures', (fire) => {
      const { change, many } = fire as FolderFire;
      if (change === 'removed' || many)
        tidy().catch((error) => ctx.log('warn', `The library was not checked: ${String(error)}`));
    });
    await ctx.triggers.watch('pictures', { root: 'data', path: PICTURES });
  },
  tools: {
    async tidy() {
      return { gone: await tidy() };
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
        const folder = path.slice(0, path.lastIndexOf('/'));
        if (!(await ctx.fs.stat({ root: 'data', path: folder }))) continue;
        const left = await ctx.fs.list({ root: 'data', path: folder });
        if (left.files.length === 0 && left.dirs.length === 0) await ctx.fs.remove({ root: 'data', path: folder });
      }
      return { removed: paths.length };
    },
  },
};

export default backend;
