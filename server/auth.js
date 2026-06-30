// Auth + session model for the CashierPOS API.
//
// Faithful port of the Supabase RPCs (AUTH_SETUP.sql / SECURITY_HARDENING.sql):
//   * Session = an opaque random token stored in app_users.session_token (NOT a JWT).
//   * Single active session per user (a new login overwrites the prior token).
//   * Hard TTL from login (default 12h); validate does NOT slide/renew the expiry.
//   * Passwords are bcrypt; bcryptjs verifies pgcrypto's $2a$ hashes unchanged.
//   * allowed_views is CLIENT-SIDE UI gating only — data routes require a valid
//     session (any role); only admin routes require role='admin'.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { sendResetCode, emailConfigured } = require('./email');

// Mask an email for display: ab***@example.com (never reveals the full address client-side).
function maskEmail(email) {
  return String(email || '').replace(/^(.{2}).*(@.*)$/, '$1***$2');
}

const _ttl = parseInt(process.env.SESSION_TTL_HOURS, 10);
const TTL_HOURS = Number.isFinite(_ttl) && _ttl > 0 ? _ttl : 12; // reject 0/NaN/negative → would mint already-expired tokens

const newToken = () => crypto.randomBytes(24).toString('hex'); // 48 hex chars (mirrors encode(gen_random_bytes(24),'hex'))

// Shape returned to the client on login/validate — never includes pass_hash/session_token-as-secret.
function userJson(u, token) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    allowed_views: u.allowed_views,
    token,
  };
}

// ── app_login ────────────────────────────────────────────────────────────────
async function loginUser(username, password) {
  const { rows } = await db.query(
    'select * from app_users where username = lower($1) and active',
    [String(username || '')]
  );
  const u = rows[0];
  if (!u) return null;
  if (!bcrypt.compareSync(String(password || ''), u.pass_hash)) return null;

  const token = newToken();
  await db.query(
    'update app_users set session_token = $1, token_exp = now() + make_interval(hours => $2) where id = $3',
    [token, TTL_HOURS, u.id]
  );
  return userJson(u, token);
}

// ── app_validate (no expiry renewal) ─────────────────────────────────────────
async function validateToken(token) {
  if (!token) return null;
  const { rows } = await db.query(
    'select * from app_users where session_token = $1 and token_exp > now() and active',
    [token]
  );
  const u = rows[0];
  return u ? userJson(u, u.session_token) : null;
}

// ── app_logout (idempotent, unauthenticated) ─────────────────────────────────
async function logoutToken(token) {
  if (token) await db.query('update app_users set session_token = null where session_token = $1', [token]);
  return { ok: true };
}

// ── app_change_password ──────────────────────────────────────────────────────
async function changePassword(token, oldPw, newPw) {
  const { rows } = await db.query(
    'select * from app_users where session_token = $1 and token_exp > now() and active',
    [token]
  );
  const u = rows[0];
  if (!u) return { error: 'session' };
  if (!bcrypt.compareSync(String(oldPw || ''), u.pass_hash)) return { error: 'wrong_old' };
  if (String(newPw || '').length < 8) return { error: 'too_short' };
  await db.query('update app_users set pass_hash = $1 where id = $2', [bcrypt.hashSync(String(newPw), 10), u.id]);
  return { ok: true };
}

// ── app_request_admin_reset (no session; forgot-password) ─────────────────────
// SECURITY: the 6-digit code is delivered out-of-band to the admin's own inbox
// (server-side EmailJS) and is NEVER returned in the HTTP response. The caller only
// learns a masked form of the destination email. This closes the prior account-takeover
// where any unauthenticated caller received the code directly.
async function requestReset(username) {
  if (!emailConfigured()) return { error: 'email_not_configured' };
  const { rows } = await db.query(
    "select * from app_users where username = lower($1) and role = 'admin' and active",
    [String(username || '')]
  );
  const u = rows[0];
  if (!u) return { error: 'no_admin' };
  if (!u.email) return { error: 'no_email' };

  const code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  // Send BEFORE persisting the code so a delivery failure never arms a confirm-reset.
  try {
    await sendResetCode(u.email, code, u.username);
  } catch (e) {
    console.error('[auth] reset email send failed:', e && e.message ? e.message : e);
    return { error: 'email_failed' };
  }
  await db.query(
    "update app_users set reset_code = $1, reset_exp = now() + interval '15 minutes' where id = $2",
    [code, u.id]
  );
  return { ok: true, email_masked: maskEmail(u.email), username: u.username };
}

// ── app_confirm_reset (no session; clears token to force re-login) ────────────
async function confirmReset(username, code, newPw) {
  const { rows } = await db.query(
    'select * from app_users where username = lower($1) and active',
    [String(username || '')]
  );
  const u = rows[0];
  if (!u) return { error: 'no_user' };
  if (!u.reset_code || new Date(u.reset_exp).getTime() < Date.now() || u.reset_code !== String(code)) {
    return { error: 'bad_code' };
  }
  if (String(newPw || '').length < 8) return { error: 'too_short' };
  await db.query(
    'update app_users set pass_hash = $1, reset_code = null, reset_exp = null, session_token = null where id = $2',
    [bcrypt.hashSync(String(newPw), 10), u.id]
  );
  return { ok: true };
}

// ── Token transport: Authorization: Bearer <token> ONLY.
// The legacy p_token query/body fallback was removed: tokens in URLs leak into
// Heroku router logs, proxies and browser history. The client only ever sends the
// Bearer header (src/api.js), so this is transparent to the app.
function getToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// ── Middleware: requireSession (mirrors _app_session) ─────────────────────────
async function requireSession(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'session' });
    const { rows } = await db.query(
      'select id, username, email, role, allowed_views from app_users where session_token = $1 and token_exp > now() and active',
      [token]
    );
    if (!rows[0]) return res.status(401).json({ error: 'session' });
    req.user = rows[0];   // NOTE: token_exp is deliberately NOT extended (no sliding TTL)
    req.token = token;
    next();
  } catch (e) {
    next(e);
  }
}

// ── Middleware: requireAdmin (mirrors _app_admin) — chain AFTER requireSession ─
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'not_admin' });
  next();
}

// ── Middleware: requireView(...keys) — chain AFTER requireSession ──────────────
// Server-side enforcement of allowed_views (previously UI-only). Admins bypass.
// A non-admin must have at least one of the listed view keys in allowed_views.
// Use to protect data that a limited operator (e.g. a "tables"-only waiter) must
// not read directly via the API — financial reports, revenue history, etc.
function requireView(...keys) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'session' });
    if (req.user.role === 'admin') return next();
    const views = Array.isArray(req.user.allowed_views) ? req.user.allowed_views : [];
    if (keys.some((k) => views.includes(k))) return next();
    return res.status(403).json({ error: 'forbidden' });
  };
}

module.exports = {
  TTL_HOURS,
  loginUser,
  validateToken,
  logoutToken,
  changePassword,
  requestReset,
  confirmReset,
  getToken,
  requireSession,
  requireAdmin,
  requireView,
};
