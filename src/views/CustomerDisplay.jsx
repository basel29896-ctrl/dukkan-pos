import React, { useState, useEffect } from 'react';
import { STORE_NAME, ARABIC } from '../client.config';
import { money } from '../lib/format';

const BC_NAME = 'dukkan_pos';

// Customer-facing display (open ?display=1 on a 2nd screen).
// Mirrors the live cart from the Sales screen via BroadcastChannel (+ localStorage fallback).
export default function CustomerDisplay() {
  const [state, setState] = useState(() => { try { return JSON.parse(localStorage.getItem('dukkan_display')) || null; } catch (_) { return null; } });
  useEffect(() => {
    let bc;
    try { bc = new BroadcastChannel(BC_NAME); bc.onmessage = (e) => setState(e.data); } catch (_) {}
    const onStorage = (e) => { if (e.key === 'dukkan_display' && e.newValue) { try { setState(JSON.parse(e.newValue)); } catch (_) {} } };
    window.addEventListener('storage', onStorage);
    return () => { if (bc) bc.close(); window.removeEventListener('storage', onStorage); };
  }, []);
  const items = (state && state.items) || [];
  const total = (state && state.total) || 0;
  return (
    <div dir={ARABIC ? 'rtl' : 'ltr'} className="flex min-h-screen flex-col bg-background p-6 font-sans text-foreground">
      <div className="mb-4 text-center text-3xl font-bold tracking-tight">{STORE_NAME}</div>
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-auto">
        {!items.length && <div className="mt-20 text-center text-2xl text-foreground-500">{ARABIC ? 'أهلاً بك' : 'Welcome'}</div>}
        {items.map((l, i) => (
          <div key={i} className="flex justify-between border-b border-divider py-3 text-2xl">
            <span>{l.name} <span className="text-xl text-foreground-500">× {l.qty}</span></span>
            <span className="tnum font-semibold">{money(l.price * l.qty)}</span>
          </div>
        ))}
      </div>
      <div className="mx-auto flex w-full max-w-2xl justify-between border-t-2 border-foreground pt-4 text-4xl font-bold">
        <span>{ARABIC ? 'المجموع' : 'Total'}</span><span className="tnum">{money(total)}</span>
      </div>
      {state && state.change != null && state.change >= 0 && (
        <div className="mx-auto mt-2 flex w-full max-w-2xl justify-between text-3xl font-bold text-success">
          <span>{ARABIC ? 'الباقي' : 'Change'}</span><span className="tnum">{money(state.change)}</span>
        </div>
      )}
    </div>
  );
}
