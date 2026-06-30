# Deploy — Dukkan grocery POS (Heroku + Postgres)

Single-dyno deploy: the Express server (`server/index.js`) serves both the `/api` JSON API
and the built React app. `Procfile` runs `release: node server/migrate.js` (applies
migrations on every deploy) and `web: node server/index.js`.

Replace `<APP>` with your chosen Heroku app name and `<...>` placeholders with real values.
**Passwords are never committed** — they only ever live in env at seed time (8+ chars).

## 1. Create the app + database

```bash
heroku create <APP>
heroku addons:create heroku-postgresql:essential-0 -a <APP>
```

## 2. Config

```bash
heroku config:set NODE_ENV=production SESSION_TTL_HOURS=12 -a <APP>
# DATABASE_URL is set automatically by the Postgres addon.
```

Optional — admin forgot-password (server-side EmailJS). Skip if not needed; login still works.
```bash
heroku config:set EMAILJS_SERVICE_ID=<...> EMAILJS_TEMPLATE_ID=<...> \
  EMAILJS_PUBLIC_KEY=<...> EMAILJS_PRIVATE_KEY=<...> -a <APP>
# Also enable "Allow EmailJS API for non-browser applications" in the EmailJS dashboard.
# The template must reference {{code}}.
```

## 3. Deploy (runs migrate automatically via release phase)

```bash
git init && git add -A && git commit -m "Dukkan grocery POS"
heroku git:remote -a <APP>
git push heroku main      # release phase applies server/migrations/0001_schema.sql
```

If migrations need a manual run: `heroku run npm run migrate -a <APP>`.

## 4. Seed the first admin (and any cashiers)

```bash
heroku run "ADMIN_USERNAME=owner ADMIN_PASSWORD=<prompt> npm run seed:admin" -a <APP>
```

Add cashiers / limited users (grant `reports` to anyone who must see revenue — it is enforced
server-side; `inventory`/`history` likewise). Sales is always allowed.
```bash
heroku run "USERS_JSON='[
  {\"username\":\"cashier1\",\"password\":\"<prompt>\",\"role\":\"user\",\"allowed_views\":[\"inventory\"]},
  {\"username\":\"manager\",\"password\":\"<prompt>\",\"role\":\"user\",\"allowed_views\":[\"inventory\",\"history\",\"reports\"]}
]' npm run seed:users" -a <APP>
```

Open it: `heroku open -a <APP>`. Log in, go to **Inventory → + Product** (or just scan an
unknown barcode on the Sales screen → quick-add). Then scan to sell.

## 5. Backups

essential-tier keeps ~7 days of daily backups. Set the daily schedule:
```bash
heroku pg:backups:schedule DATABASE_URL --at '02:00 Asia/Amman' -a <APP>
```
For long-term offsite retention, ask about the triweekly GitHub-Action backup job.

## Wipe test sales before go-live (keeps products + users)

```bash
heroku run "CONFIRM_WIPE=YES npm run reset:data" -a <APP>
```
