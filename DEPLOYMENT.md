# Deployment — single Node process + MongoDB

**One command runs the whole app.** The Express server serves the API *and* the
compiled frontend from the same port, so deployment is a single Node artifact.

```
npm ci
npm start          # builds the frontend, then serves everything on PORT
```

Open `http://localhost:4100/chat` (visitor) and `/admin/login` (admin).

## ⚠️ Attachments on serverless hosting (Vercel)

**Text chat, admin, Meta tracking and UTM attribution all work on Vercel.**
Image and voice attachments need persistent storage, because a serverless
function's filesystem is read-only and resets between invocations.

`ATTACHMENT_STORAGE_DRIVER=local` is for a single Node process or a host with a
persistent volume (a VPS, Railway/Render with a disk, Docker with a volume).

On Vercel, uploads return **HTTP 503** with
`"Sending photos and voice messages is temporarily unavailable. Please send your
message as text instead."`, and the server log records the reason. This is
deliberate: it is a clear, actionable message rather than a silent failure that
would lose a customer's screenshot.

To enable media on Vercel, either:

1. Implement an object-storage driver in
   `server/services/attachments/storage.ts` (the `AttachmentStorage` interface has
   `put` / `getStream` / `getStreamRange` / `remove` / `exists`) and set
   `ATTACHMENT_STORAGE_DRIVER` to it, or
2. Use **Vercel Blob** (`@vercel/blob`) — `put` becomes `upload`, and
   `getStream` returns a `Readable` from the stored blob.

Nothing else changes: controllers, services, models and the frontend are all
already driver-agnostic, and the storage-key/path-traversal guarantees live inside
the driver.

## Meta Ads / Conversions API

Tracking is optional and **off by default**.

### Browser Pixel — configured at runtime, no redeploy

The Pixel ID lives in MongoDB and is edited at **Admin → Settings → Meta Ads
Tracking**. It is served to the browser by `GET /api/public/config`.

> Do **not** add a `VITE_META_PIXEL_ID`. Vite inlines `VITE_*` values into the
> bundle at build time, which would mean a rebuild and redeploy every time the ID
> changes, and would bake an account identifier into your public JavaScript.

Verification steps:

1. Admin → Settings → paste the Pixel ID → enable → Save.
2. Press **Test Pixel** — confirms the format, the saved value, and that the
   public endpoint serves it. It never calls Meta and never needs JavaScript.
3. Open `/chat` in a normal browser, then check Meta Events Manager → Test
   Events. You should see `PageView` then `ViewContent`.
4. Start a chat and confirm `StartChat` + `Contact`.

### Conversions API — server-only secret

Add to **`server/.env`** (never a frontend `.env`):

```bash
META_PIXEL_ID=
META_CONVERSIONS_API_ACCESS_TOKEN=
META_GRAPH_API_VERSION=v21.0
META_CONVERSIONS_API_ENABLED=true
```

`META_CONVERSIONS_API_ACCESS_TOKEN` is a credential with write access to your
dataset. Treat it exactly like `SESSION_SECRET`:

* server environment only,
* never in `VITE_*`,
* never in MongoDB or the Admin Settings UI,
* never returned by `/api/public/config`,
* never logged.

If it is empty, Conversions API delivery is skipped entirely and the browser Pixel
keeps working. To confirm the server is not silently failing, set
`NODE_ENV` to development-style logging or watch for `[meta] Conversions API …`
lines in the server log; delivery errors are logged with the HTTP status only.


## What the one process serves

| Path | Serves |
| --- | --- |
| `/api/*` | JSON API |
| `/chat`, `/chat/:id`, `/admin/login`, `/` | The built React app (SPA fallback) |
| `/assets/*` | Hashed bundles, cached 1 year, immutable |

SPA deep links and hard refreshes work on every route. Because everything is
same-origin, the httpOnly session cookies are first-party — no CORS, no
cross-site cookie problems.

## Vercel

The repo ships a ready `vercel.json`, so this is a paste-and-deploy.

**Root Directory:** the folder containing `package.json`
(`anonymous-support-chat`) — if you push the repo root, leave it blank.

**Build & Output settings (Project → Settings → Build & Deployment):**

| Field | Value |
| --- | --- |
| Framework Preset | Other |
| Build Command | `npm run build` |
| Install Command | `npm install --include=dev` |
| Output Directory | *(leave blank)* |

**Environment Variables** (Project → Settings → Environment Variables):

```
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net
MONGODB_DB=support_chat
SESSION_SECRET=<openssl rand -hex 32>
ADMIN_EMAIL=admin@chatadmin.local
ADMIN_PASSWORD="Admin@2026#Secure"
PORT=4100
NODE_ENV=production
```

> `vercel.json` already sets `buildCommand`, `installCommand` and the serverless
> build, so the dashboard fields are usually left as-is.

Then create the admin once:

```bash
npx vercel env pull .env.local   # optional
npm run create-admin
```

Notes:
- Vercel runs **serverless**: each request imports `dist-server/vercel.js`,
  which exports the Express app as the request handler. There is no long-lived
  process, so the app must stay stateless — sessions live in MongoDB, which they
  already do.
- `includeFiles: ["dist/**"]` ships the built frontend into the function so
  `express.static` can serve it.
- Cookies are `Secure` automatically on Vercel's HTTPS domains.
- `trust proxy` is already enabled, so `x-forwarded-proto` is honoured.

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
