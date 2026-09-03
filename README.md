# PLANÈTE LIBIA AI

**L’intelligence au service du peuple**

A working French-first React/TypeScript application with a modular Fastify API, PostgreSQL/Prisma persistence, server-managed sessions, Socket.IO messaging, and browser WebRTC calls. Source delivery for a VPS or container host. See `VERIFICATION.md` for exactly what was executed and the deployment limitations.

## Architecture

```text
React + React Router + Vite
       │ same-origin HTTP, HttpOnly session cookie, CSRF request header
Fastify API ── Prisma ── PostgreSQL 16
       ├─ Socket.IO ── optional Redis adapter (required in production)
       ├─ AIProvider ── OpenAI-compatible HTTP API
       ├─ CodeProvider ── SMTP or Twilio SMS
       ├─ Storage ── private local filesystem or S3-compatible bucket
       ├─ Web Push ── VAPID
       └─ authenticated WebRTC signaling ── browsers + STUN/TURN
```

The retained project used React/Vite rather than Next.js, so that architecture was preserved. Backend domains are separate source modules, deployed as one same-origin process. This is a single-package full-stack repository, not a monorepo. Public news and About pages include server-rendered HTML and metadata; authenticated application pages are client-rendered. The API exposes no provider credentials.

## Requirements

- Node.js 24 LTS, npm, PostgreSQL 16, and Redis 7 for production.
- A modern browser with WebSocket, MediaRecorder and WebRTC support.
- HTTPS for deployment and browser microphone/camera permissions.
- SMTP or Twilio credentials to verify new accounts. Registration persists an unverified account when delivery is unavailable and clearly reports that condition. There is no development verification bypass in the application.

## Local installation

