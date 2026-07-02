/* eslint-disable */
// Dukkan — single-store, barcode-driven grocery POS.
// Scan → cart → checkout. No floors, no recipes: a product catalogue plus a sales screen.
// Talks to the Express API via src/api.js (Bearer session token). The store key is fixed
// to DEFAULT_FLOOR ("main") wherever the generic orders/invoice API needs a store id.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from './api';
import {
  STORE_NAME, CURRENCY, ARABIC, DEFAULT_FLOOR, BILL, SELLER, VIEWS, VIEW_LABELS,
} from './client.config';

const TOKEN_KEY = 'dukkan_token';

// ── Money / misc helpers ──────────────────────────────────────────────────────
const money = (n) => `${(Number(n) || 0).toFixed(3)} ${CURRENCY}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowParts = () => {
  const d = new Date();
  return { date: d.toISOString().slice(0, 10), time: d.toTimeString().slice(0, 8) };
};

// ── Design tokens — single source of truth ──────────────────────────────────────
// Two palettes share one shape; THEME picks one at module load (localStorage-backed,
// the toggle writes the preference and reloads — every C.* read is boot-time).
const LIGHT = {
  // Surfaces
  bg:      '#F6F7F9',   // app canvas
  panel:   '#FFFFFF',   // cards, sidebar, modals, elevated surfaces
  panel2:  '#F1F5F9',   // insets: table headers, hovered rows, secondary fills
  line:    '#E5E7EB',   // hairline borders + dividers
  // Text
  text:    '#0F172A',   // primary
  dim:     '#64748B',   // secondary / labels  (AA on #FFFFFF; keep ≥13px on #F1F5F9)
  // Brand / semantic — ONE accent + red/green only
  accent:      '#2563EB',   // primary actions, active nav, selected toggles
  accentText:  '#FFFFFF',   // text/icon on the accent
  accentSoft:  '#EFF4FF',   // accent-tinted fill: active nav background, highlights
  green:       '#15803D',   // success (clock-in "open", positive deltas) — AA-safe
  red:         '#DC2626',   // danger (delete, backspace, low stock, negatives)
  onColor:     '#FFFFFF',   // text/icon on ANY solid semantic color
  scrim:       'rgba(15,23,42,.40)',   // modal backdrop — stays dark on the light canvas
};
const DARK = {
  // Surfaces — slate ramp; borders (not shadows) carry the elevation on dark
  bg:      '#0B0F17',
  panel:   '#151B26',
  panel2:  '#1E2735',
  line:    '#2A3444',
  // Text
  text:    '#E6EAF0',
  dim:     '#94A3B8',
  // Brand / semantic — brightened one step so they read on dark surfaces
  accent:      '#3B82F6',
  accentText:  '#FFFFFF',
  accentSoft:  '#1C2A44',
  green:       '#16A34A',
  red:         '#EF4444',
  onColor:     '#FFFFFF',
  scrim:       'rgba(0,0,0,.55)',
};
const THEME = (() => { try { return localStorage.getItem('dukkan_theme') === 'dark' ? 'dark' : 'light'; } catch (_) { return 'light'; } })();
const C = THEME === 'dark' ? DARK : LIGHT;

const T = {
  radius: { sm: 6, md: 8, lg: 12, pill: 999 },
  space:  { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  font: {
    family: "'Inter', 'IBM Plex Sans Arabic', system-ui, sans-serif",
    xs: 12, sm: 13, base: 14, lg: 16, xl: 20, display: 28, hero: 40,
  },
  shadow: {
    sm: '0 1px 2px rgba(15,23,42,.05)',
    md: '0 1px 3px rgba(15,23,42,.08), 0 1px 2px rgba(15,23,42,.04)',
    lg: '0 10px 30px rgba(15,23,42,.12)',            // modals / dropdowns ONLY
  },
  // Spread onto price/total/stat numbers so digits align and read as "designed"
  num: { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1' },
};

const S = {
  btn: {
    padding: '10px 16px', borderRadius: T.radius.md, border: 'none',
    background: C.accent, color: C.accentText, fontWeight: 600, fontSize: T.font.base,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  btnGhost: {
    padding: '9px 14px', borderRadius: T.radius.md, border: `1px solid ${C.line}`,
    background: C.panel, color: C.text, fontWeight: 600, fontSize: T.font.sm,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  input: {
    padding: '10px 12px', borderRadius: T.radius.md, border: `1px solid ${C.line}`,
    background: C.panel, color: C.text, fontSize: T.font.base, fontFamily: 'inherit',
    outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  card: {
    background: C.panel, borderRadius: T.radius.lg, border: `1px solid ${C.line}`,
    padding: T.space.lg, boxShadow: T.shadow.sm,
  },
};

// Persist a language/theme preference and reload — ARABIC and C are resolved at module
// load, so a full reload is the swap mechanism (the session token survives in localStorage).
const setPref = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} window.location.reload(); };

// ── Receipt printing (hidden iframe → window.print) ─────────────────────────────
function printReceipt(sale) {
  const lines = (sale.items || []).map(
    (li) => `<tr><td>${escapeHtml(li.name)}</td><td style="text-align:center">${li.qty}</td>
      <td style="text-align:right">${(Number(li.price) || 0).toFixed(3)}</td>
      <td style="text-align:right">${((Number(li.price) || 0) * li.qty).toFixed(3)}</td></tr>`
  ).join('');
  const thanks = ARABIC ? (BILL.footerThanksAr || BILL.footerThanks) : BILL.footerThanks;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{font-family:'Courier New',monospace;color:#000} body{width:280px;margin:0 auto;padding:8px}
    h2{text-align:center;margin:4px 0;font-size:18px} .muted{text-align:center;font-size:11px;color:#333}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
    td,th{padding:2px 0} thead th{border-bottom:1px dashed #000;text-align:left}
    .tot{border-top:1px dashed #000;font-weight:bold;font-size:14px}
    .ftr{text-align:center;margin-top:10px;font-size:12px}</style></head><body>
    <h2>${escapeHtml(SELLER.name || STORE_NAME)}</h2>
    ${SELLER.location ? `<div class="muted">${escapeHtml(SELLER.location)}</div>` : ''}
    ${SELLER.taxNo ? `<div class="muted">Tax No: ${escapeHtml(SELLER.taxNo)}</div>` : ''}
    <div class="muted">Invoice ${BILL.invoicePrefix || ''}${sale.invoice_no ?? ''} — ${sale.date} ${sale.time}</div>
    <table><thead><tr><th>Item</th><th style="text-align:center">Qty</th>
      <th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${lines}</tbody>
      <tfoot><tr class="tot"><td colspan="3">TOTAL</td>
        <td style="text-align:right">${(Number(sale.total) || 0).toFixed(3)}</td></tr>
        <tr><td colspan="4" style="font-size:11px;padding-top:4px">Paid: ${escapeHtml(sale.pay || '')}</td></tr>
      </tfoot></table>
    <div class="ftr">${escapeHtml(thanks || '')}</div></body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  frame.contentWindow.focus();
  setTimeout(() => {
    frame.contentWindow.print();
    setTimeout(() => document.body.removeChild(frame), 1000);
  }, 250);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ══════════════════════════════════════════════════════════════════════════════
// Root
// ══════════════════════════════════════════════════════════════════════════════
const BC_NAME = 'dukkan_pos';
export default function App() {
  const isDisplay = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('display') === '1';
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState('sales');
  const [toast, setToast] = useState(null);

  const notify = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  }, []);

  // Restore session on load from the persisted token.
  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setBooting(false); return; }
    api.setToken(t);
    let alive = true;
    api.get('/auth/validate')
      .then((u) => { if (alive) setUser(u); })
      .catch(() => { api.setToken(null); localStorage.removeItem(TOKEN_KEY); })
      .finally(() => { if (alive) setBooting(false); });
    return () => { alive = false; };
  }, []);

  // Blocking overlay when the session dies mid-use.
  useEffect(() => {
    api.setOnSessionExpired(() => {
      api.setToken(null);
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      notify(ARABIC ? 'انتهت الجلسة، سجّل الدخول من جديد' : 'Session expired — please log in again', 'red');
    });
  }, [notify]);

  const handleLogin = (u) => {
    api.setToken(u.token);
    localStorage.setItem(TOKEN_KEY, u.token);
    setUser(u);
    setView('sales');
  };
  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch (_) {}
    api.setToken(null);
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  if (isDisplay) return <CustomerDisplay />;
  if (booting) return <Centered>{ARABIC ? 'جارٍ التحميل…' : 'Loading…'}</Centered>;
  if (!user) return <Login onLogin={handleLogin} />;

  const isAdmin = user.role === 'admin';
  const allowed = (v) => {
    if (v === 'sales' || v === 'settings' || isAdmin) return true;
    const views = user.allowed_views || [];
    if (v === 'receive') return views.includes('inventory') || views.includes('receive');
    return views.includes(v);
  };
  const navViews = VIEWS.filter(allowed);

  return (
    <div dir="ltr" style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: T.font.family, display: 'flex', alignItems: 'stretch' }}>
      <main dir={ARABIC ? 'rtl' : 'ltr'} style={{ flex: 1, minWidth: 0, padding: T.space.lg, boxSizing: 'border-box' }}>
        {view === 'sales' && <SalesView user={user} notify={notify} />}
        {view === 'inventory' && allowed('inventory') && <InventoryView isAdmin={isAdmin} notify={notify} />}
        {view === 'receive' && allowed('receive') && <ReceiveView isAdmin={isAdmin} notify={notify} />}
        {view === 'history' && allowed('history') && <HistoryView user={user} notify={notify} />}
        {view === 'reports' && allowed('reports') && <ReportsView notify={notify} />}
        {view === 'settings' && <SettingsView user={user} isAdmin={isAdmin} notify={notify} />}
      </main>
      <Sidebar user={user} view={view} setView={setView} navViews={navViews} onLogout={handleLogout} canSeeStock={allowed('inventory') || allowed('reports')} />
      {toast && (
        <div style={{ position: 'fixed', bottom: T.space.xl, left: '50%', transform: 'translateX(-50%)', background: toast.kind === 'red' ? C.red : toast.kind === 'green' ? C.green : C.panel, color: toast.kind === 'info' ? C.text : C.onColor, border: toast.kind === 'info' ? `1px solid ${C.line}` : 'none', padding: `${T.space.md}px ${T.space.xl}px`, borderRadius: T.radius.lg, fontWeight: 600, fontSize: T.font.base, boxShadow: T.shadow.lg, zIndex: 1000 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Centered({ children }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, color: C.dim, fontFamily: T.font.family }}>{children}</div>;
}

// ── Customer-facing display (open ?display=1 on a 2nd screen) ────────────────────
// Mirrors the live cart from the Sales screen via BroadcastChannel (+ localStorage fallback).
function CustomerDisplay() {
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
    <div dir={ARABIC ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: T.font.family, display: 'flex', flexDirection: 'column', padding: T.space.xl }}>
      <div style={{ fontWeight: 700, fontSize: T.font.display, color: C.text, letterSpacing: '-0.02em', textAlign: 'center', marginBottom: T.space.lg }}>{STORE_NAME}</div>
      <div style={{ flex: 1, overflow: 'auto', maxWidth: 720, width: '100%', margin: '0 auto' }}>
        {!items.length && <div style={{ color: C.dim, fontSize: T.font.display, textAlign: 'center', marginTop: 80 }}>{ARABIC ? 'أهلاً بك' : 'Welcome'}</div>}
        {items.map((l, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: `${T.space.md}px 0`, borderBottom: `1px solid ${C.line}`, fontSize: T.font.display }}>
            <span>{l.name} <span style={{ color: C.dim, fontSize: T.font.xl }}>× {l.qty}</span></span>
            <span style={{ fontWeight: 600, ...T.num }}>{money(l.price * l.qty)}</span>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: 720, width: '100%', margin: '0 auto', borderTop: `2px solid ${C.text}`, paddingTop: T.space.lg, display: 'flex', justifyContent: 'space-between', fontSize: T.font.hero, fontWeight: 700 }}>
        <span>{ARABIC ? 'المجموع' : 'Total'}</span><span style={{ ...T.num }}>{money(total)}</span>
      </div>
      {state && state.change != null && state.change >= 0 && (
        <div style={{ maxWidth: 720, width: '100%', margin: `${T.space.sm}px auto 0`, display: 'flex', justifyContent: 'space-between', fontSize: T.font.display, color: C.green, fontWeight: 700 }}>
          <span>{ARABIC ? 'الباقي' : 'Change'}</span><span style={{ ...T.num }}>{money(state.change)}</span>
        </div>
      )}
    </div>
  );
}

const VIEW_ICONS = { sales: '🛒', inventory: '📦', receive: '📥', history: '🧾', reports: '📊', settings: '⚙️' };

// Clock In/Out for the logged-in employee.
function ClockButton() {
  const [open, setOpen] = useState(null); // open punch or null
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/timeclock/status').then(setOpen).catch(() => {}); }, []);
  const toggle = async () => {
    setBusy(true);
    try {
      if (open) { await api.post('/timeclock/out'); setOpen(null); }
      else { await api.post('/timeclock/in'); api.get('/timeclock/status').then(setOpen); }
    } catch (_) {} finally { setBusy(false); }
  };
  return (
    <button onClick={toggle} disabled={busy} style={{ ...S.btnGhost, height: 48, fontSize: T.font.base, ...(open ? { borderColor: C.green, color: C.green, fontWeight: 700 } : {}) }}>
      {open ? (ARABIC ? '🟢 خروج' : '🟢 Clock Out') : (ARABIC ? '🕐 دخول' : '🕐 Clock In')}
    </button>
  );
}

// Bell badge: low-stock + expiring counts, with a dropdown list.
function NotificationsBell() {
  const [low, setLow] = useState([]);
  const [exp, setExp] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api.get('/reports/low-stock?threshold=5').then(setLow).catch(() => {});
    api.get('/expiry?days=14').then(setExp).catch(() => {});
  }, []);
  const count = low.length + exp.length;
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...S.btnGhost, height: 48, fontSize: T.font.xl, position: 'relative' }}>
        🔔{count > 0 && <span style={{ position: 'absolute', top: 6, insetInlineEnd: 6, background: C.red, color: C.onColor, borderRadius: T.radius.pill, fontSize: T.font.xs, fontWeight: 700, padding: '1px 6px', ...T.num }}>{count}</span>}
      </button>
      {open && (
        <div style={{ position: 'fixed', insetInlineStart: 236, bottom: T.space.lg, width: 320, maxHeight: 420, overflow: 'auto', background: C.panel, border: `1px solid ${C.line}`, borderRadius: T.radius.lg, padding: T.space.lg, zIndex: 1000, boxShadow: T.shadow.lg }}>
          <div style={{ fontWeight: 700, fontSize: T.font.sm, marginBottom: T.space.xs, color: C.red }}>{ARABIC ? 'مخزون منخفض' : 'Low stock'} ({low.length})</div>
          {low.slice(0, 8).map((p) => <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: T.font.sm, padding: `${T.space.xs}px 0` }}><span>{p.name}</span><span style={{ color: C.red, fontWeight: 600, ...T.num }}>{Number(p.stock)}</span></div>)}
          <div style={{ fontWeight: 700, fontSize: T.font.sm, margin: `${T.space.md}px 0 ${T.space.xs}px`, color: C.accent }}>{ARABIC ? 'قرب الانتهاء' : 'Expiring'} ({exp.length})</div>
          {exp.slice(0, 8).map((e) => <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: T.font.sm, padding: `${T.space.xs}px 0` }}><span>{e.product}</span><span style={{ color: Number(e.days_left) < 0 ? C.red : C.accent, fontWeight: 600, ...T.num }}>{e.expiry}</span></div>)}
          {!count && <div style={{ color: C.dim, fontSize: T.font.sm }}>{ARABIC ? 'لا تنبيهات' : 'All good'}</div>}
        </div>
      )}
    </div>
  );
}

// Vertical navigation rail, pinned to the right edge. Bigger touch targets.
function Sidebar({ user, view, setView, navViews, onLogout, canSeeStock }) {
  return (
    <aside dir={ARABIC ? 'rtl' : 'ltr'} style={{
      width: 220, flex: '0 0 220px', background: C.panel, borderInlineStart: `1px solid ${C.line}`,
      display: 'flex', flexDirection: 'column', gap: T.space.md, padding: T.space.md, boxSizing: 'border-box',
      position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
    }}>
      <div style={{ fontWeight: 700, fontSize: T.font.xl, color: C.text, letterSpacing: '-0.02em', textAlign: 'center', padding: `${T.space.sm}px 0` }}>{STORE_NAME}</div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs }}>
        {navViews.map((v) => {
          const on = view === v;
          return (
            <button key={v} onClick={() => setView(v)}
              style={{
                display: 'flex', alignItems: 'center', gap: T.space.md,
                width: '100%', height: 52, padding: `0 ${T.space.md}px`, borderRadius: T.radius.md, cursor: 'pointer', fontFamily: 'inherit',
                border: 'none', background: on ? C.accentSoft : C.panel,
                color: on ? C.accent : C.dim, fontWeight: 600, fontSize: T.font.lg, transition: 'background .12s, color .12s',
              }}>
              <span style={{ fontSize: T.font.xl, lineHeight: 1 }}>{VIEW_ICONS[v]}</span>
              <span>{VIEW_LABELS[v]}</span>
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm, borderTop: `1px solid ${C.line}`, paddingTop: T.space.md }}>
        {canSeeStock && <NotificationsBell />}
        <ClockButton />
        <div style={{ display: 'flex', gap: T.space.sm }}>
          <button onClick={() => setPref('dukkan_lang', ARABIC ? 'en' : 'ar')} style={{ ...S.btnGhost, flex: 1, height: 40, fontSize: T.font.sm }}>{ARABIC ? 'English' : 'عربية'}</button>
          <button onClick={() => setPref('dukkan_theme', THEME === 'dark' ? 'light' : 'dark')} style={{ ...S.btnGhost, flex: 1, height: 40, fontSize: T.font.sm }}>{THEME === 'dark' ? (ARABIC ? '☀️ فاتح' : '☀️ Light') : (ARABIC ? '🌙 داكن' : '🌙 Dark')}</button>
        </div>
        <div style={{ fontSize: T.font.sm, color: C.dim, textAlign: 'center' }}>{user.full_name || user.username}</div>
        <button onClick={onLogout} style={{ ...S.btnGhost, height: 48, fontSize: T.font.base }}>{ARABIC ? '🚪 خروج' : '🚪 Logout'}</button>
      </div>
    </aside>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// On-screen keyboard (touch screens) — drives whichever field is active.
// ══════════════════════════════════════════════════════════════════════════════
function OnScreenKeyboard({ onKey, onBackspace, onEnter, onClose }) {
  const [mode, setMode] = useState('num');   // 'num' (default) | 'abc'
  const [caps, setCaps] = useState(false);
  const key = (label, onTap, flex = 1, extra = {}) => (
    <button key={label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={onTap}
      style={{ flex, minWidth: 0, height: 56, borderRadius: T.radius.md, border: `1px solid ${C.line}`, background: C.panel2, color: C.text, fontSize: T.font.xl, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', userSelect: 'none', ...extra }}>
      {label}
    </button>
  );
  const toggleKey = key(mode === 'num' ? 'ABC' : '123', () => setMode((m) => (m === 'num' ? 'abc' : 'num')), 1.4, { color: C.dim, fontSize: T.font.lg });
  const bottomRow = (
    <div style={{ display: 'flex', gap: 8 }}>
      {key(ARABIC ? 'إغلاق' : 'Hide', onClose, 1.4, { color: C.dim, fontSize: T.font.lg })}
      {key('␣', () => onKey(' '), 4)}
      {key(ARABIC ? 'دخول' : 'Enter', onEnter, 2, { background: C.accent, color: C.accentText, fontSize: T.font.lg })}
    </div>
  );

  if (mode === 'num') {
    const cell = (ch) => key(ch, () => onKey(ch));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>{r.map(cell)}</div>
        ))}
        <div style={{ display: 'flex', gap: 8 }}>
          {toggleKey}
          {cell('0')}
          {key('⌫', onBackspace, 1.4, { background: C.red, color: C.onColor })}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 8 }}>
          {i === 3 && key(caps ? '⇧' : '⇪', () => setCaps((c) => !c), 1.4, caps ? { background: C.accent, color: C.accentText } : {})}
          {r.map(cell)}
          {i === 3 && key('⌫', onBackspace, 1.4, { background: C.red, color: C.onColor })}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        {toggleKey}
        {key('␣', () => onKey(' '), 4)}
        {key(ARABIC ? 'دخول' : 'Enter', onEnter, 2, { background: C.accent, color: C.accentText, fontSize: T.font.lg })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Login
// ══════════════════════════════════════════════════════════════════════════════
function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState('username');   // which field the keyboard types into
  const [kb, setKb] = useState(true);                 // on-screen keyboard visible

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const u = await api.post('/auth/login', { username, password });
      onLogin(u);
    } catch (ex) {
      setErr(ARABIC ? 'اسم المستخدم أو كلمة المرور غير صحيحة' : 'Invalid username or password');
    } finally { setBusy(false); }
  };

  const setActiveValue = (fn) => (active === 'username' ? setUsername(fn) : setPassword(fn));
  const onKey = (ch) => setActiveValue((v) => v + ch);
  const onBackspace = () => setActiveValue((v) => v.slice(0, -1));

  const fieldStyle = (name) => ({ ...S.input, fontSize: T.font.lg, padding: `${T.space.md}px ${T.space.lg}px`, ...(active === name && kb ? { borderColor: C.accent, boxShadow: `0 0 0 3px ${C.accent}40` } : {}) });

  const bg = (process.env.PUBLIC_URL || '') + '/login-bg.png';
  return (
    <div dir="ltr" style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      fontFamily: T.font.family, padding: 'clamp(16px, 4vw, 64px)',
      backgroundImage: `linear-gradient(90deg, ${C.bg}00 0%, ${C.bg}59 45%, ${C.bg}F2 100%), url(${bg})`,
      backgroundSize: 'cover', backgroundPosition: 'center',
    }}>
      <form onSubmit={submit} dir={ARABIC ? 'rtl' : 'ltr'} style={{ ...S.card, width: 'min(94vw, 440px)', display: 'flex', flexDirection: 'column', gap: T.space.md, padding: T.space.xl, backdropFilter: 'blur(8px)', background: `${C.panel}F2`, boxShadow: T.shadow.lg }}>
        <div style={{ fontWeight: 700, fontSize: T.font.display, color: C.text, letterSpacing: '-0.02em', textAlign: 'center' }}>{STORE_NAME}</div>
        <div style={{ color: C.dim, fontSize: T.font.base, textAlign: 'center', marginTop: -T.space.sm }}>{ARABIC ? 'تسجيل الدخول' : 'Sign in'}</div>
        <input style={fieldStyle('username')} placeholder={ARABIC ? 'اسم المستخدم' : 'Username'} value={username}
          onChange={(e) => setUsername(e.target.value)} onFocus={() => { setActive('username'); setKb(true); }}
          autoFocus autoCapitalize="off" autoComplete="off" />
        <input style={fieldStyle('password')} type="password" placeholder={ARABIC ? 'كلمة المرور' : 'Password'} value={password}
          onChange={(e) => setPassword(e.target.value)} onFocus={() => { setActive('password'); setKb(true); }} autoComplete="off" />
        {err && <div style={{ color: C.red, fontSize: T.font.sm }}>{err}</div>}
        {process.env.REACT_APP_DEMO === '1' && (
          <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: T.radius.md, padding: T.space.md, fontSize: T.font.sm, color: C.dim, textAlign: 'center' }}>
            DEMO — no backend. Sign in: <b style={{ color: C.accent }}>admin</b> / any password<br />or <b style={{ color: C.accent }}>cashier</b> (limited views). Data is local to your browser.
          </div>
        )}
        <button type="submit" disabled={busy} style={{ ...S.btn, padding: `${T.space.lg}px`, fontSize: T.font.lg, opacity: busy ? 0.6 : 1 }}>{busy ? '…' : (ARABIC ? 'دخول' : 'Login')}</button>
        {!kb && <button type="button" onClick={() => setKb(true)} style={{ ...S.btnGhost, padding: `${T.space.md}px` }}>{ARABIC ? 'إظهار لوحة المفاتيح' : 'Show keyboard'}</button>}
        {kb && <OnScreenKeyboard onKey={onKey} onBackspace={onBackspace} onEnter={submit} onClose={() => setKb(false)} />}
        <div style={{ display: 'flex', gap: T.space.sm }}>
          <button type="button" onClick={() => setPref('dukkan_lang', ARABIC ? 'en' : 'ar')} style={{ ...S.btnGhost, flex: 1, padding: `${T.space.sm}px`, fontSize: T.font.sm }}>{ARABIC ? 'English' : 'عربية'}</button>
          <button type="button" onClick={() => setPref('dukkan_theme', THEME === 'dark' ? 'light' : 'dark')} style={{ ...S.btnGhost, flex: 1, padding: `${T.space.sm}px`, fontSize: T.font.sm }}>{THEME === 'dark' ? (ARABIC ? '☀️ فاتح' : '☀️ Light') : (ARABIC ? '🌙 داكن' : '🌙 Dark')}</button>
        </div>
      </form>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Sales — scan → cart → checkout
// ══════════════════════════════════════════════════════════════════════════════
const HELD_KEY = 'dukkan_held_sales';
function SalesView({ user, notify }) {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);          // [{id,barcode,name,price,qty}]
  const [scan, setScan] = useState('');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [pay, setPay] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [newProduct, setNewProduct] = useState(null); // {barcode} → modal
  const [editLine, setEditLine] = useState(null);      // cart line → qty/price keypad
  const [quickItem, setQuickItem] = useState(false);   // open-price misc item modal
  const [weighItem, setWeighItem] = useState(null);    // kg product → weight keypad
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(() => { try { return JSON.parse(localStorage.getItem(HELD_KEY)) || []; } catch (_) { return []; } });
  const [showHeld, setShowHeld] = useState(false);
  const scanRef = useRef(null);

  const loadProducts = useCallback(async () => {
    try { setProducts(await api.get('/products')); } catch (_) {}
  }, []);
  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { scanRef.current && scanRef.current.focus(); }, []);
  const persistHeld = (list) => { setHeld(list); localStorage.setItem(HELD_KEY, JSON.stringify(list)); };

  const addToCart = useCallback((p, qty = 1) => {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.id === p.id);
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], qty: next[i].qty + qty }; return next; }
      return [...prev, { id: p.id, barcode: p.barcode, name: p.name, price: Number(p.price) || 0, qty, unit: p.unit || 'ea' }];
    });
  }, []);
  const refocus = () => scanRef.current && scanRef.current.focus();

  // Add a catalogue product: weighed (kg) products open the weight keypad; others add directly.
  const addProduct = (p) => {
    if (p.unit === 'kg') { setWeighItem(p); return; }
    addToCart(p); refocus();
  };

  const onScan = async (code) => {
    const c = String(code || '').trim();
    if (!c) return;
    setScan('');
    const local = products.find((p) => p.barcode && p.barcode === c);
    if (local) { addProduct(local); return; }
    try {
      const p = await api.get('/products/barcode/' + encodeURIComponent(c));
      setProducts((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
      addProduct(p);
    } catch (ex) {
      if (ex.status === 404) setNewProduct({ barcode: c });
      else notify(ARABIC ? 'تعذّر البحث' : 'Lookup failed', 'red');
    }
  };

  const setQty = (id, qty) => setCart((prev) => prev.flatMap((l) => (l.id === id ? (qty <= 0 ? [] : [{ ...l, qty }]) : [l])));
  const setLine = (id, patch) => setCart((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setCart((prev) => prev.filter((l) => l.id !== id));
  const addCustom = ({ name, price, qty }) => setCart((prev) => [...prev, { id: 'misc-' + uid(), barcode: null, name, price: Number(price) || 0, qty: Number(qty) || 1, custom: true }]);

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const change = pay === 'cash' && tendered ? (Number(tendered) - total) : null;

  // Push the live cart to the customer-facing display (2nd screen).
  useEffect(() => {
    const payload = { items: cart.map((l) => ({ name: l.name, price: l.price, qty: l.qty })), total, change, store: STORE_NAME };
    try { localStorage.setItem('dukkan_display', JSON.stringify(payload)); } catch (_) {}
    try { const bc = new BroadcastChannel(BC_NAME); bc.postMessage(payload); bc.close(); } catch (_) {}
  }, [cart, total, change]);
  const openDisplay = () => window.open(window.location.pathname + '?display=1', 'dukkan_customer', 'width=900,height=700');

  // Hold the current cart for later; clear the screen for the next customer.
  const holdSale = () => {
    if (!cart.length) return;
    persistHeld([...held, { id: uid(), items: cart, total, ts: new Date().toLocaleTimeString().slice(0, 5) }]);
    setCart([]); setTendered('');
    notify(ARABIC ? 'تم تعليق الفاتورة' : 'Sale held', 'green');
  };
  const resumeSale = (h) => {
    if (cart.length && !window.confirm(ARABIC ? 'استبدال الفاتورة الحالية؟' : 'Replace current bill?')) return;
    setCart(h.items); persistHeld(held.filter((x) => x.id !== h.id)); setShowHeld(false);
  };

  const checkout = async () => {
    if (!cart.length || busy) return;
    setBusy(true);
    try {
      const invoice_no = await api.get('/invoice/next?floor=' + DEFAULT_FLOOR);
      const { date, time } = nowParts();
      const sale = { id: uid(), floor: DEFAULT_FLOOR, items: cart, sub: total, tax: 0, svc: 0, disc: 0, total, pay, waiter: user.username, status: 'paid', date, time, invoice_no };
      await api.post('/orders', sale);
      // Only deduct stock for real catalogue products (numeric id); custom/open-price lines have string ids.
      await Promise.all(cart.filter((l) => typeof l.id === 'number').map((l) => api.patch('/products/' + l.id + '/stock', { delta: -l.qty }).catch(() => {})));
      api.post('/stock-log', { kind: 'sale', changed_by: user.username, name: `invoice ${invoice_no}`, new_qty: cart.length }).catch(() => {});
      printReceipt(sale);
      setCart([]); setTendered(''); setPay('cash');
      loadProducts();
      notify(ARABIC ? `تمت الفاتورة #${invoice_no}` : `Sale #${invoice_no} done`, 'green');
      scanRef.current && scanRef.current.focus();
    } catch (ex) {
      notify(ex.message === 'invoice_taken' ? (ARABIC ? 'تعارض رقم الفاتورة، أعد المحاولة' : 'Invoice clash — retry') : (ARABIC ? 'فشل الدفع' : 'Checkout failed'), 'red');
    } finally { setBusy(false); }
  };

  // Product tiles: filter by category chip + optional name/barcode search.
  const cats = ['all', ...Array.from(new Set(products.map((p) => p.cat).filter(Boolean)))];
  const tiles = products.filter((p) => {
    if (cat !== 'all' && p.cat !== cat) return false;
    if (search.trim()) { const q = search.toLowerCase(); return (p.name || '').toLowerCase().includes(q) || (p.barcode || '').includes(search); }
    return true;
  });

  return (
    <div dir="ltr" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      {/* Left: scan + tap-to-add product tiles */}
      <div dir={ARABIC ? 'rtl' : 'ltr'} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input ref={scanRef} style={{ ...S.input, fontSize: T.font.lg, padding: `${T.space.md}px ${T.space.lg}px`, letterSpacing: 1 }}
            value={scan} onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onScan(scan); }}
            placeholder={ARABIC ? '🔍 امسح الباركود أو اضغط منتجاً' : '🔍 Scan barcode or tap a product'} inputMode="search" />
          <button onClick={() => setQuickItem(true)} style={{ ...S.btnGhost, whiteSpace: 'nowrap', fontSize: T.font.base }}>
            ＋ {ARABIC ? 'صنف يدوي' : 'Quick item'}
          </button>
          <button onClick={openDisplay} title={ARABIC ? 'شاشة الزبون' : 'Customer screen'} style={{ ...S.btnGhost, whiteSpace: 'nowrap', fontSize: T.font.base }}>🖥</button>
          {!!held.length && (
            <button onClick={() => setShowHeld(true)} style={{ ...S.btnGhost, whiteSpace: 'nowrap', fontSize: T.font.base }}>
              ⏸ {ARABIC ? 'المعلّقة' : 'Held'} ({held.length})
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)} style={{ ...S.btnGhost, padding: `${T.space.sm}px ${T.space.lg}px`, borderRadius: T.radius.pill, fontSize: T.font.base, ...(cat === c ? { background: C.accent, color: C.accentText, borderColor: C.accent } : {}) }}>
              {c === 'all' ? (ARABIC ? 'الكل' : 'All') : c}
            </button>
          ))}
        </div>

        <input style={S.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={ARABIC ? 'ابحث بالاسم أو الباركود…' : 'Search by name or barcode…'} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: T.space.md, alignContent: 'start' }}>
          {tiles.map((p) => (
            <button key={p.id} onClick={() => addProduct(p)} style={{
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: T.space.sm, height: 112, padding: T.space.md,
              borderRadius: T.radius.lg, border: `1px solid ${C.line}`, background: C.panel, color: C.text, cursor: 'pointer',
              textAlign: 'start', fontFamily: 'inherit', boxShadow: T.shadow.sm,
            }}>
              <span style={{ fontSize: T.font.base, fontWeight: 600, lineHeight: 1.3 }}>{p.name}{p.unit === 'kg' ? ' ⚖' : ''}</span>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.text, fontWeight: 700, fontSize: T.font.lg, ...T.num }}>{money(p.price)}{p.unit === 'kg' ? (ARABIC ? '/كغ' : '/kg') : ''}</span>
                {Number(p.stock) <= 5 && <span style={{ fontSize: T.font.xs, color: C.red, fontWeight: 700, ...T.num }}>● {Number(p.stock)}</span>}
              </span>
            </button>
          ))}
          {!tiles.length && <div style={{ color: C.dim, fontSize: T.font.base, gridColumn: '1/-1', padding: T.space.xl, textAlign: 'center' }}>{ARABIC ? 'لا منتجات — أضفها من المخزون' : 'No products — add them in Inventory'}</div>}
        </div>
      </div>

      {/* Right: bill */}
      <div dir={ARABIC ? 'rtl' : 'ltr'} style={{ ...S.card, flex: '0 0 400px', width: 400, position: 'sticky', top: T.space.lg }}>
        <div style={{ fontWeight: 700, fontSize: T.font.lg, marginBottom: T.space.md }}>🧾 {ARABIC ? 'الفاتورة' : 'Bill'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.xs, maxHeight: '42vh', overflow: 'auto' }}>
          {!cart.length && <div style={{ color: C.dim, fontSize: T.font.base, padding: `${T.space.xl}px 0`, textAlign: 'center' }}>{ARABIC ? 'اضغط أو امسح منتجاً للبدء' : 'Tap or scan a product to start'}</div>}
          {cart.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: T.space.sm, padding: `${T.space.sm}px 0`, borderBottom: `1px solid ${C.line}` }}>
              <button onClick={() => setEditLine(l)} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', textAlign: 'start', cursor: 'pointer', color: C.text, fontFamily: 'inherit', padding: 0 }}>
                <div style={{ fontSize: T.font.base, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name} <span style={{ fontSize: T.font.xs, color: C.dim }}>✎</span></div>
                <div style={{ fontSize: T.font.sm, color: C.dim, fontWeight: 500, ...T.num }}>{money(l.price)} × {l.qty} = {money(l.price * l.qty)}</div>
              </button>
              <button onClick={() => setQty(l.id, l.qty - 1)} style={qtyBtn}>−</button>
              <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 700, fontSize: T.font.lg, ...T.num }}>{l.qty}</span>
              <button onClick={() => setQty(l.id, l.qty + 1)} style={qtyBtn}>+</button>
              <button onClick={() => removeLine(l.id)} style={{ ...qtyBtn, color: C.red }}>×</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: `${T.space.lg}px 0` }}>
          <span style={{ fontSize: T.font.lg, fontWeight: 600, color: C.dim }}>{ARABIC ? 'المجموع' : 'Total'}</span><span style={{ fontSize: T.font.hero, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, ...T.num }}>{money(total)}</span>
        </div>
        <div style={{ display: 'flex', gap: T.space.sm, marginBottom: T.space.md }}>
          {['cash', 'card'].map((m) => (
            <button key={m} onClick={() => setPay(m)} style={{ ...S.btnGhost, flex: 1, padding: `${T.space.md}px`, fontSize: T.font.lg, ...(pay === m ? { background: C.accent, color: C.accentText, borderColor: C.accent } : {}) }}>
              {m === 'cash' ? (ARABIC ? '💵 نقدي' : '💵 Cash') : (ARABIC ? '💳 بطاقة' : '💳 Card')}
            </button>
          ))}
        </div>
        {pay === 'cash' && (
          <div style={{ marginBottom: T.space.md }}>
            <input style={{ ...S.input, fontSize: T.font.lg, padding: `${T.space.md}px ${T.space.lg}px`, ...T.num }} type="number" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={ARABIC ? 'المبلغ المدفوع' : 'Cash given'} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: T.space.sm, marginTop: T.space.sm }}>
              <button onClick={() => setTendered(String(total.toFixed(3)))} style={{ ...S.btnGhost, padding: `${T.space.md}px`, fontWeight: 600 }}>{ARABIC ? 'بالضبط' : 'Exact'}</button>
              {[1, 5, 10, 20, 50].map((d) => (
                <button key={d} onClick={() => setTendered(String(d))} style={{ ...S.btnGhost, padding: `${T.space.md}px`, fontWeight: 600, ...T.num }}>{d}</button>
              ))}
            </div>
            {change != null && change >= 0 && <div style={{ color: C.green, fontSize: T.font.lg, marginTop: T.space.sm, fontWeight: 700, ...T.num }}>{ARABIC ? 'الباقي' : 'Change'}: {money(change)}</div>}
            {change != null && change < 0 && <div style={{ color: C.red, fontSize: T.font.base, marginTop: T.space.sm, fontWeight: 600, ...T.num }}>{ARABIC ? 'ناقص' : 'Short'}: {money(-change)}</div>}
          </div>
        )}
        <button onClick={checkout} disabled={!cart.length || busy} style={{ ...S.btn, width: '100%', padding: `${T.space.lg}px`, fontSize: T.font.xl, fontWeight: 700, opacity: (!cart.length || busy) ? 0.5 : 1 }}>
          {busy ? '…' : (ARABIC ? '✓ إتمام وطباعة' : '✓ Pay & Print')}
        </button>
        {!!cart.length && (
          <div style={{ display: 'flex', gap: T.space.sm, marginTop: T.space.sm }}>
            <button onClick={holdSale} style={{ ...S.btnGhost, flex: 1, padding: `${T.space.md}px` }}>⏸ {ARABIC ? 'تعليق' : 'Hold'}</button>
            <button onClick={() => { setCart([]); setTendered(''); }} style={{ ...S.btnGhost, flex: 1, padding: `${T.space.md}px`, color: C.red }}>✕ {ARABIC ? 'إلغاء' : 'Clear'}</button>
          </div>
        )}
      </div>

      {newProduct && (
        <ProductModal initial={newProduct} notify={notify}
          onClose={() => { setNewProduct(null); scanRef.current && scanRef.current.focus(); }}
          onSaved={(p) => { setProducts((prev) => [...prev, p]); addToCart(p); setNewProduct(null); scanRef.current && scanRef.current.focus(); }} />
      )}

      {showHeld && (
        <Overlay onClose={() => setShowHeld(false)}>
          <div style={{ ...S.card, width: 360, display: 'flex', flexDirection: 'column', gap: T.space.sm, boxShadow: T.shadow.lg }}>
            <div style={{ fontWeight: 700, fontSize: T.font.lg }}>⏸ {ARABIC ? 'الفواتير المعلّقة' : 'Held sales'}</div>
            {!held.length && <div style={{ color: C.dim }}>{ARABIC ? 'لا شيء' : 'None'}</div>}
            {held.map((h) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: T.space.sm, padding: `${T.space.sm}px 0`, borderBottom: `1px solid ${C.line}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, ...T.num }}>{money(h.total)} <span style={{ color: C.dim, fontSize: T.font.xs, fontWeight: 500 }}>· {h.items.length} {ARABIC ? 'صنف' : 'items'} · {h.ts}</span></div>
                </div>
                <button onClick={() => resumeSale(h)} style={{ ...S.btn, padding: `${T.space.sm}px ${T.space.lg}px` }}>{ARABIC ? 'استئناف' : 'Resume'}</button>
                <button onClick={() => persistHeld(held.filter((x) => x.id !== h.id))} style={{ ...S.btnGhost, padding: `${T.space.sm}px ${T.space.md}px`, color: C.red }}>×</button>
              </div>
            ))}
          </div>
        </Overlay>
      )}

      {editLine && (
        <LineEditModal line={editLine}
          onClose={() => setEditLine(null)}
          onApply={(qty, price) => { if (qty <= 0) removeLine(editLine.id); else setLine(editLine.id, { qty, price }); setEditLine(null); }}
          onRemove={() => { removeLine(editLine.id); setEditLine(null); }} />
      )}
      {quickItem && (
        <QuickItemModal notify={notify} onClose={() => setQuickItem(false)}
          onAdd={(it) => { addCustom(it); setQuickItem(false); }} />
      )}
      {weighItem && (
        <WeightModal product={weighItem} notify={notify}
          onClose={() => { setWeighItem(null); refocus(); }}
          onAdd={(kg) => { addToCart(weighItem, kg); setWeighItem(null); refocus(); }} />
      )}
    </div>
  );
}

// ── Weighed item: enter weight in kg on a keypad; line qty = weight, price = per-kg ──
function WeightModal({ product, onClose, onAdd, notify }) {
  const [kg, setKg] = useState('');
  const onKey = (ch) => setKg((v) => (ch === '.' && v.includes('.') ? v : v + ch));
  const w = Number(kg) || 0;
  const submit = () => { if (!(w > 0)) { notify(ARABIC ? 'أدخل الوزن' : 'Enter weight', 'red'); return; } onAdd(w); };
  return (
    <Overlay onClose={onClose}>
      <div style={{ ...S.card, width: 320, display: 'flex', flexDirection: 'column', gap: T.space.md, boxShadow: T.shadow.lg }}>
        <div style={{ fontWeight: 700, fontSize: T.font.lg }}>⚖ {product.name}</div>
        <div style={{ color: C.dim, fontSize: T.font.sm, ...T.num }}>{money(product.price)}{ARABIC ? ' / كغ' : ' / kg'}</div>
        <div style={{ ...S.input, background: C.panel2, fontSize: T.font.display, fontWeight: 700, textAlign: 'center', ...T.num }}>{kg || '0'} {ARABIC ? 'كغ' : 'kg'}</div>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: T.font.xl, ...T.num }}>= {money(w * (Number(product.price) || 0))}</div>
        <NumPad onKey={onKey} onClear={() => setKg('')} onBackspace={() => setKg((v) => v.slice(0, -1))} />
        <button onClick={submit} style={{ ...S.btn, padding: `${T.space.md}px`, fontSize: T.font.lg }}>{ARABIC ? 'إضافة للفاتورة' : 'Add to bill'}</button>
      </div>
    </Overlay>
  );
}
const qtyBtn = { width: 42, height: 42, borderRadius: T.radius.md, border: `1px solid ${C.line}`, background: C.panel, color: C.text, fontSize: T.font.xl, lineHeight: '1', cursor: 'pointer', fontWeight: 600 };

// ── Numeric keypad (touch) — drives a numeric string field ──────────────────────
function NumPad({ onKey, onClear, onBackspace }) {
  const k = (label, fn, extra = {}) => (
    <button key={label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={fn}
      style={{ height: 56, borderRadius: T.radius.md, border: `1px solid ${C.line}`, background: C.panel2, color: C.text, fontSize: T.font.xl, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', ...T.num, ...extra }}>{label}</button>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: T.space.sm }}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => k(d, () => onKey(d)))}
      {k('.', () => onKey('.'))}
      {k('0', () => onKey('0'))}
      {k('⌫', onBackspace, { background: C.red, color: C.onColor })}
      {k('C', onClear, { gridColumn: '1 / -1', background: C.line, color: C.dim })}
    </div>
  );
}

// ── Edit a cart line: set quantity + override price via keypad ───────────────────
function LineEditModal({ line, onClose, onApply, onRemove }) {
  const [field, setField] = useState('qty');
  const [qty, setQty] = useState(String(line.qty));
  const [price, setPrice] = useState(String(line.price));
  const set = field === 'qty' ? setQty : setPrice;
  const onKey = (ch) => set((v) => (ch === '.' && v.includes('.') ? v : (v === '0' && ch !== '.' ? ch : v + ch)));
  const tab = (name, label, val) => (
    <button type="button" onClick={() => setField(name)} style={{ flex: 1, padding: `${T.space.md}px`, borderRadius: T.radius.md, border: `1px solid ${field === name ? C.accent : C.line}`, background: field === name ? C.accent : C.panel2, color: field === name ? C.accentText : C.text, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
      <div style={{ fontSize: T.font.xs }}>{label}</div><div style={{ fontSize: T.font.lg, fontWeight: 700, ...T.num }}>{val || '0'}</div>
    </button>
  );
  return (
    <Overlay onClose={onClose}>
      <div style={{ ...S.card, width: 320, display: 'flex', flexDirection: 'column', gap: T.space.md, boxShadow: T.shadow.lg }}>
        <div style={{ fontWeight: 700, fontSize: T.font.lg }}>{line.name}</div>
        <div style={{ display: 'flex', gap: T.space.sm }}>
          {tab('qty', ARABIC ? 'الكمية' : 'Qty', qty)}
          {tab('price', ARABIC ? 'السعر' : 'Price', price)}
        </div>
        <NumPad onKey={onKey} onClear={() => set('')} onBackspace={() => set((v) => v.slice(0, -1))} />
        <div style={{ display: 'flex', gap: T.space.sm }}>
          <button onClick={() => onApply(Number(qty) || 0, Number(price) || 0)} style={{ ...S.btn, flex: 1, padding: `${T.space.md}px`, fontSize: T.font.lg }}>{ARABIC ? 'حفظ' : 'Save'}</button>
          <button onClick={onRemove} style={{ ...S.btnGhost, padding: `${T.space.md}px`, color: C.red }}>{ARABIC ? 'حذف' : 'Remove'}</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Open-price "misc" item: type a name + price for something with no barcode ────
function QuickItemModal({ onClose, onAdd, notify }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const onKey = (ch) => setPrice((v) => (ch === '.' && v.includes('.') ? v : v + ch));
  const submit = () => {
    if (!name.trim()) { notify(ARABIC ? 'الاسم مطلوب' : 'Name required', 'red'); return; }
    if (!(Number(price) > 0)) { notify(ARABIC ? 'السعر مطلوب' : 'Price required', 'red'); return; }
    onAdd({ name: name.trim(), price: Number(price), qty: 1 });
  };
  return (
    <Overlay onClose={onClose}>
      <div style={{ ...S.card, width: 320, display: 'flex', flexDirection: 'column', gap: T.space.md, boxShadow: T.shadow.lg }}>
        <div style={{ fontWeight: 700, fontSize: T.font.lg }}>{ARABIC ? 'صنف يدوي' : 'Quick item'}</div>
        <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder={ARABIC ? 'الاسم' : 'Name'} autoFocus />
        <div style={{ ...S.input, background: C.panel2, fontSize: T.font.xl, fontWeight: 700, textAlign: 'center', ...T.num }}>{price || '0'}</div>
        <NumPad onKey={onKey} onClear={() => setPrice('')} onBackspace={() => setPrice((v) => v.slice(0, -1))} />
        <button onClick={submit} style={{ ...S.btn, padding: `${T.space.md}px`, fontSize: T.font.lg }}>{ARABIC ? 'إضافة للفاتورة' : 'Add to bill'}</button>
      </div>
    </Overlay>
  );
}

// ── Add/Edit product modal (shared by Sales quick-add + Inventory) ──────────────
function ProductModal({ initial, onClose, onSaved, notify, editing }) {
  const [barcode, setBarcode] = useState(initial.barcode || '');
  const [name, setName] = useState(initial.name || '');
  const [price, setPrice] = useState(initial.price != null ? String(initial.price) : '');
  const [cat, setCat] = useState(initial.cat || '');
  const [stock, setStock] = useState(initial.stock != null ? String(initial.stock) : '');
  const [cost, setCost] = useState(initial.cost != null ? String(initial.cost) : '');
  const [unit, setUnit] = useState(initial.unit === 'kg' ? 'kg' : 'ea');
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    api.get('/settings/categories').then((r) => {
      try { setCats(r && r.value ? JSON.parse(r.value) : []); } catch (_) {}
    }).catch(() => {});
    nameRef.current && nameRef.current.focus();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) { notify(ARABIC ? 'الاسم مطلوب' : 'Name required', 'red'); return; }
    setBusy(true);
    const body = { barcode: barcode.trim() || null, name: name.trim(), price: Number(price) || 0, cat: cat || null, cost: Number(cost) || 0, stock: Number(stock) || 0, unit };
    try {
      if (editing) {
        await api.put('/products/' + initial.id, body);
        onSaved({ ...initial, ...body });
      } else {
        const p = await api.post('/products', body);
        onSaved(p);
      }
    } catch (ex) {
      notify(ex.message === 'exists' ? (ARABIC ? 'باركود مكرر' : 'Barcode already exists') : (ARABIC ? 'فشل الحفظ' : 'Save failed'), 'red');
    } finally { setBusy(false); }
  };

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={save} style={{ ...S.card, width: 360, display: 'flex', flexDirection: 'column', gap: T.space.md, boxShadow: T.shadow.lg }}>
        <div style={{ fontWeight: 700, fontSize: T.font.lg }}>{editing ? (ARABIC ? 'تعديل منتج' : 'Edit product') : (ARABIC ? 'منتج جديد' : 'New product')}</div>
        <Field label={ARABIC ? 'الباركود' : 'Barcode'}><input style={S.input} value={barcode} onChange={(e) => setBarcode(e.target.value)} /></Field>
        <Field label={ARABIC ? 'الاسم' : 'Name'}><input ref={nameRef} style={S.input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={ARABIC ? 'تباع بـ' : 'Sold by'}>
          <div style={{ display: 'flex', gap: T.space.sm }}>
            {[['ea', ARABIC ? 'بالقطعة' : 'Each'], ['kg', ARABIC ? 'بالوزن (كغ)' : 'Weight (kg)']].map(([v, lbl]) => (
              <button key={v} type="button" onClick={() => setUnit(v)} style={{ ...S.btnGhost, flex: 1, padding: `${T.space.md}px`, ...(unit === v ? { background: C.accent, color: C.accentText, borderColor: C.accent } : {}) }}>{lbl}</button>
            ))}
          </div>
        </Field>
        <div style={{ display: 'flex', gap: T.space.md }}>
          <Field label={unit === 'kg' ? (ARABIC ? 'السعر / كغ' : 'Price / kg') : (ARABIC ? 'السعر' : 'Price')}><input style={S.input} type="number" step="0.001" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label={ARABIC ? 'الكمية' : 'Stock'}><input style={S.input} type="number" step="0.001" value={stock} onChange={(e) => setStock(e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', gap: T.space.md }}>
          <Field label={ARABIC ? 'الفئة' : 'Category'}>
            <input style={S.input} list="cats" value={cat} onChange={(e) => setCat(e.target.value)} />
            <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label={ARABIC ? 'التكلفة' : 'Cost'}><input style={S.input} type="number" step="0.001" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', gap: T.space.sm, marginTop: T.space.sm }}>
          <button type="submit" disabled={busy} style={{ ...S.btn, flex: 1, opacity: busy ? 0.6 : 1 }}>{ARABIC ? 'حفظ' : 'Save'}</button>
          <button type="button" onClick={onClose} style={S.btnGhost}>{ARABIC ? 'إلغاء' : 'Cancel'}</button>
        </div>
      </form>
    </Overlay>
  );
}
function Field({ label, children }) {
  return <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: T.space.xs, fontSize: T.font.xs, color: C.dim, fontWeight: 600 }}>{label}{children}</label>;
}
function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: C.scrim, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: T.space.lg }}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Inventory
// ══════════════════════════════════════════════════════════════════════════════
function InventoryView({ isAdmin, notify }) {
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);  // product or {} for new
  const load = useCallback(() => api.get('/products').then(setProducts).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const remove = async (p) => {
    if (!window.confirm((ARABIC ? 'حذف ' : 'Delete ') + p.name + '?')) return;
    try { await api.del('/products/' + p.id); setProducts((prev) => prev.filter((x) => x.id !== p.id)); }
    catch (ex) { notify(ARABIC ? 'فشل الحذف' : 'Delete failed', 'red'); }
  };

  const rows = q.trim()
    ? products.filter((p) => (p.name || '').toLowerCase().includes(q.toLowerCase()) || (p.barcode || '').includes(q))
    : products;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.lg }}>
      <div style={{ display: 'flex', gap: T.space.md, alignItems: 'center' }}>
        <input style={{ ...S.input, flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={ARABIC ? 'بحث عن منتج' : 'Search products'} />
        <button onClick={() => setEditing({})} style={S.btn}>{ARABIC ? '+ منتج' : '+ Product'}</button>
      </div>
      <div style={S.card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: T.font.base }}>
          <thead><tr style={{ color: C.dim, background: C.panel2, textAlign: ARABIC ? 'right' : 'left' }}>
            <th style={th}>{ARABIC ? 'الاسم' : 'Name'}</th><th style={th}>{ARABIC ? 'الباركود' : 'Barcode'}</th>
            <th style={th}>{ARABIC ? 'الفئة' : 'Category'}</th><th style={{ ...th, textAlign: 'right' }}>{ARABIC ? 'السعر' : 'Price'}</th>
            <th style={{ ...th, textAlign: 'right' }}>{ARABIC ? 'المخزون' : 'Stock'}</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                <td style={{ ...td, color: C.dim, fontFamily: 'monospace', fontSize: T.font.sm }}>{p.barcode || '—'}</td>
                <td style={{ ...td, color: C.dim }}>{p.cat || '—'}</td>
                <td style={{ ...td, textAlign: 'right', ...T.num }}>{money(p.price)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, ...T.num, color: Number(p.stock) <= 5 ? C.red : C.text }}>{Number(p.stock)}</td>
                <td style={{ ...td, textAlign: 'end', whiteSpace: 'nowrap' }}>
                  <button onClick={() => setEditing(p)} style={{ ...S.btnGhost, padding: `${T.space.xs}px ${T.space.md}px` }}>{ARABIC ? 'تعديل' : 'Edit'}</button>
                  {isAdmin && <button onClick={() => remove(p)} style={{ ...S.btnGhost, padding: `${T.space.xs}px ${T.space.md}px`, color: C.red, marginInlineStart: T.space.sm }}>{ARABIC ? 'حذف' : 'Del'}</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} style={{ ...td, color: C.dim, textAlign: 'center', padding: T.space.xl }}>{ARABIC ? 'لا منتجات' : 'No products'}</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && (
        <ProductModal initial={editing} editing={!!editing.id} notify={notify}
          onClose={() => setEditing(null)}
          onSaved={(p) => { setProducts((prev) => { const i = prev.findIndex((x) => x.id === p.id); return i >= 0 ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]; }); setEditing(null); }} />
      )}
    </div>
  );
}
const th = { padding: `${T.space.sm}px`, fontWeight: 600, fontSize: T.font.sm };
const td = { padding: `${T.space.md}px ${T.space.sm}px` };

// ══════════════════════════════════════════════════════════════════════════════
// Receive — restock with supplier + expiry (creates a batch, bumps stock)
// ══════════════════════════════════════════════════════════════════════════════
function ReceiveView({ isAdmin, notify }) {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [form, setForm] = useState({ product_id: '', supplier_id: '', qty: '', cost: '', expiry: '' });
  const [newSup, setNewSup] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/products').then(setProducts).catch(() => {});
    api.get('/suppliers').then(setSuppliers).catch(() => {});
    api.get('/batches').then(setBatches).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const receive = async () => {
    if (!form.product_id || !(Number(form.qty) > 0)) { notify(ARABIC ? 'اختر المنتج والكمية' : 'Pick product + qty', 'red'); return; }
    setBusy(true);
    try {
      await api.post('/batches', { product_id: Number(form.product_id), supplier_id: form.supplier_id ? Number(form.supplier_id) : null, qty: Number(form.qty), cost: Number(form.cost) || 0, expiry: form.expiry || null });
      setForm({ product_id: '', supplier_id: '', qty: '', cost: '', expiry: '' });
      load();
      notify(ARABIC ? 'تم استلام البضاعة' : 'Stock received', 'green');
    } catch (_) { notify(ARABIC ? 'فشل' : 'Failed', 'red'); } finally { setBusy(false); }
  };
  const addSupplier = async () => {
    if (!newSup.name.trim()) return;
    try { await api.post('/suppliers', newSup); setNewSup({ name: '', phone: '' }); api.get('/suppliers').then(setSuppliers); notify(ARABIC ? 'تمت إضافة المورّد' : 'Supplier added', 'green'); }
    catch (_) { notify(ARABIC ? 'فشل' : 'Failed', 'red'); }
  };

  const sel = { ...S.input, appearance: 'auto' };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: T.space.lg, alignItems: 'start' }}>
      <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: T.space.md }}>
        <div style={{ fontWeight: 700, fontSize: T.font.lg }}>📥 {ARABIC ? 'استلام بضاعة' : 'Receive stock'}</div>
        <Field label={ARABIC ? 'المنتج' : 'Product'}>
          <select style={sel} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
            <option value="">{ARABIC ? '— اختر —' : '— select —'}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={ARABIC ? 'المورّد' : 'Supplier'}>
          <select style={sel} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
            <option value="">{ARABIC ? '— بدون —' : '— none —'}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <div style={{ display: 'flex', gap: T.space.md }}>
          <Field label={ARABIC ? 'الكمية' : 'Quantity'}><input style={S.input} type="number" step="0.001" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
          <Field label={ARABIC ? 'التكلفة/وحدة' : 'Cost/unit'}><input style={S.input} type="number" step="0.001" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
        </div>
        <Field label={ARABIC ? 'تاريخ الانتهاء' : 'Expiry date'}><input style={S.input} type="date" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} /></Field>
        <button onClick={receive} disabled={busy} style={{ ...S.btn, padding: `${T.space.md}px`, fontSize: T.font.lg, opacity: busy ? 0.6 : 1 }}>{ARABIC ? '＋ استلام وتحديث المخزون' : '＋ Receive & add to stock'}</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.lg }}>
        <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: T.space.sm }}>
          <div style={{ fontWeight: 700, fontSize: T.font.lg }}>🏷 {ARABIC ? 'الموردون' : 'Suppliers'}</div>
          <div style={{ display: 'flex', gap: T.space.sm }}>
            <input style={S.input} value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} placeholder={ARABIC ? 'اسم المورّد' : 'Supplier name'} />
            <input style={{ ...S.input, maxWidth: 130 }} value={newSup.phone} onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })} placeholder={ARABIC ? 'هاتف' : 'Phone'} />
            <button onClick={addSupplier} style={S.btn}>＋</button>
          </div>
          {suppliers.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: `${T.space.sm}px 0`, borderTop: `1px solid ${C.line}`, fontSize: T.font.base }}>
              <span style={{ fontWeight: 600 }}>{s.name}</span><span style={{ color: C.dim, ...T.num }}>{s.phone || ''}</span>
            </div>
          ))}
          {!suppliers.length && <div style={{ color: C.dim, fontSize: T.font.sm }}>{ARABIC ? 'لا موردين' : 'No suppliers'}</div>}
        </div>

        <div style={{ ...S.card }}>
          <div style={{ fontWeight: 700, fontSize: T.font.lg, marginBottom: T.space.sm }}>{ARABIC ? 'آخر الاستلامات' : 'Recent receipts'}</div>
          {batches.slice(0, 12).map((b) => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: `${T.space.xs}px 0`, borderTop: `1px solid ${C.line}`, fontSize: T.font.sm }}>
              <span>{b.product} <span style={{ color: C.dim, ...T.num }}>×{Number(b.qty)}</span></span>
              <span style={{ color: C.dim }}>{b.supplier || '—'}{b.expiry ? ' · ⌛' + b.expiry : ''}</span>
            </div>
          ))}
          {!batches.length && <div style={{ color: C.dim, fontSize: T.font.sm }}>{ARABIC ? 'لا شيء بعد' : 'Nothing yet'}</div>}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// History
// ══════════════════════════════════════════════════════════════════════════════
function HistoryView({ user, notify }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [returning, setReturning] = useState(null); // sale being returned

  const load = useCallback(() => {
    setLoading(true);
    api.get('/orders?floor=' + DEFAULT_FLOOR + '&limit=200')
      .then(setSales).catch(() => notify(ARABIC ? 'تعذّر تحميل السجل' : 'Failed to load history', 'red'))
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  // Process a (full or partial) return: record a reversing order for the chosen lines + restore stock.
  const doReturn = async (sale, lines) => {
    const items = lines.filter((l) => l.qty > 0);
    if (!items.length) { setReturning(null); return; }
    const refundTotal = items.reduce((s, l) => s + l.price * l.qty, 0);
    setBusyId(sale.id);
    try {
      const invoice_no = await api.get('/invoice/next?floor=' + DEFAULT_FLOOR);
      const { date, time } = nowParts();
      const r = { id: uid(), floor: DEFAULT_FLOOR, items, sub: -refundTotal, tax: 0, svc: 0, disc: 0, total: -refundTotal, pay: 'refund', waiter: user.username, status: 'refund', date, time, invoice_no, buyer: 'return of #' + sale.invoice_no };
      await api.post('/orders', r);
      await Promise.all(items.map((l) => typeof l.id === 'number' && api.patch('/products/' + l.id + '/stock', { delta: +l.qty }).catch(() => {})));
      notify(ARABIC ? 'تم الاسترجاع' : 'Returned', 'green');
      setReturning(null); load();
    } catch (ex) { notify(ARABIC ? 'فشل الاسترجاع' : 'Return failed', 'red'); } finally { setBusyId(null); }
  };

  if (loading) return <div style={{ color: C.dim }}>{ARABIC ? 'جارٍ التحميل…' : 'Loading…'}</div>;
  return (
    <div style={S.card}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: T.font.base }}>
        <thead><tr style={{ color: C.dim, background: C.panel2, textAlign: ARABIC ? 'right' : 'left' }}>
          <th style={th}>#</th><th style={th}>{ARABIC ? 'التاريخ' : 'Date'}</th><th style={th}>{ARABIC ? 'الأصناف' : 'Items'}</th>
          <th style={th}>{ARABIC ? 'الدفع' : 'Pay'}</th><th style={{ ...th, textAlign: 'right' }}>{ARABIC ? 'المجموع' : 'Total'}</th><th style={th}></th>
        </tr></thead>
        <tbody>
          {sales.map((s) => {
            const isRefund = Number(s.total) < 0 || s.pay === 'refund';
            return (
              <tr key={s.id} style={{ borderTop: `1px solid ${C.line}`, opacity: isRefund ? 0.7 : 1 }}>
                <td style={{ ...td, fontWeight: 600, ...T.num }}>{s.invoice_no}</td>
                <td style={{ ...td, color: C.dim, ...T.num }}>{s.date} {s.time}</td>
                <td style={{ ...td, color: C.dim, ...T.num }}>{(s.items || []).reduce((n, l) => n + (l.qty || 0), 0)}</td>
                <td style={{ ...td, color: isRefund ? C.red : C.text }}>{isRefund ? (ARABIC ? '↩ استرجاع' : '↩ refund') : s.pay}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, ...T.num, color: isRefund ? C.red : C.text }}>{money(s.total)}</td>
                <td style={{ ...td, textAlign: 'end', whiteSpace: 'nowrap' }}>
                  <button onClick={() => printReceipt(s)} style={{ ...S.btnGhost, padding: `${T.space.xs}px ${T.space.md}px` }}>{ARABIC ? 'طباعة' : 'Print'}</button>
                  {!isRefund && <button onClick={() => setReturning(s)} disabled={busyId === s.id} style={{ ...S.btnGhost, padding: `${T.space.xs}px ${T.space.md}px`, color: C.red, marginInlineStart: T.space.sm }}>{busyId === s.id ? '…' : (ARABIC ? 'استرجاع' : 'Return')}</button>}
                </td>
              </tr>
            );
          })}
          {!sales.length && <tr><td colSpan={6} style={{ ...td, color: C.dim, textAlign: 'center', padding: T.space.xl }}>{ARABIC ? 'لا مبيعات بعد' : 'No sales yet'}</td></tr>}
        </tbody>
      </table>
      {returning && <ReturnModal sale={returning} busy={busyId === returning.id} onClose={() => setReturning(null)} onConfirm={(lines) => doReturn(returning, lines)} />}
    </div>
  );
}

// Pick how many of each line to return (defaults to full quantity).
function ReturnModal({ sale, onClose, onConfirm, busy }) {
  const [qty, setQty] = useState(() => (sale.items || []).map((l) => Number(l.qty) || 0));
  const lines = (sale.items || []).map((l, i) => ({ ...l, qty: qty[i] }));
  const refundTotal = lines.reduce((s, l) => s + (Number(l.price) || 0) * l.qty, 0);
  const setI = (i, v) => setQty((q) => q.map((x, j) => (j === i ? Math.max(0, Math.min(Number(sale.items[i].qty) || 0, v)) : x)));
  return (
    <Overlay onClose={onClose}>
      <div style={{ ...S.card, width: 380, display: 'flex', flexDirection: 'column', gap: T.space.md, boxShadow: T.shadow.lg }}>
        <div style={{ fontWeight: 700, fontSize: T.font.lg }}>↩ {ARABIC ? 'استرجاع فاتورة' : 'Return sale'} #{sale.invoice_no}</div>
        {(sale.items || []).map((l, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: T.space.sm }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{l.name} <span style={{ color: C.dim, fontSize: T.font.xs, fontWeight: 500 }}>({ARABIC ? 'بيع' : 'sold'} {Number(l.qty)})</span></span>
            <button onClick={() => setI(i, qty[i] - 1)} style={qtyBtn}>−</button>
            <span style={{ minWidth: 26, textAlign: 'center', fontWeight: 700, ...T.num }}>{qty[i]}</span>
            <button onClick={() => setI(i, qty[i] + 1)} style={qtyBtn}>+</button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: T.space.xs }}>
          <span style={{ fontSize: T.font.lg, fontWeight: 600, color: C.dim }}>{ARABIC ? 'مبلغ الاسترجاع' : 'Refund'}</span><span style={{ color: C.red, fontSize: T.font.xl, fontWeight: 700, ...T.num }}>{money(refundTotal)}</span>
        </div>
        <div style={{ display: 'flex', gap: T.space.sm }}>
          <button onClick={() => onConfirm(lines)} disabled={busy || refundTotal <= 0} style={{ ...S.btn, flex: 1, padding: `${T.space.md}px`, opacity: busy || refundTotal <= 0 ? 0.5 : 1 }}>{ARABIC ? 'تأكيد الاسترجاع' : 'Confirm return'}</button>
          <button onClick={onClose} style={{ ...S.btnGhost, padding: `${T.space.md}px` }}>{ARABIC ? 'إلغاء' : 'Cancel'}</button>
        </div>
      </div>
    </Overlay>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Reports
// ══════════════════════════════════════════════════════════════════════════════
function ReportsView({ notify }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [sum, setSum] = useState(null);
  const [top, setTop] = useState([]);
  const [low, setLow] = useState([]);
  const [exp, setExp] = useState([]);
  const [abc, setAbc] = useState([]);
  const [zrep, setZrep] = useState(null);
  const [hours, setHours] = useState([]);

  const load = useCallback(() => {
    const qs = `?from=${from}&to=${to}`;
    api.get('/reports/summary' + qs).then(setSum).catch(() => notify(ARABIC ? 'تعذّر تحميل التقارير' : 'Failed to load reports', 'red'));
    api.get('/reports/top-products' + qs + '&limit=10').then(setTop).catch(() => {});
    api.get('/reports/low-stock?threshold=5').then(setLow).catch(() => {});
    api.get('/expiry?days=30').then(setExp).catch(() => {});
    api.get('/reports/abc' + qs).then(setAbc).catch(() => {});
    api.get('/reports/zreport?date=' + to).then(setZrep).catch(() => {});
    api.get('/timeclock' + qs).then(setHours).catch(() => {});
  }, [from, to, notify]);
  useEffect(() => { load(); }, [load]);

  // Export the sales in the selected range to a CSV the owner can hand to an accountant.
  const exportCSV = async () => {
    try {
      const all = await api.get('/orders?floor=' + DEFAULT_FLOOR + '&limit=100000');
      const rows = all.filter((o) => { const d = o.date || (o.created_at || '').slice(0, 10); return d >= from && d <= to; });
      const head = ['invoice_no', 'date', 'time', 'payment', 'items', 'total'];
      const body = rows.map((o) => [o.invoice_no, o.date, o.time, o.pay, (o.items || []).reduce((n, l) => n + (l.qty || 0), 0), Number(o.total).toFixed(3)]);
      const csv = [head, ...body].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `dukkan-sales_${from}_${to}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (_) { notify(ARABIC ? 'فشل التصدير' : 'Export failed', 'red'); }
  };

  // Aggregate clocked hours per employee.
  const hoursByUser = Object.values(hours.reduce((m, h) => { (m[h.username] = m[h.username] || { username: h.username, hours: 0 }).hours += Number(h.hours) || 0; return m; }, {}));
  const abcClass = (c) => abc.filter((x) => x.class === c);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: T.space.md, alignItems: 'end', flexWrap: 'wrap' }}>
        <Field label={ARABIC ? 'من' : 'From'}><input style={{ ...S.input, ...T.num }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={ARABIC ? 'إلى' : 'To'}><input style={{ ...S.input, ...T.num }} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button onClick={exportCSV} style={{ ...S.btnGhost, height: 42 }}>⬇ {ARABIC ? 'تصدير CSV' : 'Export CSV'}</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: T.space.md }}>
        <Stat label={ARABIC ? 'الإيراد' : 'Revenue'} value={money(sum && sum.revenue)} accent />
        <Stat label={ARABIC ? 'عدد الفواتير' : 'Sales'} value={sum ? sum.orders : '—'} />
        <Stat label={ARABIC ? 'وحدات مباعة' : 'Units sold'} value={sum ? Number(sum.units) : '—'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: T.space.lg }}>
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: T.font.lg, marginBottom: T.space.sm }}>{ARABIC ? 'الأكثر مبيعاً' : 'Top products'}</div>
          {top.map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: `${T.space.sm}px 0`, borderBottom: `1px solid ${C.line}`, fontSize: T.font.base }}>
              <span>{t.name}</span><span style={{ color: C.dim, ...T.num }}>{Number(t.units)} · {money(t.revenue)}</span>
            </div>
          ))}
          {!top.length && <div style={{ color: C.dim, fontSize: T.font.sm }}>{ARABIC ? 'لا بيانات' : 'No data'}</div>}
        </div>
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: T.font.lg, marginBottom: T.space.sm }}>{ARABIC ? 'مخزون منخفض' : 'Low stock'}</div>
          {low.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: `${T.space.sm}px 0`, borderBottom: `1px solid ${C.line}`, fontSize: T.font.base }}>
              <span>{p.name}</span><span style={{ color: Number(p.stock) <= 0 ? C.red : C.accent, fontWeight: 600, ...T.num }}>{Number(p.stock)}</span>
            </div>
          ))}
          {!low.length && <div style={{ color: C.dim, fontSize: T.font.sm }}>{ARABIC ? 'كل المخزون جيد' : 'All stocked'}</div>}
        </div>
      </div>
      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: T.font.lg, marginBottom: T.space.sm }}>⌛ {ARABIC ? 'قرب الانتهاء (٣٠ يوم)' : 'Expiring soon (30 days)'}</div>
        {exp.map((e) => {
          const dl = Number(e.days_left);
          const col = dl < 0 ? C.red : dl <= 7 ? C.accent : C.dim;
          return (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: `${T.space.sm}px 0`, borderBottom: `1px solid ${C.line}`, fontSize: T.font.base }}>
              <span>{e.product} {e.supplier ? <span style={{ color: C.dim, fontSize: T.font.xs }}>· {e.supplier}</span> : null}</span>
              <span style={{ color: col, fontWeight: 600, ...T.num }}>{e.expiry} ({dl < 0 ? (ARABIC ? 'منتهي' : 'expired') : dl + (ARABIC ? ' يوم' : 'd')})</span>
            </div>
          );
        })}
        {!exp.length && <div style={{ color: C.dim, fontSize: T.font.sm }}>{ARABIC ? 'لا شيء قريب الانتهاء' : 'Nothing expiring soon'}</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: T.space.lg }}>
        {/* Z-report: daily close-out by payment method */}
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: T.font.lg, marginBottom: T.space.sm }}>🧮 {ARABIC ? 'تقرير اليوم (إغلاق)' : 'Z-Report (close-out)'} — {to}</div>
          {zrep && zrep.lines.map((l) => (
            <div key={l.pay} style={{ display: 'flex', justifyContent: 'space-between', padding: `${T.space.sm}px 0`, borderBottom: `1px solid ${C.line}`, fontSize: T.font.base }}>
              <span style={{ textTransform: 'capitalize' }}>{l.pay} <span style={{ color: C.dim, fontSize: T.font.xs, ...T.num }}>×{l.orders}</span></span><span style={{ fontWeight: 600, ...T.num }}>{money(l.total)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: T.space.sm }}>
            <span style={{ fontWeight: 600, color: C.dim }}>{ARABIC ? 'الصافي' : 'Net'}</span><span style={{ color: C.accent, fontSize: T.font.xl, fontWeight: 700, ...T.num }}>{money(zrep && zrep.net)}</span>
          </div>
        </div>
        {/* Employee hours */}
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: T.font.lg, marginBottom: T.space.sm }}>🕐 {ARABIC ? 'ساعات الموظفين' : 'Employee hours'}</div>
          {hoursByUser.map((h) => (
            <div key={h.username} style={{ display: 'flex', justifyContent: 'space-between', padding: `${T.space.sm}px 0`, borderBottom: `1px solid ${C.line}`, fontSize: T.font.base }}>
              <span>{h.username}</span><span style={{ color: C.dim, ...T.num }}>{h.hours.toFixed(2)} {ARABIC ? 'ساعة' : 'h'}</span>
            </div>
          ))}
          {!hoursByUser.length && <div style={{ color: C.dim, fontSize: T.font.sm }}>{ARABIC ? 'لا سجلّات' : 'No punches'}</div>}
        </div>
      </div>

      {/* ABC analysis */}
      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: T.font.lg, marginBottom: T.space.sm }}>🅰 {ARABIC ? 'تحليل ABC (مساهمة الإيراد)' : 'ABC analysis (revenue contribution)'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: T.space.md }}>
          {[['A', C.green, ARABIC ? 'الأهم (٨٠٪)' : 'Top (80%)'], ['B', C.accent, ARABIC ? 'متوسط (١٥٪)' : 'Mid (15%)'], ['C', C.dim, ARABIC ? 'الأقل (٥٪)' : 'Low (5%)']].map(([cls, col, lbl]) => (
            <div key={cls}>
              <div style={{ fontWeight: 700, color: col, marginBottom: T.space.xs }}>{cls} · {lbl} ({abcClass(cls).length})</div>
              {abcClass(cls).slice(0, 8).map((x, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: T.font.sm, padding: `${T.space.xs}px 0` }}><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span><span style={{ color: C.dim, marginInlineStart: T.space.sm, ...T.num }}>{money(x.revenue)}</span></div>
              ))}
            </div>
          ))}
        </div>
        {!abc.length && <div style={{ color: C.dim, fontSize: T.font.sm }}>{ARABIC ? 'لا بيانات مبيعات' : 'No sales data'}</div>}
      </div>
    </div>
  );
}
function Stat({ label, value, accent }) {
  return (
    <div style={S.card}>
      <div style={{ color: C.dim, fontSize: T.font.xs, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: T.font.display, fontWeight: 700, marginTop: T.space.xs, letterSpacing: '-0.02em', ...T.num, color: accent ? C.accent : C.text }}>{value}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Settings — change password, (admin) users + categories
// ══════════════════════════════════════════════════════════════════════════════
function SettingsView({ user, isAdmin, notify }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.lg, maxWidth: 640 }}>
      <ChangePassword notify={notify} />
      {isAdmin && <Categories notify={notify} />}
      {isAdmin && <Users me={user} notify={notify} />}
    </div>
  );
}

