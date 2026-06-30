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
  const allowed = (v) => v === 'sales' || v === 'settings' || isAdmin || (user.allowed_views || []).includes(v);
  const navViews = VIEWS.filter(allowed);

  return (
    <div dir={ARABIC ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'DM Sans', system-ui, sans-serif", display: 'flex', flexDirection: 'column' }}>
      <Header user={user} view={view} setView={setView} navViews={navViews} onLogout={handleLogout} />
      <main style={{ flex: 1, padding: 16, maxWidth: 1180, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {view === 'sales' && <SalesView user={user} notify={notify} />}
        {view === 'inventory' && allowed('inventory') && <InventoryView isAdmin={isAdmin} notify={notify} />}
        {view === 'history' && allowed('history') && <HistoryView notify={notify} />}
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

function Header({ user, view, setView, navViews, onLogout }) {
  return (
    <header style={{ background: C.panel, borderBottom: `1px solid ${C.line}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ fontWeight: 800, fontSize: 20, color: C.accent }}>{STORE_NAME}</div>
      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
        {navViews.map((v) => (
          <button key={v} onClick={() => setView(v)}
            style={{ ...S.btnGhost, ...(view === v ? { background: C.accent, color: C.accentText, borderColor: C.accent } : {}) }}>
            {VIEW_LABELS[v]}
          </button>
        ))}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: C.dim }}>{user.username} ({user.role})</span>
        <button onClick={onLogout} style={S.btnGhost}>{ARABIC ? 'خروج' : 'Logout'}</button>
      </div>
    </header>
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

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const u = await api.post('/auth/login', { username, password });
      onLogin(u);
    } catch (ex) {
      setErr(ARABIC ? 'اسم المستخدم أو كلمة المرور غير صحيحة' : 'Invalid username or password');
    } finally { setBusy(false); }
  };

  return (
    <div dir={ARABIC ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <form onSubmit={submit} style={{ ...S.card, width: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 26, color: C.accent, textAlign: 'center' }}>{STORE_NAME}</div>
        <div style={{ color: C.dim, fontSize: 13, textAlign: 'center', marginTop: -8 }}>{ARABIC ? 'تسجيل الدخول' : 'Sign in'}</div>
        <input style={S.input} placeholder={ARABIC ? 'اسم المستخدم' : 'Username'} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoCapitalize="off" />
        <input style={S.input} type="password" placeholder={ARABIC ? 'كلمة المرور' : 'Password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <div style={{ color: C.red, fontSize: 13 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ ...S.btn, opacity: busy ? 0.6 : 1 }}>{busy ? '…' : (ARABIC ? 'دخول' : 'Login')}</button>
      </form>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Sales — scan → cart → checkout
// ══════════════════════════════════════════════════════════════════════════════
function SalesView({ user, notify }) {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);          // [{id,barcode,name,price,qty}]
  const [scan, setScan] = useState('');
  const [search, setSearch] = useState('');
  const [pay, setPay] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [newProduct, setNewProduct] = useState(null); // {barcode} → modal
  const [busy, setBusy] = useState(false);
  const scanRef = useRef(null);

  const loadProducts = useCallback(async () => {
    try { setProducts(await api.get('/products')); } catch (_) {}
  }, []);
  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { scanRef.current && scanRef.current.focus(); }, []);

  const addToCart = useCallback((p, qty = 1) => {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.id === p.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + qty };
        return next;
      }
      return [...prev, { id: p.id, barcode: p.barcode, name: p.name, price: Number(p.price) || 0, qty }];
    });
  }, []);

  const onScan = async (code) => {
    const c = String(code || '').trim();
    if (!c) return;
    setScan('');
    // Fast path: already in the loaded catalogue.
    const local = products.find((p) => p.barcode && p.barcode === c);
    if (local) { addToCart(local); return; }
    try {
      const p = await api.get('/products/barcode/' + encodeURIComponent(c));
      addToCart(p);
      setProducts((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    } catch (ex) {
      if (ex.status === 404) {
        setNewProduct({ barcode: c });        // unknown code → quick-add modal
      } else {
        notify(ARABIC ? 'تعذّر البحث' : 'Lookup failed', 'red');
      }
    }
  };

  const setQty = (id, qty) => setCart((prev) => prev.flatMap((l) => (l.id === id ? (qty <= 0 ? [] : [{ ...l, qty }]) : [l])));
  const removeLine = (id) => setCart((prev) => prev.filter((l) => l.id !== id));

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const change = pay === 'cash' && tendered ? (Number(tendered) - total) : null;

  const checkout = async () => {
    if (!cart.length || busy) return;
    setBusy(true);
    try {
      const invoice_no = await api.get('/invoice/next?floor=' + DEFAULT_FLOOR);
      const { date, time } = nowParts();
      const sale = {
        id: uid(), floor: DEFAULT_FLOOR, items: cart, sub: total, tax: 0, svc: 0,
        disc: 0, total, pay, waiter: user.username, status: 'paid', date, time, invoice_no,
      };
      await api.post('/orders', sale);
      // Deduct stock per line (best-effort; sale already persisted).
      await Promise.all(cart.map((l) =>
        api.patch('/products/' + l.id + '/stock', { delta: -l.qty }).catch(() => {})
      ));
      api.post('/stock-log', { kind: 'sale', changed_by: user.username, name: `invoice ${invoice_no}`, new_qty: cart.length }).catch(() => {});
      printReceipt(sale);
      setCart([]); setTendered(''); setPay('cash');
      loadProducts();
      notify(ARABIC ? `تمت الفاتورة #${invoice_no}` : `Sale #${invoice_no} complete`, 'green');
      scanRef.current && scanRef.current.focus();
    } catch (ex) {
      notify(ex.message === 'invoice_taken' ? (ARABIC ? 'تعارض رقم الفاتورة، أعد المحاولة' : 'Invoice clash — retry') : (ARABIC ? 'فشل الدفع' : 'Checkout failed'), 'red');
    } finally { setBusy(false); }
  };

  const filtered = search.trim()
    ? products.filter((p) => (p.name || '').toLowerCase().includes(search.toLowerCase()) || (p.barcode || '').includes(search)).slice(0, 30)
    : [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, alignItems: 'start' }}>
      {/* Left: scan + catalogue search */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={S.card}>
          <label style={{ fontSize: 12, color: C.dim, fontWeight: 700 }}>{ARABIC ? 'امسح الباركود' : 'Scan barcode'}</label>
          <input ref={scanRef} style={{ ...S.input, marginTop: 6, fontSize: 18, letterSpacing: 1 }}
            value={scan} onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onScan(scan); }}
            placeholder={ARABIC ? 'وجّه الماسح هنا…' : 'Focus here and scan…'} inputMode="numeric" />
        </div>
        <div style={S.card}>
          <input style={S.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={ARABIC ? 'بحث بالاسم أو الباركود لإضافة يدوية' : 'Search name / barcode to add manually'} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {filtered.map((p) => (
              <button key={p.id} onClick={() => { addToCart(p); setSearch(''); }} style={{ ...S.btnGhost, display: 'flex', justifyContent: 'space-between', textAlign: 'start' }}>
                <span>{p.name} <span style={{ color: C.dim, fontSize: 12 }}>{p.barcode || ''}</span></span>
                <span style={{ color: C.accent }}>{money(p.price)}</span>
              </button>
            ))}
            {search.trim() && !filtered.length && <div style={{ color: C.dim, fontSize: 13 }}>{ARABIC ? 'لا نتائج' : 'No matches'}</div>}
          </div>
        </div>
      </div>

      {/* Right: bill */}
      <div style={{ ...S.card, position: 'sticky', top: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 10 }}>{ARABIC ? 'الفاتورة' : 'Bill'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '46vh', overflow: 'auto' }}>
          {!cart.length && <div style={{ color: C.dim, fontSize: 14, padding: '20px 0', textAlign: 'center' }}>{ARABIC ? 'امسح منتجاً للبدء' : 'Scan a product to begin'}</div>}
          {cart.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
                <div style={{ fontSize: 12, color: C.dim }}>{money(l.price)}</div>
              </div>
              <button onClick={() => setQty(l.id, l.qty - 1)} style={qtyBtn}>−</button>
              <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{l.qty}</span>
              <button onClick={() => setQty(l.id, l.qty + 1)} style={qtyBtn}>+</button>
              <span style={{ minWidth: 78, textAlign: 'end', fontWeight: 700 }}>{money(l.price * l.qty)}</span>
              <button onClick={() => removeLine(l.id)} style={{ ...qtyBtn, color: C.red }}>×</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, fontWeight: 800, margin: '12px 0' }}>
          <span>{ARABIC ? 'المجموع' : 'Total'}</span><span style={{ color: C.accent }}>{money(total)}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {['cash', 'card'].map((m) => (
            <button key={m} onClick={() => setPay(m)} style={{ ...S.btnGhost, flex: 1, ...(pay === m ? { background: C.blue, color: '#fff', borderColor: C.blue } : {}) }}>
              {m === 'cash' ? (ARABIC ? 'نقدي' : 'Cash') : (ARABIC ? 'بطاقة' : 'Card')}
            </button>
          ))}
        </div>
        {pay === 'cash' && (
          <div style={{ marginBottom: 8 }}>
            <input style={S.input} type="number" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={ARABIC ? 'المبلغ المدفوع' : 'Cash tendered'} />
            {change != null && change >= 0 && <div style={{ color: C.green, fontSize: 14, marginTop: 6, fontWeight: 700 }}>{ARABIC ? 'الباقي' : 'Change'}: {money(change)}</div>}
          </div>
        )}
        <button onClick={checkout} disabled={!cart.length || busy} style={{ ...S.btn, width: '100%', padding: '14px', fontSize: 16, opacity: (!cart.length || busy) ? 0.5 : 1 }}>
          {busy ? '…' : (ARABIC ? 'إتمام البيع وطباعة' : 'Checkout & Print')}
        </button>
        {!!cart.length && <button onClick={() => setCart([])} style={{ ...S.btnGhost, width: '100%', marginTop: 8 }}>{ARABIC ? 'إلغاء الفاتورة' : 'Clear bill'}</button>}
      </div>

      {newProduct && (
        <ProductModal initial={newProduct} notify={notify}
          onClose={() => { setNewProduct(null); scanRef.current && scanRef.current.focus(); }}
          onSaved={(p) => { setProducts((prev) => [...prev, p]); addToCart(p); setNewProduct(null); scanRef.current && scanRef.current.focus(); }} />
      )}
    </div>
  );
}
const qtyBtn = { width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.panel2, color: C.text, fontSize: 18, lineHeight: '1', cursor: 'pointer', fontWeight: 700 };

// ── Add/Edit product modal (shared by Sales quick-add + Inventory) ──────────────
function ProductModal({ initial, onClose, onSaved, notify, editing }) {
  const [barcode, setBarcode] = useState(initial.barcode || '');
  const [name, setName] = useState(initial.name || '');
  const [price, setPrice] = useState(initial.price != null ? String(initial.price) : '');
  const [cat, setCat] = useState(initial.cat || '');
  const [stock, setStock] = useState(initial.stock != null ? String(initial.stock) : '');
  const [cost, setCost] = useState(initial.cost != null ? String(initial.cost) : '');
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
    const body = { barcode: barcode.trim() || null, name: name.trim(), price: Number(price) || 0, cat: cat || null, cost: Number(cost) || 0, stock: Number(stock) || 0 };
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
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label={ARABIC ? 'السعر' : 'Price'}><input style={S.input} type="number" step="0.001" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label={ARABIC ? 'الكمية' : 'Stock'}><input style={S.input} type="number" value={stock} onChange={(e) => setStock(e.target.value)} /></Field>
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
// History
// ══════════════════════════════════════════════════════════════════════════════
function HistoryView({ notify }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/orders?floor=' + DEFAULT_FLOOR + '&limit=200')
      .then(setSales).catch(() => notify(ARABIC ? 'تعذّر تحميل السجل' : 'Failed to load history', 'red'))
      .finally(() => setLoading(false));
  }, [notify]);

  if (loading) return <div style={{ color: C.dim }}>{ARABIC ? 'جارٍ التحميل…' : 'Loading…'}</div>;
  return (
    <div style={S.card}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead><tr style={{ color: C.dim, textAlign: ARABIC ? 'right' : 'left' }}>
          <th style={th}>#</th><th style={th}>{ARABIC ? 'التاريخ' : 'Date'}</th><th style={th}>{ARABIC ? 'الأصناف' : 'Items'}</th>
          <th style={th}>{ARABIC ? 'الدفع' : 'Pay'}</th><th style={{ ...th, textAlign: 'right' }}>{ARABIC ? 'المجموع' : 'Total'}</th><th style={th}></th>
        </tr></thead>
        <tbody>
          {sales.map((s) => (
            <tr key={s.id} style={{ borderTop: `1px solid ${C.line}` }}>
              <td style={td}>{s.invoice_no}</td>
              <td style={{ ...td, color: C.dim }}>{s.date} {s.time}</td>
              <td style={{ ...td, color: C.dim }}>{(s.items || []).reduce((n, l) => n + (l.qty || 0), 0)}</td>
              <td style={td}>{s.pay}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(s.total)}</td>
              <td style={{ ...td, textAlign: 'end' }}><button onClick={() => printReceipt(s)} style={{ ...S.btnGhost, padding: '5px 10px' }}>{ARABIC ? 'طباعة' : 'Print'}</button></td>
            </tr>
          ))}
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

  const load = useCallback(() => {
    const qs = `?from=${from}&to=${to}`;
    api.get('/reports/summary' + qs).then(setSum).catch(() => notify(ARABIC ? 'تعذّر تحميل التقارير' : 'Failed to load reports', 'red'));
    api.get('/reports/top-products' + qs + '&limit=10').then(setTop).catch(() => {});
    api.get('/reports/low-stock?threshold=5').then(setLow).catch(() => {});
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
