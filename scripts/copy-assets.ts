// scripts/copy-assets.ts
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const SRC = resolve(repo, 'assets-reference');
const OUT = resolve(repo, 'src/web/public/assets');

if (!existsSync(SRC)) {
  console.error(`[copy-assets] assets-reference/ not found at ${SRC}. Skipping (OK in CI).`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(resolve(OUT, 'characters'), { recursive: true });

const tile = resolve(SRC, 'cool-school/CoolSchool_tileset_48px/CoolSchool_tileset.png');
const tileDst = resolve(OUT, 'cool-school-tileset.png');
if (existsSync(tile)) cpSync(tile, tileDst);
else console.warn(`[copy-assets] not found: ${tile}`);

const charIds = ['0085', '0086', '0088', '0098', '0099', '0100', '0112'];
for (const id of charIds) {
  const s = resolve(SRC, `kenney-tiny-dungeon/Tiles/tile_${id}.png`);
  const d = resolve(OUT, 'characters', `char-${id}.png`);
  if (existsSync(s)) cpSync(s, d);
  else console.warn(`[copy-assets] not found: ${s}`);
}

console.log('[copy-assets] done');
