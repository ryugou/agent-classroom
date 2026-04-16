// src/web/canvas/tile-map.ts
import type { LayoutTemplate } from '../../shared/persistence.js';

export const TILE_PX = 16;  // 描画サイズ (48/3)
export const SOURCE_TILE_PX = 48;  // Cool School tileset の原サイズ

export interface TileRect { sx: number; sy: number; }

const TILE_ATLAS: Record<number, TileRect> = {
  0: { sx: 0, sy: 0 },        // 床
  1: { sx: 48, sy: 0 },       // 壁
  2: { sx: 96, sy: 0 },       // 黒板
};

export function atlasOf(tileId: number): TileRect | null {
  return TILE_ATLAS[tileId] ?? null;
}

export function drawTile(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  tileId: number,
  dx: number,
  dy: number,
): void {
  const a = atlasOf(tileId);
  if (!a) return;
  ctx.drawImage(sheet, a.sx, a.sy, SOURCE_TILE_PX, SOURCE_TILE_PX, dx, dy, TILE_PX, TILE_PX);
}

export function buildLayoutPixels(template: LayoutTemplate) {
  return { widthPx: template.cols * TILE_PX, heightPx: template.rows * TILE_PX };
}