function ChangePassword({ notify }) {
  const [oldPw, setOld] = useState(''); const [newPw, setNew] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (newPw.length < 8) { notify(ARABIC ? 'كلمة المرور 8 أحرف على الأقل' : 'Password must be 8+ chars', 'red'); return; }
    setBusy(true);
    try { await api.post('/auth/change-password', { old: oldPw, new: newPw }); setOld(''); setNew(''); notify(ARABIC ? 'تم تغيير كلمة المرور' : 'Password changed', 'green'); }
    catch (ex) { notify(ex.message === 'wrong_old' ? (ARABIC ? 'كلمة المرور الحالية خاطئة' : 'Current password wrong') : (ARABIC ? 'فشل' : 'Failed'), 'red'); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: T.space.md }}>
      <div style={{ fontWeight: 700, fontSize: T.font.lg }}>{ARABIC ? 'تغيير كلمة المرور' : 'Change password'}</div>
      <input style={S.input} type="password" value={oldPw} onChange={(e) => setOld(e.target.value)} placeholder={ARABIC ? 'كلمة المرور الحالية' : 'Current password'} />
      <input style={S.input} type="password" value={newPw} onChange={(e) => setNew(e.target.value)} placeholder={ARABIC ? 'كلمة مرور جديدة (8+)' : 'New password (8+)'} />
      <button type="submit" disabled={busy} style={{ ...S.btn, alignSelf: 'start', opacity: busy ? 0.6 : 1 }}>{ARABIC ? 'حفظ' : 'Save'}</button>
    </form>
  );
}

