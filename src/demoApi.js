/* eslint-disable */
// In-browser MOCK API for the GitHub Pages preview (no backend/DB).
// Activated only when REACT_APP_DEMO === '1' (see src/api.js). Implements the same
// contract as the real api.js (get/post/put/patch/del + token helpers), backed by
// localStorage so data survives reloads. The real Heroku build never imports this.
//
// Demo logins (any password):  admin / admin   ·   cashier / cashier
const LS_KEY = 'dukkan_demo_db';
const DEMO_BANNER = true;

const seed = () => ({
  products: [
    { id: 1, barcode: '6281000011002', name: 'Laban 1L', price: 1.250, cat: 'Dairy', cost: 0.9, stock: 24, active: true },
    { id: 2, barcode: '6281000022003', name: 'Pita Bread', price: 0.400, cat: 'Bakery', cost: 0.25, stock: 60, active: true },
    { id: 3, barcode: '5449000000996', name: 'Cola 330ml', price: 0.500, cat: 'Drinks', cost: 0.3, stock: 4, active: true },
    { id: 4, barcode: '6281000033004', name: 'Potato Chips', price: 0.750, cat: 'Snacks', cost: 0.45, stock: 18, active: true },
    { id: 5, barcode: '6281000044005', name: 'Tomatoes 1kg', price: 0.900, cat: 'Produce', cost: 0.6, stock: 12, active: true },
    { id: 6, barcode: '6281000055006', name: 'Dish Soap', price: 1.100, cat: 'Household', cost: 0.7, stock: 9, active: true },
  ],
  orders: [],
  users: [
    { id: 'u-admin', username: 'admin', role: 'admin', allowed_views: [], active: true },
    { id: 'u-cashier', username: 'cashier', role: 'user', allowed_views: ['inventory', 'history'], active: true },
  ],
  categories: ['Drinks', 'Snacks', 'Dairy', 'Produce', 'Bakery', 'Household', 'Frozen', 'Other'],
  invoice: 0,
  nextId: 7,
});

function load() {
  try { const d = JSON.parse(localStorage.getItem(LS_KEY)); if (d && d.products) return d; } catch (_) {}
  const s = seed(); save(s); return s;
}
function save(db) { localStorage.setItem(LS_KEY, JSON.stringify(db)); }

let _token = null, _onExpired = null;
const err = (code, status) => { const e = new Error(code); e.status = status; e.message = code; throw e; };
const userJson = (u) => ({ id: u.id, username: u.username, role: u.role, allowed_views: u.allowed_views, token: 'demo-' + u.id });
const currentUser = (db) => db.users.find((u) => _token === 'demo-' + u.id) || null;

