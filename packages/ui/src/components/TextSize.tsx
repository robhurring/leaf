import { Minus, Plus } from '../icons/index.js';

type Props = { pct: number; onBump(delta: -10 | 0 | 10): void };

export function TextSize({ pct, onBump }: Props) {
  return (
    <div className="leaf-seg" role="group" aria-label="Text size">
      <button
        type="button"
        className="leaf-seg-btn"
        aria-label="Smaller text"
        title="Smaller text"
        onClick={() => onBump(-10)}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="leaf-seg-val"
        aria-label="Reset text size"
        title="Reset text size"
        onClick={() => onBump(0)}
      >
        {pct}%
      </button>
      <button
        type="button"
        className="leaf-seg-btn"
        aria-label="Larger text"
        title="Larger text"
        onClick={() => onBump(10)}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
