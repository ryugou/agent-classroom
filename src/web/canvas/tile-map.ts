export const TILE_PX = 16;
export const SOURCE_TILE_PX = 48;

export interface TileType {
  sx?: number;
  sy?: number;
  color?: string;
  walkable: boolean;
}

// Cool School tileset (384×576px, 8col × 12row @ 48px each)
// Coordinates: sx = col * 48, sy = row * 48
const TILE_TYPES: Record<number, TileType> = {
  // ── Floor tiles (WALKABLE) ──────────────────────────────────────────
  // [0,0] Blue diamond floor pattern
  0: { sx: 0, sy: 0, walkable: true },
  // [1,0] Blue diamond floor (right half / variant)
  1: { sx: 48, sy: 0, walkable: true },
  // [2,0] Yellow/gold diamond floor
  2: { sx: 96, sy: 0, walkable: true },
  // [0,3] Pale green/cream floor (light wainscoting area floor)
  3: { sx: 0, sy: 144, walkable: true },
  // [1,3] Pale green/cream floor variant
  4: { sx: 48, sy: 144, walkable: true },
  // [0,4] Pale green floor (lower section)
  5: { sx: 0, sy: 192, walkable: true },
  // [1,4] Pale green floor variant
  6: { sx: 48, sy: 192, walkable: true },

  // ── Wall tiles (NOT walkable) — warm brown/orange tones ──────────────
  // [2,3] Brown textured wall
  10: { sx: 96, sy: 144, walkable: false },
  // [3,3] Brown wall variant
  11: { sx: 144, sy: 144, walkable: false },
  // [0,3] Herringbone wall (same as floor but non-walkable for wall row)
  12: { sx: 0, sy: 144, walkable: false },
  // [1,3] Diagonal wall variant
  13: { sx: 48, sy: 144, walkable: false },

  // ── Window (NOT walkable) ───────────────────────────────────────────
  // [3,0] Window tile (colorful panes)
  20: { sx: 144, sy: 0, walkable: false },
  // [4,0] Window tile right
  21: { sx: 192, sy: 0, walkable: false },

  // ── Blackboard (NOT walkable) ───────────────────────────────────────
  // Green blackboard at row 1 (y=48), cols 3-4
  30: { sx: 144, sy: 48, walkable: false },
  // Blackboard right half
  31: { sx: 192, sy: 48, walkable: false },
  // Small purple board (row 2, col 3) — used as blackboard accent
  32: { sx: 144, sy: 96, walkable: false },

  // ── Bookshelf (NOT walkable) ────────────────────────────────────────
  // [5,1] Bookshelf top-left
  40: { sx: 240, sy: 48, walkable: false },
  // [6,1] Bookshelf top-right
  41: { sx: 288, sy: 48, walkable: false },
  // [7,1] Bookshelf top-far-right
  42: { sx: 336, sy: 48, walkable: false },
  // [5,2] Bookshelf mid-left
  43: { sx: 240, sy: 96, walkable: false },
  // [6,2] Bookshelf mid-right
  44: { sx: 288, sy: 96, walkable: false },
  // [7,2] Bookshelf mid-far-right
  45: { sx: 336, sy: 96, walkable: false },
  // [5,3] Bookshelf bottom-left
  46: { sx: 240, sy: 144, walkable: false },
  // [6,3] Bookshelf bottom-right
  47: { sx: 288, sy: 144, walkable: false },
  // [7,3] Bookshelf bottom-far-right
  48: { sx: 336, sy: 144, walkable: false },

  // ── Desk / Table (NOT walkable) ─────────────────────────────────────
  // [0,9] Small desk (individual furniture item, row 9)
  50: { sx: 0, sy: 432, walkable: false },
  // [1,9] Small shelf unit
  51: { sx: 48, sy: 432, walkable: false },
  // [2,5] Desk surface mid-right
  52: { sx: 96, sy: 240, walkable: false },
  // [3,5] Desk surface right
  53: { sx: 144, sy: 240, walkable: false },
  // [4,5] Desk surface far-right
  54: { sx: 192, sy: 240, walkable: false },
  // [5,5] Desk side-panel left
  55: { sx: 240, sy: 240, walkable: false },
  // [6,5] Desk side-panel right
  56: { sx: 288, sy: 240, walkable: false },
  // [7,5] Desk end cap
  57: { sx: 336, sy: 240, walkable: false },
  // [0,6] Desk drawer front left
  58: { sx: 0, sy: 288, walkable: false },
  // [1,6] Desk drawer front mid
  59: { sx: 48, sy: 288, walkable: false },
  // [2,6] Desk drawer front right
  60: { sx: 96, sy: 288, walkable: false },
  // [3,6] Desk lower left
  61: { sx: 144, sy: 288, walkable: false },
  // [4,6] Desk lower mid
  62: { sx: 192, sy: 288, walkable: false },
  // [5,6] Cabinet/desk side left
  63: { sx: 240, sy: 288, walkable: false },
  // [6,6] Cabinet/desk side mid
  64: { sx: 288, sy: 288, walkable: false },
  // [7,6] Cabinet/desk side right
  65: { sx: 336, sy: 288, walkable: false },
  // [0,7] Desk bottom-left
  66: { sx: 0, sy: 336, walkable: false },
  // [1,7] Desk bottom-mid
  67: { sx: 48, sy: 336, walkable: false },
  // [2,7] Desk bottom-right
  68: { sx: 96, sy: 336, walkable: false },
  // [3,7] Desk bottom far
  69: { sx: 144, sy: 336, walkable: false },
  // [4,7] Desk base left
  70: { sx: 192, sy: 336, walkable: false },
  // [5,7] Desk base mid
  71: { sx: 240, sy: 336, walkable: false },
  // [6,7] Desk base right
  72: { sx: 288, sy: 336, walkable: false },
  // [7,7] Desk base far
  73: { sx: 336, sy: 336, walkable: false },

  // ── Cabinet drawer bottom row (NOT walkable) ────────────────────────
  // [0,8] Cabinet bottom-left
  80: { sx: 0, sy: 384, walkable: false },
  // [1,8] Cabinet bottom-mid
  81: { sx: 48, sy: 384, walkable: false },
  // [2,8] Cabinet bottom-right
  82: { sx: 96, sy: 384, walkable: false },
  // [5,4] Cabinet side top
  83: { sx: 240, sy: 192, walkable: false },
  // [6,4] Cabinet side bottom
  84: { sx: 288, sy: 192, walkable: false },
};

export function tileTypeOf(id: number): TileType | null {
  return TILE_TYPES[id] ?? null;
}

export function isWalkable(id: number): boolean {
  return TILE_TYPES[id]?.walkable ?? false;
}

export function drawTile(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  tileId: number,
  dx: number,
  dy: number,
): void {
  const t = tileTypeOf(tileId);
  if (!t) return;
  if (t.color) {
    ctx.fillStyle = t.color;
    ctx.fillRect(dx, dy, TILE_PX, TILE_PX);
  } else if (t.sx !== undefined && t.sy !== undefined) {
    ctx.drawImage(sheet, t.sx, t.sy, SOURCE_TILE_PX, SOURCE_TILE_PX, dx, dy, TILE_PX, TILE_PX);
  }
}

export function buildWalkableGrid(tiles: number[], cols: number, rows: number): boolean[][] {
  const grid: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(isWalkable(tiles[r * cols + c] ?? -1));
    }
    grid.push(row);
  }
  return grid;
}
