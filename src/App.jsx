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

// ── Theme ──────────────────────────────────────────────────────────────────────
const C = {
  bg: '#0f1117', panel: '#1a1c25', panel2: '#22252f', line: '#2c2f3a',
  text: '#e6e6e6', dim: '#9aa0aa', accent: '#f0a830', accentText: '#0f1117',
  green: '#3ecf8e', red: '#ff6b6b', blue: '#5b9dff',
};
const S = {
  btn: { padding: '10px 16px', borderRadius: 9, border: 'none', background: C.accent, color: C.accentText, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { padding: '9px 14px', borderRadius: 9, border: `1px solid ${C.line}`, background: 'transparent', color: C.text, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  input: { padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.panel2, color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  card: { background: C.panel, borderRadius: 12, border: `1px solid ${C.line}`, padding: 16 },
};

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
export default function App() {
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
    <div dir={ARABIC ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'DM Sans', system-ui, sans-serif", display: 'flex', flexDirection: 'column' }}>
      <Header user={user} view={view} setView={setView} navViews={navViews} onLogout={handleLogout} />
      <main style={{ flex: 1, padding: 16, maxWidth: 1180, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {view === 'sales' && <SalesView user={user} notify={notify} />}
        {view === 'inventory' && allowed('inventory') && <InventoryView isAdmin={isAdmin} notify={notify} />}
        {view === 'receive' && allowed('receive') && <ReceiveView isAdmin={isAdmin} notify={notify} />}
        {view === 'history' && allowed('history') && <HistoryView user={user} notify={notify} />}
        {view === 'reports' && allowed('reports') && <ReportsView notify={notify} />}
        {view === 'settings' && <SettingsView user={user} isAdmin={isAdmin} notify={notify} />}
      </main>
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: toast.kind === 'red' ? C.red : toast.kind === 'green' ? C.green : C.panel2, color: toast.kind === 'info' ? C.text : C.accentText, padding: '11px 20px', borderRadius: 10, fontWeight: 600, fontSize: 14, boxShadow: '0 6px 24px rgba(0,0,0,.4)', zIndex: 1000 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Centered({ children }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, color: C.dim, fontFamily: "'DM Sans', system-ui, sans-serif" }}>{children}</div>;
}

const VIEW_ICONS = { sales: '🛒', inventory: '📦', receive: '📥', history: '🧾', reports: '📊', settings: '⚙️' };
function Header({ user, view, setView, navViews, onLogout }) {
  return (
    <header style={{ background: C.panel, borderBottom: `1px solid ${C.line}`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ fontWeight: 800, fontSize: 22, color: C.accent }}>{STORE_NAME}</div>
      <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 }}>
        {navViews.map((v) => {
          const on = view === v;
          return (
            <button key={v} onClick={() => setView(v)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                minWidth: 96, height: 64, padding: '6px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${on ? C.accent : C.line}`, background: on ? C.accent : C.panel2,
                color: on ? C.accentText : C.text, fontWeight: 700, fontSize: 15, transition: 'background .12s',
              }}>
              <span style={{ fontSize: 24, lineHeight: 1 }}>{VIEW_ICONS[v]}</span>
              <span>{VIEW_LABELS[v]}</span>
            </button>
          );
        })}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: C.dim }}>{user.username} ({user.role})</span>
        <button onClick={onLogout} style={{ ...S.btnGhost, height: 64, minWidth: 90, fontSize: 15 }}>{ARABIC ? 'خروج' : 'Logout'}</button>
      </div>
    </header>
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
      style={{ flex, minWidth: 0, height: 56, borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel2, color: C.text, fontSize: 20, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', userSelect: 'none', ...extra }}>
      {label}
    </button>
  );
  const toggleKey = key(mode === 'num' ? 'ABC' : '123', () => setMode((m) => (m === 'num' ? 'abc' : 'num')), 1.4, { background: C.blue, color: '#fff', fontSize: 16 });
  const bottomRow = (
    <div style={{ display: 'flex', gap: 8 }}>
      {key(ARABIC ? 'إغلاق' : 'Hide', onClose, 1.4, { fontSize: 15 })}
      {key('␣', () => onKey(' '), 4)}
      {key(ARABIC ? 'دخول' : 'Enter', onEnter, 2, { background: C.green, color: C.accentText, fontSize: 16 })}
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
          {key('⌫', onBackspace, 1.4, { background: C.red, color: '#fff' })}
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
          {i === 3 && key('⌫', onBackspace, 1.4, { background: C.red, color: '#fff' })}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        {toggleKey}
        {key('␣', () => onKey(' '), 4)}
        {key(ARABIC ? 'دخول' : 'Enter', onEnter, 2, { background: C.green, color: C.accentText, fontSize: 16 })}
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

  const fieldStyle = (name) => ({ ...S.input, fontSize: 17, padding: '14px 14px', ...(active === name && kb ? { borderColor: C.accent, boxShadow: `0 0 0 2px ${C.accent}33` } : {}) });

  return (
    <div dir={ARABIC ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, fontFamily: "'DM Sans', system-ui, sans-serif", padding: 16 }}>
      <form onSubmit={submit} style={{ ...S.card, width: 'min(94vw, 460px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 30, color: C.accent, textAlign: 'center' }}>{STORE_NAME}</div>
        <div style={{ color: C.dim, fontSize: 14, textAlign: 'center', marginTop: -8 }}>{ARABIC ? 'تسجيل الدخول' : 'Sign in'}</div>
        <input style={fieldStyle('username')} placeholder={ARABIC ? 'اسم المستخدم' : 'Username'} value={username}
          onChange={(e) => setUsername(e.target.value)} onFocus={() => { setActive('username'); setKb(true); }}
          autoFocus autoCapitalize="off" autoComplete="off" />
        <input style={fieldStyle('password')} type="password" placeholder={ARABIC ? 'كلمة المرور' : 'Password'} value={password}
          onChange={(e) => setPassword(e.target.value)} onFocus={() => { setActive('password'); setKb(true); }} autoComplete="off" />
        {err && <div style={{ color: C.red, fontSize: 14 }}>{err}</div>}
        {process.env.REACT_APP_DEMO === '1' && (
          <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, fontSize: 12, color: C.dim, textAlign: 'center' }}>
            DEMO — no backend. Sign in: <b style={{ color: C.accent }}>admin</b> / any password<br />or <b style={{ color: C.accent }}>cashier</b> (limited views). Data is local to your browser.
          </div>
        )}
        <button type="submit" disabled={busy} style={{ ...S.btn, padding: '16px', fontSize: 18, opacity: busy ? 0.6 : 1 }}>{busy ? '…' : (ARABIC ? 'دخول' : 'Login')}</button>
        {!kb && <button type="button" onClick={() => setKb(true)} style={{ ...S.btnGhost, padding: '12px' }}>{ARABIC ? 'إظهار لوحة المفاتيح' : 'Show keyboard'}</button>}
        {kb && <OnScreenKeyboard onKey={onKey} onBackspace={onBackspace} onEnter={submit} onClose={() => setKb(false)} />}
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 16, alignItems: 'start' }}>
      {/* Left: scan + tap-to-add product tiles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input ref={scanRef} style={{ ...S.input, fontSize: 18, padding: '14px', letterSpacing: 1 }}
            value={scan} onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onScan(scan); }}
            placeholder={ARABIC ? '🔍 امسح الباركود أو اضغط منتجاً' : '🔍 Scan barcode or tap a product'} inputMode="search" />
          <button onClick={() => setQuickItem(true)} style={{ ...S.btnGhost, whiteSpace: 'nowrap', fontSize: 15, fontWeight: 700 }}>
            ＋ {ARABIC ? 'صنف يدوي' : 'Quick item'}
          </button>
          {!!held.length && (
            <button onClick={() => setShowHeld(true)} style={{ ...S.btnGhost, whiteSpace: 'nowrap', fontSize: 15, fontWeight: 700 }}>
              ⏸ {ARABIC ? 'المعلّقة' : 'Held'} ({held.length})
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)} style={{ ...S.btnGhost, padding: '10px 16px', fontSize: 14, ...(cat === c ? { background: C.accent, color: C.accentText, borderColor: C.accent } : {}) }}>
              {c === 'all' ? (ARABIC ? 'الكل' : 'All') : c}
            </button>
          ))}
        </div>

        <input style={S.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={ARABIC ? 'ابحث بالاسم أو الباركود…' : 'Search by name or barcode…'} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {tiles.map((p) => (
            <button key={p.id} onClick={() => addProduct(p)} style={{
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6, minHeight: 86, padding: 12,
              borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel2, color: C.text, cursor: 'pointer',
              textAlign: 'start', fontFamily: 'inherit',
            }}>
              <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>{p.name}{p.unit === 'kg' ? ' ⚖' : ''}</span>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.accent, fontWeight: 800, fontSize: 16 }}>{money(p.price)}{p.unit === 'kg' ? (ARABIC ? '/كغ' : '/kg') : ''}</span>
                {Number(p.stock) <= 5 && <span style={{ fontSize: 11, color: C.red, fontWeight: 700 }}>● {Number(p.stock)}</span>}
              </span>
            </button>
          ))}
          {!tiles.length && <div style={{ color: C.dim, fontSize: 14, gridColumn: '1/-1', padding: 24, textAlign: 'center' }}>{ARABIC ? 'لا منتجات — أضفها من المخزون' : 'No products — add them in Inventory'}</div>}
        </div>
      </div>

      {/* Right: bill */}
      <div style={{ ...S.card, position: 'sticky', top: 16, padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 10 }}>🧾 {ARABIC ? 'الفاتورة' : 'Bill'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '42vh', overflow: 'auto' }}>
          {!cart.length && <div style={{ color: C.dim, fontSize: 15, padding: '28px 0', textAlign: 'center' }}>{ARABIC ? 'اضغط أو امسح منتجاً للبدء' : 'Tap or scan a product to start'}</div>}
          {cart.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.line}` }}>
              <button onClick={() => setEditLine(l)} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', textAlign: 'start', cursor: 'pointer', color: C.text, fontFamily: 'inherit', padding: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name} <span style={{ fontSize: 12, color: C.dim }}>✎</span></div>
                <div style={{ fontSize: 13, color: C.accent, fontWeight: 700 }}>{money(l.price)} × {l.qty} = {money(l.price * l.qty)}</div>
              </button>
              <button onClick={() => setQty(l.id, l.qty - 1)} style={qtyBtn}>−</button>
              <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 800, fontSize: 16 }}>{l.qty}</span>
              <button onClick={() => setQty(l.id, l.qty + 1)} style={qtyBtn}>+</button>
              <button onClick={() => removeLine(l.id)} style={{ ...qtyBtn, color: C.red, borderColor: C.red }}>×</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, fontWeight: 800, margin: '14px 0' }}>
          <span>{ARABIC ? 'المجموع' : 'Total'}</span><span style={{ color: C.accent }}>{money(total)}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {['cash', 'card'].map((m) => (
            <button key={m} onClick={() => setPay(m)} style={{ ...S.btnGhost, flex: 1, padding: '14px', fontSize: 16, ...(pay === m ? { background: C.blue, color: '#fff', borderColor: C.blue } : {}) }}>
              {m === 'cash' ? (ARABIC ? '💵 نقدي' : '💵 Cash') : (ARABIC ? '💳 بطاقة' : '💳 Card')}
            </button>
          ))}
        </div>
        {pay === 'cash' && (
          <div style={{ marginBottom: 10 }}>
            <input style={{ ...S.input, fontSize: 16, padding: '14px' }} type="number" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={ARABIC ? 'المبلغ المدفوع' : 'Cash given'} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
              <button onClick={() => setTendered(String(total.toFixed(3)))} style={{ ...S.btnGhost, padding: '12px', fontWeight: 800 }}>{ARABIC ? 'بالضبط' : 'Exact'}</button>
              {[1, 5, 10, 20, 50].map((d) => (
                <button key={d} onClick={() => setTendered(String(d))} style={{ ...S.btnGhost, padding: '12px', fontWeight: 700 }}>{d}</button>
              ))}
            </div>
            {change != null && change >= 0 && <div style={{ color: C.green, fontSize: 18, marginTop: 8, fontWeight: 800 }}>{ARABIC ? 'الباقي' : 'Change'}: {money(change)}</div>}
            {change != null && change < 0 && <div style={{ color: C.red, fontSize: 15, marginTop: 8, fontWeight: 700 }}>{ARABIC ? 'ناقص' : 'Short'}: {money(-change)}</div>}
          </div>
        )}
        <button onClick={checkout} disabled={!cart.length || busy} style={{ ...S.btn, width: '100%', padding: '18px', fontSize: 19, opacity: (!cart.length || busy) ? 0.5 : 1 }}>
          {busy ? '…' : (ARABIC ? '✓ إتمام وطباعة' : '✓ Pay & Print')}
        </button>
        {!!cart.length && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={holdSale} style={{ ...S.btnGhost, flex: 1, padding: '12px' }}>⏸ {ARABIC ? 'تعليق' : 'Hold'}</button>
            <button onClick={() => { setCart([]); setTendered(''); }} style={{ ...S.btnGhost, flex: 1, padding: '12px', color: C.red }}>✕ {ARABIC ? 'إلغاء' : 'Clear'}</button>
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
          <div style={{ ...S.card, width: 360, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>⏸ {ARABIC ? 'الفواتير المعلّقة' : 'Held sales'}</div>
            {!held.length && <div style={{ color: C.dim }}>{ARABIC ? 'لا شيء' : 'None'}</div>}
            {held.map((h) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.line}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{money(h.total)} <span style={{ color: C.dim, fontSize: 12 }}>· {h.items.length} {ARABIC ? 'صنف' : 'items'} · {h.ts}</span></div>
                </div>
                <button onClick={() => resumeSale(h)} style={{ ...S.btn, padding: '8px 14px' }}>{ARABIC ? 'استئناف' : 'Resume'}</button>
                <button onClick={() => persistHeld(held.filter((x) => x.id !== h.id))} style={{ ...S.btnGhost, padding: '8px 10px', color: C.red }}>×</button>
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
      <div style={{ ...S.card, width: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>⚖ {product.name}</div>
        <div style={{ color: C.dim, fontSize: 13 }}>{money(product.price)}{ARABIC ? ' / كغ' : ' / kg'}</div>
        <div style={{ ...S.input, fontSize: 22, fontWeight: 800, textAlign: 'center' }}>{kg || '0'} {ARABIC ? 'كغ' : 'kg'}</div>
        <div style={{ textAlign: 'center', color: C.accent, fontWeight: 800, fontSize: 20 }}>= {money(w * (Number(product.price) || 0))}</div>
        <NumPad onKey={onKey} onClear={() => setKg('')} onBackspace={() => setKg((v) => v.slice(0, -1))} />
        <button onClick={submit} style={{ ...S.btn, padding: '14px', fontSize: 16 }}>{ARABIC ? 'إضافة للفاتورة' : 'Add to bill'}</button>
      </div>
    </Overlay>
  );
}
const qtyBtn = { width: 42, height: 42, borderRadius: 9, border: `1px solid ${C.line}`, background: C.panel2, color: C.text, fontSize: 22, lineHeight: '1', cursor: 'pointer', fontWeight: 700 };

// ── Numeric keypad (touch) — drives a numeric string field ──────────────────────
function NumPad({ onKey, onClear, onBackspace }) {
  const k = (label, fn, extra = {}) => (
    <button key={label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={fn}
      style={{ height: 56, borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel2, color: C.text, fontSize: 22, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', ...extra }}>{label}</button>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => k(d, () => onKey(d)))}
      {k('.', () => onKey('.'))}
      {k('0', () => onKey('0'))}
      {k('⌫', onBackspace, { background: C.red, color: '#fff' })}
      {k('C', onClear, { gridColumn: '1 / -1', background: C.line })}
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
    <button type="button" onClick={() => setField(name)} style={{ flex: 1, padding: '12px', borderRadius: 8, border: `1px solid ${field === name ? C.accent : C.line}`, background: field === name ? C.accent : C.panel2, color: field === name ? C.accentText : C.text, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
      <div style={{ fontSize: 12 }}>{label}</div><div style={{ fontSize: 18 }}>{val || '0'}</div>
    </button>
  );
  return (
    <Overlay onClose={onClose}>
      <div style={{ ...S.card, width: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{line.name}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab('qty', ARABIC ? 'الكمية' : 'Qty', qty)}
          {tab('price', ARABIC ? 'السعر' : 'Price', price)}
        </div>
        <NumPad onKey={onKey} onClear={() => set('')} onBackspace={() => set((v) => v.slice(0, -1))} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onApply(Number(qty) || 0, Number(price) || 0)} style={{ ...S.btn, flex: 1, padding: '14px', fontSize: 16 }}>{ARABIC ? 'حفظ' : 'Save'}</button>
          <button onClick={onRemove} style={{ ...S.btnGhost, padding: '14px', color: C.red }}>{ARABIC ? 'حذف' : 'Remove'}</button>
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
      <div style={{ ...S.card, width: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{ARABIC ? 'صنف يدوي' : 'Quick item'}</div>
        <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder={ARABIC ? 'الاسم' : 'Name'} autoFocus />
        <div style={{ ...S.input, fontSize: 20, fontWeight: 800, textAlign: 'center', color: C.accent }}>{price || '0'}</div>
        <NumPad onKey={onKey} onClear={() => setPrice('')} onBackspace={() => setPrice((v) => v.slice(0, -1))} />
        <button onClick={submit} style={{ ...S.btn, padding: '14px', fontSize: 16 }}>{ARABIC ? 'إضافة للفاتورة' : 'Add to bill'}</button>
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
      <form onSubmit={save} style={{ ...S.card, width: 360, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>{editing ? (ARABIC ? 'تعديل منتج' : 'Edit product') : (ARABIC ? 'منتج جديد' : 'New product')}</div>
        <Field label={ARABIC ? 'الباركود' : 'Barcode'}><input style={S.input} value={barcode} onChange={(e) => setBarcode(e.target.value)} /></Field>
        <Field label={ARABIC ? 'الاسم' : 'Name'}><input ref={nameRef} style={S.input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={ARABIC ? 'تباع بـ' : 'Sold by'}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['ea', ARABIC ? 'بالقطعة' : 'Each'], ['kg', ARABIC ? 'بالوزن (كغ)' : 'Weight (kg)']].map(([v, lbl]) => (
              <button key={v} type="button" onClick={() => setUnit(v)} style={{ ...S.btnGhost, flex: 1, padding: '10px', ...(unit === v ? { background: C.blue, color: '#fff', borderColor: C.blue } : {}) }}>{lbl}</button>
            ))}
          </div>
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label={unit === 'kg' ? (ARABIC ? 'السعر / كغ' : 'Price / kg') : (ARABIC ? 'السعر' : 'Price')}><input style={S.input} type="number" step="0.001" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label={ARABIC ? 'الكمية' : 'Stock'}><input style={S.input} type="number" step="0.001" value={stock} onChange={(e) => setStock(e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label={ARABIC ? 'الفئة' : 'Category'}>
            <input style={S.input} list="cats" value={cat} onChange={(e) => setCat(e.target.value)} />
            <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label={ARABIC ? 'التكلفة' : 'Cost'}><input style={S.input} type="number" step="0.001" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button type="submit" disabled={busy} style={{ ...S.btn, flex: 1, opacity: busy ? 0.6 : 1 }}>{ARABIC ? 'حفظ' : 'Save'}</button>
          <button type="button" onClick={onClose} style={S.btnGhost}>{ARABIC ? 'إلغاء' : 'Cancel'}</button>
        </div>
      </form>
    </Overlay>
  );
}
function Field({ label, children }) {
  return <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: C.dim, fontWeight: 700 }}>{label}{children}</label>;
}
function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 16 }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input style={{ ...S.input, flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={ARABIC ? 'بحث عن منتج' : 'Search products'} />
        <button onClick={() => setEditing({})} style={S.btn}>{ARABIC ? '+ منتج' : '+ Product'}</button>
      </div>
      <div style={S.card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ color: C.dim, textAlign: ARABIC ? 'right' : 'left' }}>
            <th style={th}>{ARABIC ? 'الاسم' : 'Name'}</th><th style={th}>{ARABIC ? 'الباركود' : 'Barcode'}</th>
            <th style={th}>{ARABIC ? 'الفئة' : 'Category'}</th><th style={{ ...th, textAlign: 'right' }}>{ARABIC ? 'السعر' : 'Price'}</th>
            <th style={{ ...th, textAlign: 'right' }}>{ARABIC ? 'المخزون' : 'Stock'}</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={td}>{p.name}</td>
                <td style={{ ...td, color: C.dim, fontFamily: 'monospace' }}>{p.barcode || '—'}</td>
                <td style={{ ...td, color: C.dim }}>{p.cat || '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{money(p.price)}</td>
                <td style={{ ...td, textAlign: 'right', color: Number(p.stock) <= 5 ? C.red : C.text }}>{Number(p.stock)}</td>
                <td style={{ ...td, textAlign: 'end', whiteSpace: 'nowrap' }}>
                  <button onClick={() => setEditing(p)} style={{ ...S.btnGhost, padding: '5px 10px' }}>{ARABIC ? 'تعديل' : 'Edit'}</button>
                  {isAdmin && <button onClick={() => remove(p)} style={{ ...S.btnGhost, padding: '5px 10px', color: C.red, marginInlineStart: 6 }}>{ARABIC ? 'حذف' : 'Del'}</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} style={{ ...td, color: C.dim, textAlign: 'center', padding: 24 }}>{ARABIC ? 'لا منتجات' : 'No products'}</td></tr>}
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
const th = { padding: '6px 8px', fontWeight: 700, fontSize: 12 };
const td = { padding: '8px' };

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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>📥 {ARABIC ? 'استلام بضاعة' : 'Receive stock'}</div>
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
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label={ARABIC ? 'الكمية' : 'Quantity'}><input style={S.input} type="number" step="0.001" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
          <Field label={ARABIC ? 'التكلفة/وحدة' : 'Cost/unit'}><input style={S.input} type="number" step="0.001" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
        </div>
        <Field label={ARABIC ? 'تاريخ الانتهاء' : 'Expiry date'}><input style={S.input} type="date" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} /></Field>
        <button onClick={receive} disabled={busy} style={{ ...S.btn, padding: '14px', fontSize: 16, opacity: busy ? 0.6 : 1 }}>{ARABIC ? '＋ استلام وتحديث المخزون' : '＋ Receive & add to stock'}</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>🏷 {ARABIC ? 'الموردون' : 'Suppliers'}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={S.input} value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} placeholder={ARABIC ? 'اسم المورّد' : 'Supplier name'} />
            <input style={{ ...S.input, maxWidth: 130 }} value={newSup.phone} onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })} placeholder={ARABIC ? 'هاتف' : 'Phone'} />
            <button onClick={addSupplier} style={S.btn}>＋</button>
          </div>
          {suppliers.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: `1px solid ${C.line}`, fontSize: 14 }}>
              <span>{s.name}</span><span style={{ color: C.dim }}>{s.phone || ''}</span>
            </div>
          ))}
          {!suppliers.length && <div style={{ color: C.dim, fontSize: 13 }}>{ARABIC ? 'لا موردين' : 'No suppliers'}</div>}
        </div>

        <div style={{ ...S.card }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>{ARABIC ? 'آخر الاستلامات' : 'Recent receipts'}</div>
          {batches.slice(0, 12).map((b) => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: `1px solid ${C.line}`, fontSize: 13 }}>
              <span>{b.product} <span style={{ color: C.dim }}>×{Number(b.qty)}</span></span>
              <span style={{ color: C.dim }}>{b.supplier || '—'}{b.expiry ? ' · ⌛' + b.expiry : ''}</span>
            </div>
          ))}
          {!batches.length && <div style={{ color: C.dim, fontSize: 13 }}>{ARABIC ? 'لا شيء بعد' : 'Nothing yet'}</div>}
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

  const load = useCallback(() => {
    setLoading(true);
    api.get('/orders?floor=' + DEFAULT_FLOOR + '&limit=200')
      .then(setSales).catch(() => notify(ARABIC ? 'تعذّر تحميل السجل' : 'Failed to load history', 'red'))
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  // Refund a sale: record a reversing (negative) order and put the stock back.
  const refund = async (s) => {
    if (busyId || Number(s.total) < 0) return;
    if (!window.confirm((ARABIC ? 'استرجاع فاتورة #' : 'Refund sale #') + s.invoice_no + ' — ' + money(s.total) + '?')) return;
    setBusyId(s.id);
    try {
      const invoice_no = await api.get('/invoice/next?floor=' + DEFAULT_FLOOR);
      const { date, time } = nowParts();
      const r = { id: uid(), floor: DEFAULT_FLOOR, items: s.items, sub: -Number(s.total), tax: 0, svc: 0, disc: 0, total: -Number(s.total), pay: 'refund', waiter: user.username, status: 'refund', date, time, invoice_no, buyer: 'refund of #' + s.invoice_no };
      await api.post('/orders', r);
      await Promise.all((s.items || []).map((l) => l.id != null && api.patch('/products/' + l.id + '/stock', { delta: +l.qty }).catch(() => {})));
      notify(ARABIC ? 'تم الاسترجاع' : 'Refunded', 'green');
      load();
    } catch (ex) {
      notify(ARABIC ? 'فشل الاسترجاع' : 'Refund failed', 'red');
    } finally { setBusyId(null); }
  };

  if (loading) return <div style={{ color: C.dim }}>{ARABIC ? 'جارٍ التحميل…' : 'Loading…'}</div>;
  return (
    <div style={S.card}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead><tr style={{ color: C.dim, textAlign: ARABIC ? 'right' : 'left' }}>
          <th style={th}>#</th><th style={th}>{ARABIC ? 'التاريخ' : 'Date'}</th><th style={th}>{ARABIC ? 'الأصناف' : 'Items'}</th>
          <th style={th}>{ARABIC ? 'الدفع' : 'Pay'}</th><th style={{ ...th, textAlign: 'right' }}>{ARABIC ? 'المجموع' : 'Total'}</th><th style={th}></th>
        </tr></thead>
        <tbody>
          {sales.map((s) => {
            const isRefund = Number(s.total) < 0 || s.pay === 'refund';
            return (
              <tr key={s.id} style={{ borderTop: `1px solid ${C.line}`, opacity: isRefund ? 0.7 : 1 }}>
                <td style={td}>{s.invoice_no}</td>
                <td style={{ ...td, color: C.dim }}>{s.date} {s.time}</td>
                <td style={{ ...td, color: C.dim }}>{(s.items || []).reduce((n, l) => n + (l.qty || 0), 0)}</td>
                <td style={td}>{isRefund ? (ARABIC ? '↩ استرجاع' : '↩ refund') : s.pay}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: isRefund ? C.red : C.text }}>{money(s.total)}</td>
                <td style={{ ...td, textAlign: 'end', whiteSpace: 'nowrap' }}>
                  <button onClick={() => printReceipt(s)} style={{ ...S.btnGhost, padding: '6px 12px' }}>{ARABIC ? 'طباعة' : 'Print'}</button>
                  {!isRefund && <button onClick={() => refund(s)} disabled={busyId === s.id} style={{ ...S.btnGhost, padding: '6px 12px', color: C.red, marginInlineStart: 6 }}>{busyId === s.id ? '…' : (ARABIC ? 'استرجاع' : 'Refund')}</button>}
                </td>
              </tr>
            );
          })}
          {!sales.length && <tr><td colSpan={6} style={{ ...td, color: C.dim, textAlign: 'center', padding: 24 }}>{ARABIC ? 'لا مبيعات بعد' : 'No sales yet'}</td></tr>}
        </tbody>
      </table>
    </div>
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

  const load = useCallback(() => {
    const qs = `?from=${from}&to=${to}`;
    api.get('/reports/summary' + qs).then(setSum).catch(() => notify(ARABIC ? 'تعذّر تحميل التقارير' : 'Failed to load reports', 'red'));
    api.get('/reports/top-products' + qs + '&limit=10').then(setTop).catch(() => {});
    api.get('/reports/low-stock?threshold=5').then(setLow).catch(() => {});
    api.get('/expiry?days=30').then(setExp).catch(() => {});
  }, [from, to, notify]);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <Field label={ARABIC ? 'من' : 'From'}><input style={S.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={ARABIC ? 'إلى' : 'To'}><input style={S.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        <Stat label={ARABIC ? 'الإيراد' : 'Revenue'} value={money(sum && sum.revenue)} accent />
        <Stat label={ARABIC ? 'عدد الفواتير' : 'Sales'} value={sum ? sum.orders : '—'} />
        <Stat label={ARABIC ? 'وحدات مباعة' : 'Units sold'} value={sum ? Number(sum.units) : '—'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={S.card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>{ARABIC ? 'الأكثر مبيعاً' : 'Top products'}</div>
          {top.map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${C.line}`, fontSize: 14 }}>
              <span>{t.name}</span><span style={{ color: C.dim }}>{Number(t.units)} · {money(t.revenue)}</span>
            </div>
          ))}
          {!top.length && <div style={{ color: C.dim, fontSize: 13 }}>{ARABIC ? 'لا بيانات' : 'No data'}</div>}
        </div>
        <div style={S.card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>{ARABIC ? 'مخزون منخفض' : 'Low stock'}</div>
          {low.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${C.line}`, fontSize: 14 }}>
              <span>{p.name}</span><span style={{ color: Number(p.stock) <= 0 ? C.red : C.accent }}>{Number(p.stock)}</span>
            </div>
          ))}
          {!low.length && <div style={{ color: C.dim, fontSize: 13 }}>{ARABIC ? 'كل المخزون جيد' : 'All stocked'}</div>}
        </div>
      </div>
      <div style={S.card}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>⌛ {ARABIC ? 'قرب الانتهاء (٣٠ يوم)' : 'Expiring soon (30 days)'}</div>
        {exp.map((e) => {
          const dl = Number(e.days_left);
          const col = dl < 0 ? C.red : dl <= 7 ? C.accent : C.dim;
          return (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${C.line}`, fontSize: 14 }}>
              <span>{e.product} {e.supplier ? <span style={{ color: C.dim, fontSize: 12 }}>· {e.supplier}</span> : null}</span>
              <span style={{ color: col, fontWeight: 700 }}>{e.expiry} ({dl < 0 ? (ARABIC ? 'منتهي' : 'expired') : dl + (ARABIC ? ' يوم' : 'd')})</span>
            </div>
          );
        })}
        {!exp.length && <div style={{ color: C.dim, fontSize: 13 }}>{ARABIC ? 'لا شيء قريب الانتهاء' : 'Nothing expiring soon'}</div>}
      </div>
    </div>
  );
}
function Stat({ label, value, accent }) {
  return (
    <div style={S.card}>
      <div style={{ color: C.dim, fontSize: 12, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: accent ? C.accent : C.text }}>{value}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Settings — change password, (admin) users + categories
// ══════════════════════════════════════════════════════════════════════════════
function SettingsView({ user, isAdmin, notify }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
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
    <form onSubmit={submit} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 800 }}>{ARABIC ? 'تغيير كلمة المرور' : 'Change password'}</div>
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
    <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 800 }}>{ARABIC ? 'الفئات' : 'Categories'}</div>
      <input style={S.input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Drinks, Snacks, Dairy…" />
      <button onClick={save} style={{ ...S.btn, alignSelf: 'start' }}>{ARABIC ? 'حفظ' : 'Save'}</button>
    </div>
  );
}

