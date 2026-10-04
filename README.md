# Anonymous Support Chat

A support chat where **visitors never log in** and agents work from a console.

```
Visitor  →  /chat  →  anonymous server session  →  Express API  →  MongoDB
Admin    →  /admin/login  →  server-side auth  →  httpOnly session  →  console
```

> **Migrated from Supabase to Node/Express + MongoDB.** Supabase Auth, Postgres,
> RPC, RLS and Realtime have all been removed. The SQL business logic was ported
> into `server/services/conversations.ts`, where each function documents the RPC
> it replaces. See [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Quick start

```bash
# 1. Configure the server (copy and edit)
cp server/.env.example server/.env

# 2. Install
npm install

# 3. Create the admin account (bcrypt-hashes the password into MongoDB)
ADMIN_EMAIL=admin@chatadmin.local ADMIN_PASSWORD="your-password" npm run create-admin

# 4. Run the API and the frontend (two terminals)
npm run dev:server     # Express API
npm run dev            # Vite (proxies /api to the API)
```

Open `http://localhost:5176/chat` — no login. Admin console: `/admin/login`.

> **Quote passwords containing `#`.** dotenv reads an unquoted `#` as a comment,
> so `Admin@2026#Secure` silently becomes `Admin@2026` and sign-in always fails.

> **Before going live:** `server/.env` currently points at a **local** MongoDB
> (`127.0.0.1`). Replace `MONGODB_URI` with your hosted database and set
> `CORS_ORIGINS` to your real frontend origin. See [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Security model

**Customers are anonymous, but not unauthorised.**

A visitor id in `localStorage` is guessable and replayable, so the database never
authorises on it. Instead the server issues a random 256-bit token as an
**httpOnly** cookie — unreadable by JavaScript — and resolves it to a `Visitor`
document. Every conversation read/write filters on that server-resolved
`visitorRef`.

The browser's `anonymous_visitor_id` is **analytics only**. A visitor who
changes it, or edits a conversation id in the URL, gains nothing: the server
returns 404 because ownership never depends on client-supplied values.

| Concern | Implementation |
| --- | --- |
| Admin passwords | bcrypt (cost 12), never stored or logged in plaintext |
| Admin sessions | Server-side record + httpOnly cookie; only a SHA-256 hash is stored |
| Logout | Real revocation — the session row is deleted |
| Session expiry | 8h admin / 30d visitor, plus a MongoDB TTL index |
| CSRF | `SameSite=Lax` cookies |
| Brute force | `express-rate-limit`, 10 failed logins / 15 min |
| XSS | Messages stored/returned as plain text; React renders text nodes only |
| Injection | Mongoose parameterised queries; regex metacharacters escaped in search |
| Secrets | Server-only env vars, never `VITE_*`, never in the bundle |
| Error leakage | Only curated messages reach the browser; driver errors stay server-side |

Duplicate-send protection is enforced by a **unique index** on
`(conversationId, clientId)`, so concurrent retries cannot create two messages.

## API

| Method | Endpoint | Auth |
| --- | --- | --- |
| GET | `/api/session` | visitor (auto-created) |
| GET | `/api/settings` | public |
| POST | `/api/conversations` | visitor |
| GET/PATCH | `/api/conversations/:id` | owner only |
| GET/POST | `/api/conversations/:id/messages` | owner only |
| POST | `/api/admin/login` · `/api/admin/logout` | — |
| GET | `/api/admin/me` · `/stats` · `/conversations` · `/campaigns` | admin |
| GET/POST/PATCH | `/api/admin/conversations/:id[/messages]` | admin |
| POST | `/api/admin/conversations/:id/read` | admin |
| GET/POST | `/api/admin/conversations/:id/{events,tags}` | admin |
| GET/PATCH | `/api/admin/settings` | admin |

## Layout

```
server/
  config/       env + MongoDB connection
  models/       Mongoose schemas (Admin, Visitor, Conversation, Message, …)
  services/     business logic ported from the SQL RPCs
  controllers/  Express routers (customer + admin)
  middleware/   auth + error handling
  utils/        crypto, cookies, validation
  scripts/      create-admin
src/
  lib/api.ts    fetch wrapper (replaces lib/supabase.ts)
  services/     API clients
  hooks/        useAuth (admin session), useConversation, useMessages
  pages/        ChatPage, AdminLoginPage, Admin* console pages
```

Realtime is unchanged: **polling** (`usePolling`), which the UI already used. No
WebSockets, Redis or pub-sub were introduced.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server (proxies `/api` to :4100) |
| `npm run dev:server` | Express API with reload (development mode) |
| `npm run build` | Typecheck + production frontend build |
| `npm run typecheck` | Typecheck frontend **and** server |
| `npm start` | **Build + serve everything** from one Node process |
| `npm run start:only` | Serve an existing `dist/` without rebuilding |
| `npm run create-admin` | Create/update the admin account (bcrypt, idempotent) |

In production `npm start` builds the frontend and then serves **both** the API
and the compiled app from a single Node process on one port — so deployment is
one artifact, and the session cookies stay first-party (no CORS).

| URL | Serves |
| --- | --- |
| `/chat`, `/admin/login`, … | The built React app (SPA fallback) |
| `/api/*` | The JSON API |

Deep links and hard refreshes work on every route.

## Notes

- Customers are **never** asked for email, password, OTP or social login. Name
  and phone are optional and may be left blank.
- Polling pauses while the tab is hidden and catches up when it returns.
- `MAX_CONVERSATIONS_PER_VISITOR` (default 25) is an abuse guard against scripted
  conversation creation.
