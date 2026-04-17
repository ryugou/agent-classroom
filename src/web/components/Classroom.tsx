import { useEffect, useRef, type CSSProperties } from 'react';
import type { ClassroomSnapshot } from '../../shared/ws-messages.js';
import type { LayoutTemplate } from '../../shared/persistence.js';
import { TILE_PX, buildWalkableGrid } from '../canvas/tile-map.js';
import { renderFrame, CHAR_SRCS } from '../canvas/renderer.js';
import { GameLoop } from '../canvas/game-loop.js';
import { Character } from '../canvas/characters.js';

interface Props {
  classroom: ClassroomSnapshot;
  templates: LayoutTemplate[];
  preloaded: boolean;
  style?: CSSProperties;
}

/** encoded-cwd (e.g. "-Users-ryugo-Developer-src-personal-agent-classroom") → readable project name */
function formatProjectName(encodedCwd: string | undefined): string {
  if (!encodedCwd) return 'empty';
  // Split by common path-like segments: uppercase letter after a dash often marks a new directory
  // Best-effort: take the last meaningful segment(s) from the encoded path
  const parts = encodedCwd.replace(/^-/, '').split('-');
  // Walk backwards to find the project name (last non-trivial segment group)
  // Heuristic: find the last segment that follows a known dir pattern (src, Developer, etc.)
  const markers = ['src', 'Developer', 'projects', 'AI'];
  let startIdx = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (markers.includes(parts[i]!)) {
      startIdx = i + 1;
      break;
    }
  }
  const projectParts = parts.slice(startIdx);
  return projectParts.length > 0 ? projectParts.join('-') : parts.slice(-2).join('-');
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Classroom({ classroom, templates, preloaded, style }: Props) {
  const template = templates.find((t) => t.id === classroom.layoutTemplateId);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const charsRef = useRef<Map<string, Character>>(new Map());

  // Sync characters with snapshot occupant
  useEffect(() => {
    if (!template) return;
    const chars = charsRef.current;
    const grid = buildWalkableGrid(template.tiles, template.cols, template.rows);
    const occ = classroom.occupant;

    if (!occ) {
      chars.clear();
      return;
    }

    // Teacher
    const teacherKey = 'teacher';
    let teacher = chars.get(teacherKey);
    if (!teacher) {
      teacher = new Character({
        id: teacherKey,
        role: 'teacher',
        seatTile: template.teacherDesk,
        charSpriteIndex: 0,
        tilePx: TILE_PX,
      });
      chars.set(teacherKey, teacher);
    }
    teacher.onAgentStateChanged(occ.teacherState, TILE_PX, grid);

    // Students
    const activeStudentIds = new Set(occ.students.map((s) => s.id as string));
    // Remove departed students
    for (const [k] of chars) {
      if (k !== teacherKey && !activeStudentIds.has(k)) chars.delete(k);
    }
    // Add/update students
    for (const student of occ.students) {
      const sid = student.id as string;
      let ch = chars.get(sid);
      if (!ch) {
        const seatIdx = occ.students.indexOf(student) % Math.max(template.seats.length, 1);
        const seat = template.seats[seatIdx] ?? template.teacherDesk;
        ch = new Character({
          id: sid,
          role: 'student',
          seatTile: seat,
          charSpriteIndex: (hash(sid) % (CHAR_SRCS.length - 1)) + 1,
          tilePx: TILE_PX,
        });
        chars.set(sid, ch);
      }
      ch.onAgentStateChanged(student.state, TILE_PX, grid);
    }
  }, [classroom, template]);

  // Game loop lifecycle
  useEffect(() => {
    if (!template || !preloaded) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const grid = buildWalkableGrid(template.tiles, template.cols, template.rows);

    const loop = new GameLoop((dt) => {
      const chars = Array.from(charsRef.current.values());
      for (const ch of chars) ch.update(dt, TILE_PX, grid);
      renderFrame(ctx, template, chars);
    });
    loopRef.current = loop;
    loop.start();
    return () => loop.stop();
  }, [template, preloaded]);

  if (!template) {
    return <section className="classroom" style={style}>no template</section>;
  }

  return (
    <section className="classroom" style={style}>
      <header>
        <span>{formatProjectName(classroom.occupant?.cwd)}</span>
        <span>{classroom.occupant ? classroom.occupant.teacherState : 'empty'}</span>
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