function Users({ me, notify }) {
  const [users, setUsers] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'user', views: [] });
  const VIEW_OPTS = ['inventory', 'history', 'reports'];
  const load = useCallback(() => api.get('/users').then(setUsers).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (form.password.length < 8) { notify(ARABIC ? 'كلمة المرور 8 أحرف على الأقل' : 'Password 8+ chars', 'red'); return; }
    try {
      await api.post('/users', { username: form.username, password: form.password, role: form.role, views: form.role === 'admin' ? [] : form.views });
      setAdding(false); setForm({ username: '', password: '', role: 'user', views: [] }); load();
      notify(ARABIC ? 'تمت إضافة المستخدم' : 'User added', 'green');
    } catch (ex) { notify(ex.message === 'exists' ? (ARABIC ? 'اسم مستخدم مكرر' : 'Username taken') : (ARABIC ? 'فشل' : 'Failed'), 'red'); }
  };
  const del = async (u) => {
    if (!window.confirm((ARABIC ? 'حذف ' : 'Delete ') + u.username + '?')) return;
    try { await api.del('/users/' + u.id); load(); } catch (_) { notify(ARABIC ? 'فشل' : 'Failed', 'red'); }
  };
  const toggleView = (v) => setForm((f) => ({ ...f, views: f.views.includes(v) ? f.views.filter((x) => x !== v) : [...f.views, v] }));

  return (
    <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 800 }}>{ARABIC ? 'المستخدمون' : 'Users'}</div>
        <button onClick={() => setAdding((a) => !a)} style={S.btnGhost}>{adding ? (ARABIC ? 'إغلاق' : 'Close') : (ARABIC ? '+ مستخدم' : '+ User')}</button>
      </div>
      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, background: C.panel2, borderRadius: 8 }}>
          <input style={S.input} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={ARABIC ? 'اسم المستخدم' : 'Username'} autoCapitalize="off" />
          <input style={S.input} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={ARABIC ? 'كلمة المرور (8+)' : 'Password (8+)'} />
          <div style={{ display: 'flex', gap: 8 }}>
            {['user', 'admin'].map((r) => (
              <button key={r} onClick={() => setForm({ ...form, role: r })} style={{ ...S.btnGhost, flex: 1, ...(form.role === r ? { background: C.blue, color: '#fff', borderColor: C.blue } : {}) }}>{r}</button>
            ))}
          </div>
          {form.role === 'user' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {VIEW_OPTS.map((v) => (
                <button key={v} onClick={() => toggleView(v)} style={{ ...S.btnGhost, padding: '6px 10px', ...(form.views.includes(v) ? { background: C.accent, color: C.accentText, borderColor: C.accent } : {}) }}>{VIEW_LABELS[v]}</button>
              ))}
            </div>
          )}
          <button onClick={add} style={{ ...S.btn, alignSelf: 'start' }}>{ARABIC ? 'إضافة' : 'Add'}</button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {users.map((u) => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${C.line}` }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{u.username}</span>
              <span style={{ color: C.dim, fontSize: 12, marginInlineStart: 8 }}>{u.role}{u.role !== 'admin' && (u.allowed_views || []).length ? ' · ' + u.allowed_views.join(', ') : ''}</span>
            </div>
            {u.id !== me.id && <button onClick={() => del(u)} style={{ ...S.btnGhost, padding: '5px 10px', color: C.red }}>{ARABIC ? 'حذف' : 'Del'}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