1. Copy `.env.example` to `.env` and set `DATABASE_URL` for an empty development database.
2. Set `APP_ORIGIN=http://localhost:5173`. This must exactly match the browser origin; use one hostname consistently.
3. Run:

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run db:categories
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/socket.io` to port 3000. Redis is optional in development; remove `REDIS_URL` if unavailable. `npm run dev:api` loads `.env` explicitly. Do not run Prisma generation while an API/test process is using its engine DLL on Windows; stop that process first.

To run the compiled version locally:

```sh
npm run build
# Change APP_ORIGIN in .env to http://localhost:3000
npm start
```

`/api/health` checks PostgreSQL and Redis when configured. The built backend serves the compiled frontend from `dist/web`.

## First administrator and categories

Set `ADMIN_EMAIL`, `ADMIN_PHONE` (international E.164 format), `ADMIN_USERNAME`, `ADMIN_NAME`, and `ADMIN_PASSWORD`. Passwords require at least 12 characters, uppercase/lowercase letters, a digit, and a symbol, with a maximum of 72 characters.

```sh
npm run admin:create
npm run db:categories
```

Provisioning is an explicit trusted command; it creates a verified administrator and fails on existing identifiers. It never silently promotes an existing user. Remove `ADMIN_PASSWORD` afterward. In production, administrators must activate TOTP in their personal settings before accessing administrative APIs. Generate `TOTP_ENCRYPTION_KEY` with `openssl rand -hex 32` and keep it in a secret manager/backups. Losing it prevents existing TOTP secrets from being decrypted. Resetting a lost TOTP device currently requires a trusted database operator; there is no insecure public recovery endpoint.

## Optional development data

Set your own `SEED_PASSWORD`, then run `npm run db:seed`. This is disabled when `NODE_ENV=production`. It creates the non-administrator user `community@example.test`, a development group, categories and a clearly identified example article. It never supplies or prints a default password. Keep demo data out of production. The integration and browser tests create unique, clearly named test accounts only in a database whose connection string contains `test`.

## External providers

| Capability         | Configuration                                                                                              | Behavior without configuration                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| AI                 | `AI_PROVIDER=openai-compatible`, `AI_BASE_URL` such as your provider's `/v1` URL, `AI_API_KEY`, `AI_MODEL` | HTTP 503; no invented response or saved assistant message         |
| Email verification | `VERIFICATION_PROVIDER=smtp`, `SMTP_URL`, `MAIL_FROM`                                                      | Account remains unverified; resend reports unavailable            |
| SMS verification   | `VERIFICATION_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`                   | No SMS success is claimed                                         |
| Local media        | `STORAGE_PROVIDER=local`, `UPLOAD_DIR`                                                                     | Working local private storage; persist this directory             |
| S3                 | `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT`, AWS credentials                   | Storage errors surface; bucket must remain private                |
| Calling            | `STUN_URL`, `TURN_URL`, `TURN_SECRET`                                                                      | Browser reports calling unconfigured if no ICE server is supplied |
| Web push           | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                                                   | In-app notifications still work; push enable reports unavailable  |
| Official contact   | `PUBLIC_CONTACT_EMAIL`, `PUBLIC_SOCIAL_URL`                                                                | About page clearly says contact is not configured                 |

The AI adapter posts to `${AI_BASE_URL}/chat/completions`, sets a 60-second timeout, supplies the configured model, and sends at most 20 previous messages. It supports text conversations. Multimodal AI uploads are not implemented. Keep prompts within your provider's token budget and set spending limits at the provider.

Google sign-in uses the server-side OpenID Connect authorization-code flow with PKCE, state, nonce, a short-lived encrypted HttpOnly flow cookie, and signed ID-token claim validation. Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and authorize the exact callback APP_ORIGIN/api/auth/google/callback in Google Cloud. It requests only openid, email and profile. New users finish their username and phone; existing password accounts must sign in before linking the same Google e-mail from Settings. TOTP remains required when enabled. Without credentials, the button reports that Google is not configured.

Twilio uses its authenticated Messages API. SMTP uses Nodemailer. Verification codes are random six-digit values, stored as hashes, expire after 10 minutes, have a 60-second resend cooldown and at most five attempts. Registration, verification and login also have IP rate limits. Server-managed opaque session tokens are random and stored only as hashes, expire after seven days, and are revoked on logout, password changes and account suspension.

Generate VAPID keys using your Web Push tooling. Browser subscriptions are explicitly opt-in. Only known Google, Mozilla and Apple push hosts are accepted to avoid arbitrary server-side requests. Delivery failures never erase the persistent in-app notification. Push delivery is best effort, not a durable queue.

## Audio/video and realtime

Users initiate one-to-one calls from a private chat. The callee must have an authenticated socket connected. Call records transition through RINGING, ACCEPTED, DECLINED, ENDED or MISSED. Ringing expires after 45 seconds. The server authorizes every offer, answer and ICE event against the authenticated participant and room, and revalidates socket sessions for inbound events. Disconnected active calls are ended after a short grace period when no socket remains.

Configure a TURN relay for reliable cross-network calls. `TURN_SECRET` is the shared authentication secret of a compatible coturn deployment; the API issues HMAC-SHA1 temporary TURN credentials with a one-hour lifetime. Configure TURN/TLS and UDP/TCP relay ports at the infrastructure layer. STUN-only connections cannot traverse all NATs. Media travels between browsers or through TURN; it is not stored by this API. Group calling is not included.

The browser implements microphone/camera permission handling, local/remote streams, mute, camera toggle, camera switching, connection failure messaging and hangup. Voice messages use MediaRecorder, are capped at one minute in the interface, then pass through the same secure upload endpoint. Browser codec support varies.

Socket.IO uses authenticated per-user rooms, with Redis broadcasting and cross-node socket queries when configured. The client uses WebSocket transport. Presence is privacy-filtered. Typing signals are bounded and temporary. Messages are durable in PostgreSQL, have client idempotency keys, and are recovered by paginated HTTP reads after reconnect. Redis does not replace database persistence. This is not an end-to-end encrypted messenger.

## Security and data boundaries

- Bcrypt password hashing (cost 12), normalized unique email/username, unique E.164 phone.
- HttpOnly, SameSite=Lax cookies; Secure in production. Exact Origin plus `X-PL-Request: 1` is required for every API mutation. No wildcard CORS or localStorage bearer tokens.
- Private API authorization checks use the current database session and user status, with object-level checks for rooms, media, histories, notifications, groups and calls.
- Administrative access is checked on the server, and requires configured TOTP in production. Important actions create audit records.
- Group owners can grant/revoke admin roles; ordinary members cannot add/remove others or edit group details. Owners cannot accidentally remove themselves.
- MIME types are determined from bytes, filenames sanitized, maximum upload size 10 MiB. HTML, JavaScript and SVG uploads are rejected. Documents are downloaded as attachments. Media is never served as an unrestricted static directory.
- React escapes user text; articles render as plain text, not arbitrary HTML. Public server-rendered article text is escaped too. Helmet and CSP constrain content and framing.
- Private endpoints disable caching; list endpoints return 30 records per page. No raw SQL string concatenation is used. The few raw statements are parameterized health/locking queries.
- Self-deletion requires the current password, erases sessions, private AI history, verification and subscription/contact/notification records, and anonymizes the account. Shared messages, shared attachments and audit references are retained. Plan operator retention and backup deletion procedures before public release.

Blocking prevents direct communication, discovery, contact creation and access to private shared-room interactions between those accounts. Existing group history remains shared with group members. Moderation can lock groups, remove messages, suspend/restore/anonymize users, resolve reports and edit public content.

## Deployment

1. Configure a private production database and credentials, `APP_ORIGIN=https://your-domain`, provider credentials, and a random TOTP encryption key.
2. Use `docker compose up --build -d`. PostgreSQL and Redis remain on the internal network; the application binds host loopback port 3000.
3. Put an HTTPS reverse proxy in front of port 3000. Forward WebSocket upgrades and preserve Origin. Use `TRUST_PROXY=true` only when the application is reachable exclusively through a trusted proxy that overwrites incoming forwarding headers.
4. Provision the administrator and categories, activate TOTP, configure official contact and legal text, and complete a live staging test with your providers.
5. Back up PostgreSQL, private uploads/S3 and the encryption key. Exercise restore procedures. Set log retention, monitoring, provider budgets and abuse-response ownership.

