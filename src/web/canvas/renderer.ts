import type { LayoutTemplate } from '../../shared/persistence.js';
import type { AgentState } from '../../shared/events.js';
import type { Character } from './characters.js';
import { drawTile, TILE_PX } from './tile-map.js';
import { sharedCache } from './sprite-cache.js';

const TILESET_SRC = '/assets/cool-school-tileset.png';
export const CHAR_SRCS = [
  '/assets/characters/char-0085.png',
  '/assets/characters/char-0086.png',
  '/assets/characters/char-0088.png',
  '/assets/characters/char-0098.png',
  '/assets/characters/char-0099.png',
  '/assets/characters/char-0100.png',
  '/assets/characters/char-0112.png',
];

const STATE_COLOR: Record<AgentState, string> = {
  active: '#4caf50',
  idle: '#9e9e9e',
  permission: '#f44336',
};

export async function preload(): Promise<void> {
  const results = await Promise.allSettled([
    sharedCache.load(TILESET_SRC),
    ...CHAR_SRCS.map((s) => sharedCache.load(s)),
  ]);
  const sources = [TILESET_SRC, ...CHAR_SRCS];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === 'rejected') {
      console.warn('[renderer] failed to load sprite', { src: sources[i], err: r.reason });
    }
  }
}

function drawStateBadge(ctx: CanvasRenderingContext2D, x: number, y: number, state: AgentState): void {
  ctx.fillStyle = STATE_COLOR[state];
  ctx.beginPath();
  ctx.arc(x + TILE_PX - 2, y + 2, 2, 0, Math.PI * 2);
  ctx.fill();
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  template: LayoutTemplate,
  characters: Character[],
): void {
  const sheet = sharedCache.get(TILESET_SRC);
  if (!sheet) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let r = 0; r < template.rows; r++) {
    for (let c = 0; c < template.cols; c++) {
      const id = template.tiles[r * template.cols + c] ?? 0;
      drawTile(ctx, sheet, id, c * TILE_PX, r * TILE_PX);
    }
  }

  // Z-sort by Y
  const sorted = [...characters].sort((a, b) => a.pos.y - b.pos.y);

  for (const ch of sorted) {
    const img = sharedCache.get(CHAR_SRCS[ch.charSpriteIndex]!);
    if (!img) continue;
    const drawX = Math.round(ch.pos.x);
    const drawY = Math.round(ch.pos.y + ch.bounceOffsetY);
    ctx.drawImage(img, drawX, drawY);
    drawStateBadge(ctx, drawX, drawY, ch.agentState);
    if (ch.showBubble) {
      drawSpeechBubble(ctx, drawX, drawY);
    }
  }
}

function drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const bx = x + TILE_PX / 2;
  const by = y - 6;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bx - 5, by - 8, 10, 10, 2);
  } else {
    ctx.rect(bx - 5, by - 8, 10, 10);
  }
  ctx.fill();
  ctx.strokeStyle = '#f44336';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.fillStyle = '#f44336';
  ctx.font = 'bold 7px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', bx, by - 3);
}