// Parse "/path?query" → { parts:[...], query:{...} }
function parse(path) {
  const [p, qs] = String(path).split('?');
  const parts = p.split('/').filter(Boolean);
  const query = {};
  (qs || '').split('&').filter(Boolean).forEach((kv) => { const [k, v] = kv.split('='); query[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
  return { parts, query };
}

async function handle(method, path, body) {
  const db = load();
  const { parts, query } = parse(path);
  const top = parts[0];

  // ── auth ──
  if (top === 'auth') {
    const action = parts[1];
    if (action === 'login') {
      const u = db.users.find((x) => x.username === String(body.username || '').toLowerCase().trim());
      if (!u) err('invalid', 401);
      _token = 'demo-' + u.id;
      return userJson(u);
    }
    if (action === 'validate') { const u = currentUser(db); if (!u) err('session', 401); return userJson(u); }
    if (action === 'logout') { _token = null; return { ok: true }; }
    if (action === 'change-password') return { ok: true };
    err('not_found', 404);
  }

  const me = currentUser(db);
  if (!me) err('session', 401);
  const isAdmin = me.role === 'admin';

  // ── products ──
  if (top === 'products') {
    if (method === 'GET' && parts[1] === 'barcode') {
      const code = decodeURIComponent(parts[2] || '');
      const p = db.products.find((x) => x.barcode === code);
      if (!p) err('not_found', 404);
      return p;
    }
    if (method === 'GET') return db.products.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (method === 'POST') {
      if (body.barcode && db.products.some((x) => x.barcode === body.barcode)) err('exists', 409);
      const p = { id: db.nextId++, barcode: body.barcode || null, name: body.name, price: +body.price || 0, cat: body.cat || null, cost: +body.cost || 0, stock: +body.stock || 0, active: true };
      db.products.push(p); save(db); return p;
    }
    if (method === 'PUT') {
      const p = db.products.find((x) => String(x.id) === parts[1]);
      if (p) Object.assign(p, { barcode: body.barcode || null, name: body.name, price: +body.price || 0, cat: body.cat || null, cost: +body.cost || 0, stock: +body.stock || 0 });
      save(db); return { ok: true };
    }
    if (method === 'PATCH' && parts[2] === 'stock') {
      const p = db.products.find((x) => String(x.id) === parts[1]);
      if (!p) err('not_found', 404);
      p.stock = (+p.stock || 0) + (+body.delta || 0); save(db); return { ok: true, stock: p.stock };
    }
    if (method === 'DELETE') { db.products = db.products.filter((x) => String(x.id) !== parts[1]); save(db); return { ok: true }; }
  }

  if (top === 'stock-log') return { ok: true };

  if (top === 'settings' && parts[1] === 'categories') {
    if (method === 'GET') return { value: JSON.stringify(db.categories) };
    if (method === 'PUT') { try { db.categories = JSON.parse(body.value); } catch (_) {} save(db); return { ok: true }; }
  }

  // ── invoice + orders ──
  if (top === 'invoice' && parts[1] === 'next') { db.invoice += 1; save(db); return db.invoice; }
  if (top === 'orders') {
    if (method === 'POST') { db.orders.unshift({ ...body, created_at: new Date().toISOString() }); save(db); return { ok: true }; }
    if (method === 'GET') { const lim = +query.limit || 200; return db.orders.slice(0, lim); }
    if (method === 'DELETE') { db.orders = db.orders.filter((o) => o.id !== parts[1]); save(db); return { ok: true }; }
  }

  // ── reports ──
  if (top === 'reports') {
    const inRange = (o) => {
      const d = (o.date || (o.created_at || '').slice(0, 10));
      if (query.from && d < query.from) return false;
      if (query.to && d > query.to) return false;
      return true;
    };
    const sales = db.orders.filter(inRange);
    if (parts[1] === 'summary') {
      const revenue = sales.reduce((s, o) => s + (+o.total || 0), 0);
      const units = sales.reduce((s, o) => s + (o.items || []).reduce((n, l) => n + (+l.qty || 0), 0), 0);
      return { orders: sales.length, revenue, units };
    }
    if (parts[1] === 'daily') {
      const m = {}; sales.forEach((o) => { const d = o.date || (o.created_at || '').slice(0, 10); (m[d] = m[d] || { day: d, orders: 0, revenue: 0 }).orders++; m[d].revenue += +o.total || 0; });
      return Object.values(m).sort((a, b) => b.day.localeCompare(a.day));
    }
    if (parts[1] === 'top-products') {
      const m = {}; sales.forEach((o) => (o.items || []).forEach((l) => { (m[l.name] = m[l.name] || { name: l.name, units: 0, revenue: 0 }).units += +l.qty || 0; m[l.name].revenue += (+l.price || 0) * (+l.qty || 0); }));
      return Object.values(m).sort((a, b) => b.units - a.units).slice(0, +query.limit || 20);
    }
    if (parts[1] === 'low-stock') { const t = +query.threshold || 5; return db.products.filter((p) => p.active && (+p.stock || 0) <= t).sort((a, b) => a.stock - b.stock); }
  }

  // ── users (admin) ──
  if (top === 'users') {
    if (!isAdmin) err('not_admin', 403);
    if (method === 'GET') return db.users.map((u) => ({ id: u.id, username: u.username, role: u.role, allowed_views: u.allowed_views, active: u.active }));
    if (method === 'POST') {
      if (db.users.some((u) => u.username === String(body.username).toLowerCase())) err('exists', 400);
      const u = { id: 'u-' + Date.now(), username: String(body.username).toLowerCase(), role: body.role || 'user', allowed_views: body.views || [], active: true };
      db.users.push(u); save(db); return { id: u.id, ok: true };
    }
    if (method === 'PUT') { const u = db.users.find((x) => x.id === parts[1]); if (u) Object.assign(u, body); save(db); return { ok: true }; }
    if (method === 'DELETE') { db.users = db.users.filter((x) => x.id !== parts[1]); save(db); return { ok: true }; }
  }

  err('not_found', 404);
}

export const setToken = (t) => { _token = t || null; };
export const getToken = () => _token;
export const setOnSessionExpired = (fn) => { _onExpired = fn; };
export const demoBanner = DEMO_BANNER;

export const api = {
  get: (p) => handle('GET', p),
  post: (p, b) => handle('POST', p, b || {}),
  put: (p, b) => handle('PUT', p, b || {}),
  patch: (p, b) => handle('PATCH', p, b || {}),
  del: (p) => handle('DELETE', p),
  setToken, getToken, setOnSessionExpired,
};
export default api;
