// /api/reports/* — grocery sales + stock reporting.
// Gated to the `reports` view (admins bypass) — a limited cashier cannot read revenue.
// All figures come from orders_main (sales) and products (stock). Tax-free build, so
// `total` is the gross take.
const router = require('express').Router();
const db = require('../db');
const { requireSession, requireView } = require('../auth');

const gate = [requireSession, requireView('reports', 'dashboard', 'history')];

// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD window on created_at. Missing = all time.
// Returns a WHERE fragment + params starting at $1.
function range(req) {
  const clauses = [];
  const params = [];
  if (req.query.from) { params.push(req.query.from); clauses.push(`created_at >= $${params.length}`); }
  if (req.query.to)   { params.push(req.query.to);   clauses.push(`created_at < ($${params.length}::date + 1)`); }
  return { where: clauses.length ? 'where ' + clauses.join(' and ') : '', params };
}

// GET /api/reports/summary → { orders, revenue, units }
router.get('/reports/summary', ...gate, async (req, res, next) => {
  try {
    const { where, params } = range(req);
    const { rows } = await db.query(
      `select count(*)::int as orders,
              coalesce(sum(total),0) as revenue,
              coalesce(sum((
                select sum((li->>'qty')::numeric)
                from jsonb_array_elements(coalesce(items,'[]'::jsonb)) li
              )),0) as units
         from orders_main ${where}`,
      params
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// GET /api/reports/daily → revenue grouped by day (last 90 days or the given window).
router.get('/reports/daily', ...gate, async (req, res, next) => {
  try {
    const { where, params } = range(req);
    const { rows } = await db.query(
      `select to_char(created_at::date, 'YYYY-MM-DD') as day,
              count(*)::int as orders,
              coalesce(sum(total),0) as revenue
         from orders_main ${where}
         group by created_at::date
         order by created_at::date desc
         limit 90`,
      params
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/reports/top-products?limit=20 → best sellers by units sold in the window.
router.get('/reports/top-products', ...gate, async (req, res, next) => {
  try {
    const { where, params } = range(req);
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 20;
    params.push(Math.min(limit, 200));
    const { rows } = await db.query(
      `select li->>'name' as name,
              sum((li->>'qty')::numeric) as units,
              sum((li->>'qty')::numeric * (li->>'price')::numeric) as revenue
         from orders_main o, jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) li
         ${where}
         group by li->>'name'
         order by units desc
         limit $${params.length}`,
      params
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/reports/low-stock?threshold=5 → products at/under the threshold (restock list).
router.get('/reports/low-stock', ...gate, async (req, res, next) => {
  try {
    let threshold = Number(req.query.threshold);
    if (!Number.isFinite(threshold)) threshold = 5;
    const { rows } = await db.query(
      `select id, barcode, name, cat, stock from products
        where active and coalesce(stock,0) <= $1
        order by stock asc, name`,
      [threshold]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
