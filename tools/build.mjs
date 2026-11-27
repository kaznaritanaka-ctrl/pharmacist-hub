// tools/build.mjs — 本番用の Worker を1ファイルにまとめる。
// 使い方: node tools/build.mjs  → dist/worker.js ができる（Cloudflare の Worker「pharmacist-hub」へアップロードする）。
// main に push すると GitHub Actions（.github/workflows/deploy.yml）がこれを実行して本番へ反映する。
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ...readdirSync(root).filter((f) => /\.(html|css|js|txt|xml)$/.test(f)),
  ...readdirSync(join(root, 'admin')).filter((f) => /\.(html|css|js)$/.test(f)).map((f) => `admin/${f}`), // 管理画面
];
const assets = Object.fromEntries(files.map((f) => [f, readFileSync(join(root, f), 'utf8')]));
// worker/admin.js を index.js に取り込んで1ファイルにする（Cloudflare には1ファイルでアップロードする）
const admin = readFileSync(join(root, 'worker/admin.js'), 'utf8').replace(/^export /gm, '');
const src = readFileSync(join(root, 'worker/index.js'), 'utf8')
  .replace("import { handleAdmin } from './admin.js';", () => admin);
const out = src.replace('/* __ASSETS__ */', () => `const ASSETS = ${JSON.stringify(assets)};`);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/worker.js'), out);
console.log(`dist/worker.js: ${files.length} files, ${out.length} bytes`);
