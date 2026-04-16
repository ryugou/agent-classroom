import type { StoreState } from '../store.js';
import { Classroom } from './Classroom.js';

interface Props { state: StoreState; }
export function Schoolhouse({ state }: Props) {
  const { cols, rows } = state.gridShape;
  return (
    <div
      className="schoolhouse"
      style={{ gridTemplateColumns: `repeat(${cols}, max-content)`, gridTemplateRows: `repeat(${rows}, max-content)` }}
    >
      {state.classrooms.map((c) => (
        <Classroom
          key={c.id}
          classroom={c}
          templates={state.layoutTemplates}
          style={{ gridColumn: c.gridPos.col + 1, gridRow: c.gridPos.row + 1 }}
        />
      ))}
    </div>
  );
}
