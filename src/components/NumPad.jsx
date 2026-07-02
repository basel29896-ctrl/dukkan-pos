import React from 'react';
import { Delete } from 'lucide-react';

// Touch keypad driving a numeric string field. Plain <button>s on purpose:
// onMouseDown-preventDefault keeps focus in the field being edited, which
// React-Aria press handling would otherwise steal.
const KEY =
  'h-14 select-none rounded-medium border border-divider bg-content2 text-xl font-semibold text-foreground tnum ' +
  'transition-transform active:scale-[0.97] hover:bg-content3';

export default function NumPad({ onKey, onClear, onBackspace }) {
  const k = (label, fn, cls = '') => (
    <button key={typeof label === 'string' ? label : 'bs'} type="button"
      onMouseDown={(e) => e.preventDefault()} onClick={fn} className={`${KEY} ${cls}`}>
      {label}
    </button>
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => k(d, () => onKey(d)))}
      {k('.', () => onKey('.'))}
      {k('0', () => onKey('0'))}
      {k(<Delete size={22} className="mx-auto" />, onBackspace, 'bg-danger text-danger-foreground hover:bg-danger border-danger')}
      {k('C', onClear, 'col-span-3 bg-content3 text-foreground-500')}
    </div>
  );
}
