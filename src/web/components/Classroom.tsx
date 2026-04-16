import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { ClassroomSnapshot } from '../../shared/ws-messages.js';
import type { LayoutTemplate } from '../../shared/persistence.js';
import { TILE_PX } from '../canvas/tile-map.js';
import { renderClassroom } from '../canvas/renderer.js';

interface Props {
  classroom: ClassroomSnapshot;
  templates: { id: string }[];  // scaffolded for Task 16 (currently unused; full LayoutTemplate wire-up)
  preloaded: boolean;
  style?: CSSProperties;
}

// Phase 1: 全教室共通テンプレ。Task 16 で撤去して observer から本物の LayoutTemplate を受け取る
const FALLBACK_TEMPLATE: LayoutTemplate = {
  id: 'default',
  cols: 10,
  rows: 7,
  tiles: Array(70).fill(0) as number[],
  seats: [
    { row: 2, col: 2 }, { row: 2, col: 4 }, { row: 2, col: 6 },
    { row: 3, col: 2 }, { row: 3, col: 4 }, { row: 3, col: 6 },
  ],
  teacherDesk: { row: 5, col: 4 },
};

export function Classroom({ classroom, preloaded, style }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    renderClassroom(ctx, FALLBACK_TEMPLATE, classroom);
  }, [classroom, preloaded]);  // re-render after sprites load

  return (
    <section className="classroom" style={style}>
      <header>
        <span>{classroom.id}</span>
        <span>{classroom.occupant?.sessionId ?? 'empty'}</span>
      </header>
      <canvas
        ref={ref}
        width={FALLBACK_TEMPLATE.cols * TILE_PX}
        height={FALLBACK_TEMPLATE.rows * TILE_PX}
        style={{ width: FALLBACK_TEMPLATE.cols * TILE_PX * 2, height: FALLBACK_TEMPLATE.rows * TILE_PX * 2 }}
      />
    </section>
  );
}
