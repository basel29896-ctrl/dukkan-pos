import React, { useState } from 'react';
import { Delete, CornerDownLeft } from 'lucide-react';
import { ARABIC } from '../client.config';

// On-screen keyboard (touch terminals) — drives whichever field is active.
// Plain <button>s: onMouseDown-preventDefault keeps focus in the target input.
const KEY =
  'h-14 min-w-0 select-none rounded-medium border border-divider bg-content2 text-lg font-semibold text-foreground ' +
  'transition-transform active:scale-[0.97] hover:bg-content3';

export default function OnScreenKeyboard({ onKey, onBackspace, onEnter, onClose }) {
  const [mode, setMode] = useState('num');   // 'num' (default) | 'abc'
  const [caps, setCaps] = useState(false);
  const key = (label, onTap, flex = 1, cls = '') => (
    <button key={typeof label === 'string' ? label : cls} type="button" style={{ flex }}
      onMouseDown={(e) => e.preventDefault()} onClick={onTap} className={`${KEY} ${cls}`}>
      {label}
    </button>
  );
  const toggleKey = key(mode === 'num' ? 'ABC' : '123', () => setMode((m) => (m === 'num' ? 'abc' : 'num')), 1.4, 'text-foreground-500 text-base');
  const enterKey = key(
    <span className="inline-flex items-center gap-1.5"><CornerDownLeft size={18} />{ARABIC ? 'دخول' : 'Enter'}</span>,
    onEnter, 2, 'bg-primary text-primary-foreground hover:bg-primary border-primary text-base enter-key',
  );
  const backspaceKey = (k2) => key(<Delete size={20} className="mx-auto" />, onBackspace, 1.4, `bg-danger text-danger-foreground hover:bg-danger border-danger bs-${k2}`);
  const bottomRow = (
    <div className="flex gap-2">
      {key(ARABIC ? 'إغلاق' : 'Hide', onClose, 1.4, 'text-foreground-500 text-base')}
      {key('␣', () => onKey(' '), 4)}
      {enterKey}
    </div>
  );

  if (mode === 'num') {
    const cell = (ch) => key(ch, () => onKey(ch), 1, 'tnum');
    return (
      <div className="mt-2 flex flex-col gap-2">
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((r, i) => (
          <div key={i} className="flex gap-2">{r.map(cell)}</div>
        ))}
        <div className="flex gap-2">
          {toggleKey}
          {cell('0')}
          {backspaceKey('num')}
        </div>
        {bottomRow}
      </div>
    );
  }

  const rows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '_', '@'],
  ];
  const cell = (ch) => key(caps ? ch.toUpperCase() : ch, () => onKey(caps ? ch.toUpperCase() : ch));
  return (
    <div className="mt-2 flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          {i === 3 && key(caps ? '⇧' : '⇪', () => setCaps((c) => !c), 1.4, caps ? 'bg-primary text-primary-foreground border-primary' : '')}
          {r.map(cell)}
          {i === 3 && backspaceKey('abc')}
        </div>
      ))}
      <div className="flex gap-2">
        {toggleKey}
        {key('␣', () => onKey(' '), 4)}
        {enterKey}
      </div>
    </div>
  );
}
