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
| GET | `/api/attachment-limits` | public |
| GET | `/api/settings` | public |
| POST | `/api/conversations` | visitor |
| GET/PATCH | `/api/conversations/:id` | owner only |
| GET/POST | `/api/conversations/:id/messages` | owner only |
| POST | `/api/admin/login` · `/api/admin/logout` | — |
| GET | `/api/admin/me` · `/stats` · `/conversations` · `/campaigns` | admin |
| GET/POST/PATCH | `/api/admin/conversations/:id[/messages]` | admin |
| POST | `/api/conversations/:id/attachments` | visitor owns the conversation |
| POST | `/api/admin/conversations/:id/attachments` | admin |
| DELETE | `/api/conversations\|admin/conversations/:id/attachments/:aid` | uploader, still pending |
| GET | `/api/attachments/:id` | conversation owner OR admin |
| GET/POST | `/api/admin/conversations/:id/{events,tags}` | admin |
| GET/PATCH | `/api/admin/settings` | admin |

## Meta Ads Tracking

Optional Meta Pixel / Conversions API tracking for customer pages. **Disabled by
default** — nothing loads until an admin enables it.

### Setup (browser Pixel — no rebuild, no redeploy)

1. In **Meta Events Manager**, create a **Meta Pixel** (or use your Dataset /
   Conversions API dataset) and copy its **Pixel ID**.
2. Sign in at `/admin/login`.
3. Open **Settings**.
4. In **Meta Ads Tracking**, paste the Pixel ID.
5. Tick **Enable tracking**.
6. Click **Save Changes**.

The Pixel ID is stored in MongoDB (`AppSettings`) and read at runtime from
`GET /api/public/config`, so changing it takes effect on the next page load.
**There is deliberately no `VITE_META_PIXEL_ID`** — a build-time value would force
a redeploy for every change. The **Test Pixel** button verifies the ID format, the
saved value, and what the public endpoint actually serves, without contacting Meta
and without any JavaScript.

### Where the Pixel loads

| Route | Pixel loaded? |
| --- | --- |
| `/`, `/chat`, `/chat/:id`, `/welcome` | yes, when configured + enabled |
| `/admin/*` (login, dashboard, conversations, settings) | **never** |

### Events

| Event | Fires when |
| --- | --- |
| `PageView` | once per customer-facing navigation |
| `ViewContent` | the visitor enters the chat experience |
| `StartChat` | a conversation is successfully created |
| `Contact` | the visitor creates a conversation and sends their first message |
| `Lead` | the visitor volunteers contact details (name or phone) |

`Lead` is **not** fired for ordinary messages. This app has no checkout, trial or
account step, so the only genuine lead signal is a visitor giving their details;
firing it per message would inflate it into a fake conversion.

### Conversions API (server-side, optional)

Set these in **`server/.env`** only:

```bash
META_PIXEL_ID=
META_CONVERSIONS_API_ACCESS_TOKEN=
```

`META_CONVERSIONS_API_ACCESS_TOKEN` is a **secret credential**. It must never be
placed in frontend code, a `VITE_*` variable, MongoDB, the Admin Settings UI, or
`GET /api/public/config`. When it is empty, every Conversions API call is a silent
no-op and the browser Pixel continues to work on its own — that is a fully valid
Pixel-only configuration.

Only `StartChat` is replayed server-side today. The integration is a thin,
best-effort call that never throws, so a Meta outage can never affect the chat.

### Pixel + Conversions API deduplication

For a given conversion the browser generates one id and sends it to the server as
`meta_event_id`. The browser event carries it as `eventID`, and the server reuses
the same value as Conversions API `event_id`. Meta deduplicates events that share
an `event_id`, so the pair is counted once. Browser-side events are additionally
deduplicated in `sessionStorage`, so rerenders, StrictMode, polling and retries
cannot produce a second event for the same conversion.

### What is never sent to Meta

Chat message text, captions, attachment filenames, customer name/phone/email,
admin credentials, session tokens, the MongoDB URI and the access token. Only the
event name, page URL, advertising attribution (`utm_*`, `fbclid`) and
SHA-256-hashed request technical identifiers (`client_ip_address`,
`client_user_agent`) are ever transmitted.

### Attribution

UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`,
`utm_content`) and `fbclid` are captured on `/chat` and stored **first-touch** on
the `Visitor` record before any conversation exists. A later visit never overwrites
the original click, so an organic return visit cannot erase the paid attribution.
Stored attribution is applied to each new conversation and displayed in the admin
conversation view, falling back to **Organic / Direct** when absent.

## Media messages (images + voice notes)

Both sides can send **images** (JPG/PNG/WEBP/GIF) and **voice messages**, recorded
in the browser with the native `MediaRecorder` API.

```
Browser picks/records  →  Express upload  →  AttachmentStorage (bytes)
                                              MongoDB (metadata only)
Browser renders       ←  GET /api/attachments/:id  ←  authorisation check
```

| Concern | How it is handled |
| --- | --- |
| Where bytes live | `AttachmentStorage` driver (`.data/attachments` locally). A server-generated `storageKey`, never a filename |
| Where metadata lives | MongoDB only — `storageKey`, `mimeType`, `size`, `width`/`height`, `durationMs`. **Never base64, never a binary blob** |
| Format trust | The browser MIME is a hint only. Every upload is identified by magic bytes and container parsing (PNG `IHDR`, JPEG `SOFn`, GIF screen descriptor, WEBP `VP8*`, EBML/ISO-BMFF/Ogg/RIFF for audio) |
| Blocked | SVG, HTML, XML, executables, archives, PDF — by extension deny-list *and* by failing byte validation |
| Size limits | Enforced on the bytes actually streamed, so a lying `Content-Length` cannot bypass them (`IMAGE_MAX_SIZE_MB`, `AUDIO_MAX_SIZE_MB`) |
| Path traversal | Client filenames never become paths. Keys are `YYYY/MM/<32 hex>.<ext>` and the resolved path is re-checked to be inside the storage root |
| Access control | `GET /api/attachments/:id` re-resolves the caller's session and checks the **conversation** ownership. Possessing an id is worthless without the owning session |
| Response hardening | Detected MIME type + `nosniff` + `Content-Security-Policy: sandbox`. Range requests are supported so audio seeks without a full download |
| Duplicates | Upload, then a message claims the attachment atomically (`state: 'pending'` → `'attached'`). Retries reuse the same `clientId`, so the unique `(conversationId, clientId)` index prevents duplicates |
| Orphan cleanup | An upload never attached to a message is deleted with its stored object, both inline on failure and by a periodic sweep. Claimed rows are re-checked against real messages, so live media is never removed |

Swapping local disk for object storage means implementing the `AttachmentStorage`
interface in `server/services/attachments/storage.ts` and setting
`ATTACHMENT_STORAGE_DRIVER` — no controller, service, model or frontend change.

Text messages are untouched: `type` defaults to `'text'`, and rows written before
media support (which have no `type` field at all) are normalised on read.

## Layout

```
server/
  config/       env + MongoDB connection
  models/       Mongoose schemas (Admin, Visitor, Conversation, Message, Attachment, …)
  services/     business logic + attachments/{storage,validation,service}
  controllers/  Express routers (customer + admin + attachments)
  middleware/   auth + error handling + multipart upload parsing
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
| `npm run test:e2e` | Full suite: API, customer, admin, responsive, security, regression, a11y |
| `npm run typecheck` | Typecheck frontend **and** server |
| `npm start` | **Build + serve everything** from one Node process |
| `npm run build` | Compile frontend (`dist/`) and server (`dist-server/`) |
| `npm run start:only` | Serve an existing build — no build tools needed |
| `npm run create-admin:prod` | Admin bootstrap without `tsx` |
| `npm run create-admin` | Create/update the admin account (bcrypt, idempotent) |

In production `npm start` builds the frontend and then serves **both** the API
and the compiled app from a single Node process on one port — so deployment is
one artifact, and the session cookies stay first-party (no CORS).

| URL | Serves |
| --- | --- |
| `/chat`, `/admin/login`, … | The built React app (SPA fallback) |
| `/api/*` | The JSON API |

Deep links and hard refreshes work on every route.

The server is compiled to plain JavaScript (`dist-server/`), so a production
install only needs the runtime dependencies — `npm run start:only` works even
when the host installed with `npm ci --omit=dev` and stripped `tsc`/`vite`.

## Notes

- Customers are **never** asked for email, password, OTP or social login. Name
  and phone are optional and may be left blank.
- Polling pauses while the tab is hidden and catches up when it returns.
- `MAX_CONVERSATIONS_PER_VISITOR` (default 25) is an abuse guard against scripted
  conversation creation.
