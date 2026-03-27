import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const outdir = path.resolve(process.cwd(), 'public/assets');
const buildVersion = createBuildVersion();

await build({
  entryPoints: [path.resolve(process.cwd(), 'src/frontend/app.js')],
  bundle: true,
  splitting: false,
  format: 'esm',
  sourcemap: true,
  target: ['es2022'],
  outdir,
  loader: {
    '.css': 'css',
  },
  entryNames: 'app',
  assetNames: 'assets/[name]-[hash]',
});

syncIndexAssetVersion(path.resolve(process.cwd(), 'public/index.html'), buildVersion);

function createBuildVersion() {
  const now = new Date();
  const pad = (value) => `${value}`.padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
}

function syncIndexAssetVersion(indexPath, version) {
  const source = fs.readFileSync(indexPath, 'utf8');
  const updated = source.replace(/((?:\/styles\.css|\/assets\/app\.css|\/assets\/app\.js)\?v=)[^"'\\s>]+/g, `$1${version}`);
  if (updated === source) {
    throw new Error(`Failed to update asset version in ${indexPath}`);
  }
  fs.writeFileSync(indexPath, updated);
}