The app container applies committed migrations with `prisma migrate deploy` before starting, runs as the non-root `node` user and stores uploads on a named volume. For multiple replicas, run migrations in one release job, share PostgreSQL/Redis/S3, and configure WebSocket proxying. Local upload volumes are suitable for a single instance; use S3 for multiple instances. Container-image builds, HTTPS deployment, TURN and multi-instance Redis operation are only claimed as tested if explicitly listed in `VERIFICATION.md`.

## API map

All paths below are under `/api`. JSON mutations require the CSRF header and exact Origin.

| Domain         | Routes                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts       | `auth/register`, `auth/resend`, `auth/verify`, `auth/login`, `auth/logout`, Google OAuth routes (`auth/google/start`, `callback`, `pending`, `complete`), `me`, `sessions/:id` |
| Security       | `security/password`, `security/2fa/setup`, `security/2fa/confirm`, `security/2fa/disable`                                                                                      |
| People         | `users`, `users/:id`, `contacts/:id`, `blocks/:id`                                                                                                                             |
| AI             | `ai/threads`, `ai/threads/:id`, `ai/threads/:id/messages`                                                                                                                      |
| Discussions    | `rooms`, `rooms/private`, `rooms/:id/messages`, `rooms/:id/read`, `rooms/:id/delivered`, `rooms/:id/presence`                                                                  |
| Groups         | `groups`, `groups/:id`, `groups/:id/members`, `groups/:id/members/:userId`                                                                                                     |
| Calls          | `calls`, `calls/config`, `calls/:id/state`; socket `call` and `signal` events                                                                                                  |
| News           | `news`, `news/:id`, `categories`                                                                                                                                               |
| Notifications  | `notifications`, `notifications/:id/read`, `push/config`, `push/subscribe`, `push/unsubscribe`                                                                                 |
| Moderation     | `reports`, `admin/reports/:id`, `admin/messages/:id`, `admin/groups/:id`                                                                                                       |
| Administration | `admin/stats`, `admin/users/:id`, `admin/news/:id`, `admin/categories/:id`, `admin/settings`, `admin/audit`                                                                    |
| Media          | `media` (multipart POST), `media/:id` (authorized GET)                                                                                                                         |

See the route modules for schemas and HTTP verbs. Errors are JSON `{ "error": "French user-facing message" }`; validation errors also include field details. API clients must treat 401 as session expiry and return to login. A feature-detected read-only WebMCP community-search tool uses the same protected API; browsers without WebMCP are unaffected.

## Verification commands

```sh
npm run lint
npm run typecheck
npm run build
# Use a dedicated database named with 'test', migrated before tests:
npm test
# Start compiled application with APP_ORIGIN=http://localhost:3000 first:
npx playwright install chromium
npm run test:ui
npm audit
npx prisma migrate status
```

Tests do not reset arbitrary databases. They leave uniquely named test records for investigation. Provider fixtures are isolated test doubles or local HTTP servers and are never enabled by the production application. Browser tests run at desktop and mobile sizes against the real API and database. The exact executed results and remaining operational checks are in `VERIFICATION.md`.

## Source layout

- `web/`: interface, reusable forms, session state, calls and internationalization dictionary.
- `server/`: authentication, domain routes, security helpers, providers, storage, realtime and public SEO rendering.
- `prisma/`: relational schema, versioned SQL migrations, optional seed.
- `scripts/`: explicit administrator/category provisioning.
- `tests/`: integration/security and browser tests.
- `public/sw.js`: opt-in Web Push service worker.

French is the full interface language. The language preference and navigation dictionary establish an extension point; full English translation is not included. Additional translations should move the remaining French strings into locale files. The source is formatted with Prettier and checked by ESLint/TypeScript. No real service secrets, dependency folders, local database files or uploaded test media are included in the source ZIP.
