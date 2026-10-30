import { build, context } from 'esbuild';

const options = {
  entryPoints: ['src/main.tsx'],
  outfile: 'views/studio.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  loader: { '.css': 'text' },
  external: ['@modelcontextprotocol/ext-apps'],
  define: { 'process.env.NODE_ENV': '"production"' },
};

if (process.argv.includes('--watch')) {
  await (await context(options)).watch();
} else {
  await build(options);
}
