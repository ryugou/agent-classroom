import { useEffect, useRef, type CSSProperties } from 'react';
import type { ClassroomSnapshot } from '../../shared/ws-messages.js';
import type { LayoutTemplate } from '../../shared/persistence.js';
import { TILE_PX } from '../canvas/tile-map.js';
import { renderClassroom } from '../canvas/renderer.js';

interface Props {
  classroom: ClassroomSnapshot;
  templates: LayoutTemplate[];
  preloaded: boolean;
  style?: CSSProperties;
}

export function Classroom({ classroom, templates, preloaded, style }: Props) {
  const template = templates.find((t) => t.id === classroom.layoutTemplateId);
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!template) return;
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    renderClassroom(ctx, template, classroom);
  }, [classroom, template, preloaded]);

  if (!template) {
    return <section className="classroom" style={style}>no template for {classroom.layoutTemplateId}</section>;
  }

  return (
    <section className="classroom" style={style}>
      <header>
        <span>{classroom.id}</span>
        <span>{classroom.occupant?.sessionId ?? 'empty'}</span>
      </header>
      <canvas
        ref={ref}
        width={template.cols * TILE_PX}
        height={template.rows * TILE_PX}
        style={{ width: template.cols * TILE_PX * 2, height: template.rows * TILE_PX * 2 }}
      />
    </section>
  );
}
