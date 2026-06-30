// CashierPOS API server (Heroku). Serves the /api/* JSON API and the static React
// build from one dyno. Replaces the Supabase REST/anon-key model — the DB is reached
// only through this server, which authorizes every request server-side.
try { require('dotenv').config(); } catch (_) { /* dotenv optional in production */ }

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1); // Heroku terminates TLS at the router; needed for rate-limit IPs

// CSP — the build is self-hosted and loads no external scripts. 'unsafe-inline' is kept on
// script-src for CRA's inline runtime chunk (the app has no HTML-injection sink — React
// escapes everything, no dangerouslySetInnerHTML — so inline-script XSS isn't reachable).
// To tighten to script-src 'self' later: build with INLINE_RUNTIME_CHUNK=false.
// style-src needs 'unsafe-inline' for the UI's React inline style={{}} attributes.
// connect-src allows same-origin API + Sentry ingest. img-src allows data: + https: (menu images).
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'img-src': ["'self'", 'data:', 'https:'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
      // localhost/127.0.0.1 allowed so the page can reach the local print bridge (Dealer).
      'connect-src': ["'self'", 'https://*.sentry.io', 'https://*.ingest.sentry.io', 'http://localhost:*', 'http://127.0.0.1:*'],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'frame-ancestors': ["'none'"],
    },
  },
}));
app.use(compression());

// CORS — Bearer auth (no cookies). Same-origin requests (no Origin header) always pass.
// Cross-origin is blocked unless the Origin is in CORS_ORIGINS (comma-separated env).
// Default (unset) = same-origin only, which is all the web app needs.
const corsAllow = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                 // same-origin, curl, health checks
    if (corsAllow.includes(origin)) return cb(null, true);
    return cb(null, false);                             // block cross-origin not on the allowlist
  },
}));

app.use(express.json({ limit: '2mb' }));           // orders carry an items[] array

// Throttle auth endpoints (login + reset) to blunt credential stuffing.
app.use(['/api/auth/login', '/api/auth/request-reset', '/api/auth/confirm-reset'],
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', require('./routes'));

// ── Static React build (optional — present after `npm run build` / heroku-postbuild)
const buildDir = path.join(__dirname, '..', 'build');
const buildIndex = path.join(buildDir, 'index.html');
if (fs.existsSync(buildIndex)) {
  // Hashed assets (main.[hash].js/css) keep default caching; index.html must NOT be cached
  // so every app launch fetches the current shell → current bundle. Otherwise an installed
  // PWA can pin a stale index.html and run an old JS build (floors drift to different versions).
  app.use(express.static(buildDir, {
    setHeaders: (res, p) => {
      if (p.endsWith('index.html')) res.set('Cache-Control', 'no-store, must-revalidate');
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.set('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(buildIndex);
  });
} else {
  app.get('/', (_req, res) =>
    res.json({ status: 'api-only', note: 'No React build present. Run `npm run build` to serve the app.' }));
}

// JSON 404 for unmatched /api routes.
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// Centralised error handler — never leak internals.
app.use((err, _req, res, _next) => {
  console.error('[api] error:', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'server' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`CashierPOS API listening on :${PORT}`));
