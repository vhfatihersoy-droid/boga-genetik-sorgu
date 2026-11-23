import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (relPath) => readFileSync(new URL(relPath, root), 'utf8');

const html = read('index.html');
const seedRaw = read('seed.json');
const seed = JSON.parse(seedRaw);

const backupFiles = {
  'application/index.html': html,
  'application/worker/index.js': read('worker/index.js'),
  'application/scripts/build-worker.mjs': read('scripts/build-worker.mjs'),
  'application/.openai/hosting.json': read('.openai/hosting.json'),
  'application/seed.json': seedRaw,
  'database/migrations/0000_site_state.sql': read('drizzle/0000_site_state.sql'),
  'README_TR.md': read('README_TR.md'),
};

const template = read('worker/index.js');
// Fonksiyon replacer kullanilarak '$&', "$'", '$`' gibi ozel desenlerin bozulmasi onlenir.
const output = template
  .replace('__APP_HTML__', () => JSON.stringify(html))
  .replace('__SEED__', () => JSON.stringify(seed))
  .replace('__BACKUP_FILES__', () => JSON.stringify(backupFiles));

for (const token of ['__APP_HTML__', '__SEED__', '__BACKUP_FILES__']) {
  if (output.includes(`= ${token};`)) {
    throw new Error(`Worker build placeholder was not replaced: ${token}`);
  }
}

mkdirSync(new URL('../dist/server/', import.meta.url), { recursive: true });
mkdirSync(new URL('../dist/.openai/', import.meta.url), { recursive: true });

writeFileSync(new URL('../dist/server/index.js', import.meta.url), output, 'utf8');
copyFileSync(
  new URL('../.openai/hosting.json', import.meta.url),
  new URL('../dist/.openai/hosting.json', import.meta.url)
);

console.log(
  `Worker build complete (${seed.bulls.length} bulls, ${seed.sources.length} sources, ${Math.round(output.length / 1024)} KB)`
);
