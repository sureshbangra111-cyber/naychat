# Deployment — single Node process + MongoDB

**One command runs the whole app.** The Express server serves the API *and* the
compiled frontend from the same port, so deployment is a single Node artifact.

```
npm ci
npm start          # builds the frontend, then serves everything on PORT
```

Open `http://localhost:4100/chat` (visitor) and `/admin/login` (admin).

## What the one process serves

| Path | Serves |
| --- | --- |
| `/api/*` | JSON API |
| `/chat`, `/chat/:id`, `/admin/login`, `/` | The built React app (SPA fallback) |
| `/assets/*` | Hashed bundles, cached 1 year, immutable |

SPA deep links and hard refreshes work on every route. Because everything is
same-origin, the httpOnly session cookies are first-party — no CORS, no
cross-site cookie problems.

## 1. MongoDB

Create a database and put its connection string in `MONGODB_URI`.

- Allow the API host's IP (or `0.0.0.0/0` for a public host).
- Use a **read/write** user.
- **The committed `server/.env` points at a LOCAL `127.0.0.1` database. Replace it
  before going live.**

## 2. Run it

Any Node 20 host works (Render, Railway, Fly, a VPS, systemd, Docker). No
hosting provider is hardcoded in this repo.

### Option A — single step (build + serve)

```
build command:  npm ci
start command:  npm start
health check:   GET /api/health  ->  {"ok":true,"database":"connected"}
```

`npm start` builds then serves, so `dist/` is always current.

### Option B — build and start as separate steps (recommended for most hosts)

Many platforms install with `npm ci --omit=dev`, which strips the build tools
(`tsc`, `vite`). That is fine, because **the server is compiled to plain JS** and
runs on plain Node — no build tools needed at runtime:

```
build command:  npm ci && npm run build     # needs devDependencies
start command:  npm run start:only          # runtime only
```

If you instead run `npm start` on a `--omit=dev` host you will see
`sh: tsc: command not found`, because that command tries to rebuild. Use
`start:only` there.

| Command | Runs | Needs devDeps? |
| --- | --- | --- |
| `npm run build` | Compiles frontend + server | yes |
| `npm start` | build, then serve | yes |
| `npm run start:only` | serve the existing build | **no** |
| `npm run create-admin:prod` | admin bootstrap from compiled JS | **no** |
| `npm run create-admin` | admin bootstrap from TS via `tsx` | yes |

Environment variables (all server-side; **never** `VITE_`-prefixed):

```
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net
MONGODB_DB=support_chat
SESSION_SECRET=<openssl rand -hex 32>
ADMIN_EMAIL=admin@chatadmin.local
ADMIN_PASSWORD="Admin@2026#Secure"
ADMIN_ROLE=owner
PORT=4100
CORS_ORIGINS=https://your-domain.example.com
```

> **Quote passwords containing `#`.** dotenv reads an unquoted `#` as a comment, so
> `Admin@2026#Secure` silently becomes `Admin@2026` and every sign-in fails.

> **CORS is only needed for a separate frontend host.** With the built-in server
> everything is same-origin. The value above is harmless to keep.

`npm start` sets `NODE_ENV=production` itself, so cookies get the `Secure` flag
even if the host forgets.

## 3. Create the admin (once, after the DB is reachable)

```bash
ADMIN_EMAIL=admin@chatadmin.local ADMIN_PASSWORD="Admin@2026#Secure" npm run create-admin
```

bcrypt-hashes it into MongoDB; never stores or prints a plaintext. Re-running
upserts, so it never duplicates.

## 4. Put it behind HTTPS

Terminate TLS with nginx/Caddy or let your platform do it. Cookies are issued
with `Secure` when the request arrives over HTTPS, and are simply omitted over
plain HTTP — so **an HTTP-only deployment will not keep sessions**.

nginx example:

```nginx
location / {
  proxy_pass http://127.0.0.1:4100;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;   # makes `Secure` cookies work
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## Production checklist

- [ ] HTTPS with `X-Forwarded-Proto` forwarded
- [ ] `MONGODB_URI` points at the real database, not `127.0.0.1`
- [ ] `SESSION_SECRET` is 32 random bytes, unique to this environment
- [ ] `npm run create-admin` executed against the production database
- [ ] `server/.env` gitignored and **never committed**
- [ ] `/api/health` reports `database: connected`
- [ ] A process manager restarts Node on exit (systemd, pm2, or your platform)

## Security implemented

| Control | Implementation |
| --- | --- |
| Admin passwords | bcrypt cost 12; never stored or logged in plaintext |
| Sessions | Server-side records + httpOnly cookie; only a SHA-256 hash persisted |
| Logout | Real revocation (session row deleted) |
| Expiry | 8h admin / 30d visitor + MongoDB TTL index |
| Cookies | `HttpOnly; SameSite=Lax`, `Secure` over HTTPS |
| Brute force | 10 failed logins / 15 min per IP |
| XSS | Messages are plain text; React renders text nodes only |
| Injection | Mongoose parameterised queries; regex escaped in search |
| Authorisation | Every `/api/admin/*` route re-checks the session server-side |
| Visitor isolation | Ownership filtered on the server-resolved visitor, never client input |
| Static files | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` |

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Plain-text "Frontend build not found" | Run `npm run build`, or use `npm start` |
| `sh: tsc: command not found` | Dev tools were omitted. Run `npm run start:only` (build elsewhere) |
| 404 on `/api/*` | API not running, or proxy points at the wrong port |
| 500 on admin login | Check logs; usually Mongo unreachable |
| Password always rejected | Unquoted `#` in `.env`, or `create-admin` not re-run |
| Session lost every reload | No HTTPS / `X-Forwarded-Proto` not set → `Secure` cookie dropped |
