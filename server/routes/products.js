// /api/products + /api/stock-log
// The grocery catalogue. A product is keyed to the cashier by its barcode (UNIQUE), so a
// scan resolves to exactly one row. All reads/writes require a valid session; destructive
// ops (delete) require admin. Stock is absolute on write (SET stock = excluded.stock).
const router = require('express').Router();
const db = require('../db');
const { requireSession, requireAdmin } = require('../auth');
const { fail, dbError } = require('../validate');

// ── List ──────────────────────────────────────────────────────────────────────
// GET /api/products → all active products (catalogue for the sales + inventory screens).
router.get('/products', requireSession, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'select id, barcode, name, price, cat, cost, stock, unit, active from products order by name'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── Scan lookup ─────────────────────────────────────────────────────────────────
// GET /api/products/barcode/:code → the matching product or 404. The hot path for scanning:
// the cashier's scanner types the code + Enter, the client hits this, adds the line to the cart.
router.get('/products/barcode/:code', requireSession, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return fail(res, 'invalid', 400);
    const { rows } = await db.query(
      'select id, barcode, name, price, cat, cost, stock, unit, active from products where barcode = $1',
      [code]
    );
    if (!rows[0]) return fail(res, 'not_found', 404);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── Create / update ──────────────────────────────────────────────────────────────
// POST /api/products (create) — barcode + name required; price/cat/cost/stock optional.
// Returns the created row (with its generated id). 23505 (unique barcode) → 409 'exists'.
router.post('/products', requireSession, async (req, res, next) => {
  try {
    const p = req.body || {};
    const name = String(p.name || '').trim();
    if (!name) return fail(res, 'invalid', 400);
    const barcode = p.barcode != null && String(p.barcode).trim() !== '' ? String(p.barcode).trim() : null;
    const { rows } = await db.query(
      `insert into products (barcode, name, price, cat, cost, stock, unit)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id, barcode, name, price, cat, cost, stock, unit, active`,
      [barcode, name, p.price ?? 0, p.cat ?? null, p.cost ?? 0, p.stock ?? 0, p.unit === 'kg' ? 'kg' : 'ea']
    );
    res.json(rows[0]);
  } catch (e) { dbError(res, next, e); }
});

// PUT /api/products/:id (update) — full row edit. stock is ABSOLUTE (never incremented here).
router.put('/products/:id', requireSession, async (req, res, next) => {
  try {
    const p = req.body || {};
    const name = String(p.name || '').trim();
    if (!name) return fail(res, 'invalid', 400);
    const barcode = p.barcode != null && String(p.barcode).trim() !== '' ? String(p.barcode).trim() : null;
    await db.query(
      `update products set
         barcode = $1, name = $2, price = $3, cat = $4, cost = $5, stock = $6,
         unit = $7, active = coalesce($8, active), updated_at = now()
       where id = $9`,
      [barcode, name, p.price ?? 0, p.cat ?? null, p.cost ?? 0, p.stock ?? 0, p.unit === 'kg' ? 'kg' : 'ea', p.active ?? null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { dbError(res, next, e); }
});

// PATCH /api/products/:id/stock — decrement/adjust stock by a delta (used at checkout to
// deduct sold units). { delta: number }. Returns the new stock so the client can refresh.
router.patch('/products/:id/stock', requireSession, async (req, res, next) => {
  try {
    const delta = Number((req.body || {}).delta);
    if (!Number.isFinite(delta)) return fail(res, 'invalid', 400);
    const { rows } = await db.query(
      'update products set stock = coalesce(stock,0) + $1, updated_at = now() where id = $2 returning stock',
      [delta, req.params.id]
    );
    if (!rows[0]) return fail(res, 'not_found', 404);
    res.json({ ok: true, stock: rows[0].stock });
  } catch (e) { dbError(res, next, e); }
});

// DELETE /api/products/:id (admin) — hard delete.
router.delete('/products/:id', requireSession, requireAdmin, async (req, res, next) => {
  try {
    await db.query('delete from products where id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { dbError(res, next, e); }
});

// ── Stock log ─────────────────────────────────────────────────────────────────
router.post('/stock-log', requireSession, async (req, res, next) => {
  try {
    const s = req.body || {};
    await db.query(
      `insert into stock_log (kind,item_id,name,old_qty,new_qty,changed_by)
       values ($1,$2,$3,$4,$5,$6)`,
      [s.kind ?? null, s.item_id != null ? String(s.item_id) : null, s.name ?? null,
       s.old_qty ?? null, s.new_qty ?? null, s.changed_by ?? null]
    );
    res.json({ ok: true });
  } catch (e) { dbError(res, next, e); }
});

// ── Settings: categories (admin-editable product category list) ──────────────────
// app_settings.value holds a JSON string (TEXT, never ::jsonb) — same convention as the template.
router.get('/settings/categories', requireSession, async (req, res, next) => {
  try {
    const { rows } = await db.query("select value from app_settings where key='categories'");
    res.json(rows[0] || null);
  } catch (e) { next(e); }
});

router.put('/settings/categories', requireSession, requireAdmin, async (req, res, next) => {
  try {
    const value = (req.body || {}).value;
    await db.query(
      `insert into app_settings (key, value) values ('categories', $1)
       on conflict (key) do update set value = excluded.value`,
      [value ?? null]
    );
    res.json({ ok: true });
  } catch (e) { dbError(res, next, e); }
});

module.exports = router;