function Categories({ notify }) {
  const [text, setText] = useState('');
  useEffect(() => { api.get('/settings/categories').then((r) => { try { setText((r && r.value ? JSON.parse(r.value) : []).join(', ')); } catch (_) {} }).catch(() => {}); }, []);
  const save = async () => {
    const list = text.split(',').map((s) => s.trim()).filter(Boolean);
    try { await api.put('/settings/categories', { value: JSON.stringify(list) }); notify(ARABIC ? 'تم حفظ الفئات' : 'Categories saved', 'green'); }
    catch (_) { notify(ARABIC ? 'فشل' : 'Failed', 'red'); }
  };
  return (
    <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: T.space.md }}>
      <div style={{ fontWeight: 700, fontSize: T.font.lg }}>{ARABIC ? 'الفئات' : 'Categories'}</div>
      <input style={S.input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Drinks, Snacks, Dairy…" />
      <button onClick={save} style={{ ...S.btn, alignSelf: 'start' }}>{ARABIC ? 'حفظ' : 'Save'}</button>
    </div>
  );
}

function Users({ me, notify }) {
  const [users, setUsers] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'user', views: [], full_name: '', wage: '' });
  const VIEW_OPTS = ['inventory', 'receive', 'history', 'reports'];
  const load = useCallback(() => api.get('/users').then(setUsers).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (form.password.length < 8) { notify(ARABIC ? 'كلمة المرور 8 أحرف على الأقل' : 'Password 8+ chars', 'red'); return; }
    try {
      await api.post('/users', { username: form.username, password: form.password, role: form.role, views: form.role === 'admin' ? [] : form.views, full_name: form.full_name, wage: Number(form.wage) || 0 });
      setAdding(false); setForm({ username: '', password: '', role: 'user', views: [], full_name: '', wage: '' }); load();
      notify(ARABIC ? 'تمت إضافة المستخدم' : 'User added', 'green');
    } catch (ex) { notify(ex.message === 'exists' ? (ARABIC ? 'اسم مستخدم مكرر' : 'Username taken') : (ARABIC ? 'فشل' : 'Failed'), 'red'); }
  };
  const del = async (u) => {
    if (!window.confirm((ARABIC ? 'حذف ' : 'Delete ') + u.username + '?')) return;
    try { await api.del('/users/' + u.id); load(); } catch (_) { notify(ARABIC ? 'فشل' : 'Failed', 'red'); }
  };
  const toggleView = (v) => setForm((f) => ({ ...f, views: f.views.includes(v) ? f.views.filter((x) => x !== v) : [...f.views, v] }));

  return (
    <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: T.space.md }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: T.font.lg }}>{ARABIC ? 'الموظفون' : 'Employees'}</div>
        <button onClick={() => setAdding((a) => !a)} style={S.btnGhost}>{adding ? (ARABIC ? 'إغلاق' : 'Close') : (ARABIC ? '+ موظف' : '+ Employee')}</button>
      </div>
      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: T.space.sm, padding: T.space.md, background: C.panel2, borderRadius: T.radius.md }}>
          <input style={S.input} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder={ARABIC ? 'الاسم الكامل' : 'Full name'} />
          <input style={S.input} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={ARABIC ? 'اسم المستخدم' : 'Username'} autoCapitalize="off" />
          <input style={S.input} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={ARABIC ? 'كلمة المرور (8+)' : 'Password (8+)'} />
          <input style={S.input} type="number" step="0.01" value={form.wage} onChange={(e) => setForm({ ...form, wage: e.target.value })} placeholder={ARABIC ? 'أجر الساعة (اختياري)' : 'Hourly wage (optional)'} />
          <div style={{ display: 'flex', gap: T.space.sm }}>
            {['user', 'admin'].map((r) => (
              <button key={r} onClick={() => setForm({ ...form, role: r })} style={{ ...S.btnGhost, flex: 1, ...(form.role === r ? { background: C.accent, color: C.accentText, borderColor: C.accent } : {}) }}>{r}</button>
            ))}
          </div>
          {form.role === 'user' && (
            <div style={{ display: 'flex', gap: T.space.sm, flexWrap: 'wrap' }}>
              {VIEW_OPTS.map((v) => (
                <button key={v} onClick={() => toggleView(v)} style={{ ...S.btnGhost, padding: `${T.space.xs}px ${T.space.md}px`, ...(form.views.includes(v) ? { background: C.accent, color: C.accentText, borderColor: C.accent } : {}) }}>{VIEW_LABELS[v]}</button>
              ))}
            </div>
          )}
          <button onClick={add} style={{ ...S.btn, alignSelf: 'start' }}>{ARABIC ? 'إضافة' : 'Add'}</button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {users.map((u) => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: T.space.sm, padding: `${T.space.sm}px 0`, borderTop: `1px solid ${C.line}` }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{u.full_name || u.username}</span>
              <span style={{ color: C.dim, fontSize: T.font.xs, marginInlineStart: T.space.sm }}>{u.username} · {u.role}{u.role !== 'admin' && (u.allowed_views || []).length ? ' · ' + u.allowed_views.join(', ') : ''}{Number(u.wage) > 0 ? ' · ' + money(u.wage) + '/h' : ''}</span>
            </div>
            {u.id !== me.id && <button onClick={() => del(u)} style={{ ...S.btnGhost, padding: `${T.space.xs}px ${T.space.md}px`, color: C.red }}>{ARABIC ? 'حذف' : 'Del'}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
