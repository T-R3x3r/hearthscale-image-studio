import type { AppContext, Backend } from '@hearthscale/app';

let ctx: AppContext;

/** Every picture of a run lives in the run's own folder of the data mount. */
const folderOf = (run: string) => `pictures/${run}`;

const backend: Backend = {
  activate(context) {
    ctx = context;
  },
  tools: {
    async make(input) {
      const { run, kind, model, input: request } = input as {
        run: string;
        kind: 'image' | 'upscale';
        model: string;
        input: Record<string, unknown>;
      };
      const job = await ctx.jobs!.submit({
        kind,
        model,
        input: request,
        save: { root: 'data', path: folderOf(run) },
      });
      return { job };
    },

    async hold(input) {
      const { paths } = input as { paths: string[] };
      const assets: string[] = [];
      for (const path of paths) assets.push(await ctx.assets.import({ root: 'data', path }, 'image/png'));
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
      await ctx.fs!.mkdir({ root: 'data', path: folderOf(run) });
      await ctx.fs!.export(asset, { root: 'data', path });
      await ctx.assets.release(asset);
      return { path };
    },

    async remove(input) {
      const { paths } = input as { paths: string[] };
      for (const path of paths) {
        await ctx.fs!.remove({ root: 'data', path });
        const folder = path.slice(0, path.lastIndexOf('/'));
        const left = await ctx.fs!.list({ root: 'data', path: folder });
        if (left.files.length === 0 && left.dirs.length === 0) await ctx.fs!.remove({ root: 'data', path: folder });
      }
      return { removed: paths.length };
    },
  },
};

export default backend;
