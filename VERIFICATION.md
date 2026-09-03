# PLANÈTE LIBIA AI — verification report

Verified locally on 3 September 2026, using Node.js 24.19.0, PostgreSQL 16, Prisma 6.19.0, TypeScript, Vitest and Playwright Chromium on Windows.

## Delivery status

This ZIP contains the actual frontend, backend, database schema and SQL migrations, provider adapters, realtime/call code, provisioning scripts, deployment files, documentation and tests. It is not a frontend-only demonstration. No live deployment or blanket production-security certification is claimed. The operational checks below remain necessary before public release.

## Executed checks

| Check                                                                                            | Result                                                                                                          |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| ESLint                                                                                           | Passed                                                                                                          |
| Frontend and backend TypeScript checks                                                           | Passed                                                                                                          |
| Production build: Prisma generation, backend compilation, frontend compilation and Vite bundling | Passed                                                                                                          |
| PostgreSQL migrations                                                                            | All three committed migrations applied successfully, including a second completely empty database                    |
| Prisma schema validation                                                                         | Passed                                                                                                          |
| Database versus schema drift comparison                                                          | No difference detected                                                                                          |
| Migration status                                                                                 | Up to date                                                                                                      |
| Optional development seed                                                                        | Executed successfully with an explicit test-only password                                                       |
| Administrator provisioning                                                                       | Executed successfully in the clean test database                                                                |
| Category provisioning                                                                            | Executed successfully                                                                                           |
| API/integration/security tests                                                                   | 26 passed, including 2 Google authentication tests                                                              |
| Browser tests                                                                                    | 8 passed: four journeys at 1280×900 and 390×844                                                                 |
| Responsive inspection                                                                            | Dashboard screenshots inspected; browser assertions found no horizontal overflow on landing, dashboard and chat |
| Dependency audit                                                                                 | Zero known vulnerabilities reported by npm audit at verification time                                           |
| Local application serving                                                                        | Compiled application returned HTTP 200 and completed real browser/API/database flows                            |

### What the 24 API/security tests cover

- Unauthenticated access, exact-Origin/header CSRF rejection, duplicate email/phone/username, password rules, hashing and secret omission.
- Invalid login, session-cookie flags, verification-required login, code expiry, resend cooldown, invalid/replayed codes and login rate limiting.
- TOTP secret encryption/tamper rejection, TOTP enrollment and login enforcement, password changes and session revocation, self-deletion/anonymization.
- AI history creation, continuation and ownership isolation; cross-user read/write/delete rejection; unconfigured provider failure; actual HTTP requests to a **local provider fixture**, including provider error handling.
- Private-room creation, persisted/idempotent messaging, unread counts, delivered/read receipts and room/receipt IDOR rejection.
- Group creation, adding/removing members, ordinary-member restrictions, owner protection and group-message access after removal.
- Notification creation, read ownership, unread counts and preferences; profile updates, privilege-escalation rejection, contacts and blocking restrictions.
- Every administration list denied to ordinary users; draft visibility; publication create/update/publish/delete/search; audit records; reports, settings, group locking, user suspension/restoration/anonymization and administrator deletion protection.
- File-signature validation, rejection of disguised HTML, successful PNG storage/retrieval, private-file isolation and attachment authorization after sharing.
- **Real local Socket.IO clients**: authenticated connections, typing events, message delivery, unauthorized event rejection, call initiation/acceptance/termination, offer forwarding and invalid lifecycle transitions.
- Explicit unconfigured Web Push and verification-provider failures.
- Google signed ID-token validation and state/PKCE/pending-profile/session creation through a local provider fixture.

### What the browser tests cover

At both desktop and mobile sizes, real browser interactions exercised landing, login, dashboard, group creation, posting a group message, the honest unconfigured-AI error, dark/light theme persistence, news, exact About wording, anonymous admin redirects, field-level registration errors, the honest unconfigured-Google error, admin tab changes and publishing an article. The principal user journey recorded no browser page errors.

Browser testing exposed a read-receipt feedback loop, which was fixed before the final passing run. Validation also exposed and fixed partial notification preference handling and stale data-shape handling when switching admin tabs.

## External services not tested live

No real Google OAuth, AI, SMTP, Twilio, S3, VAPID push, STUN or TURN credentials were supplied. Their adapters/configuration are present, but this report does **not** claim a real AI answer, delivered SMS/email/push, uploaded S3 object, or successful call across real networks.

- Google: set a Google OAuth Web client and authorize the exact callback URL. Signed-token validation and the complete app flow used local fixtures; no Google account was contacted.
- AI: set provider, base URL, API key and model.
- Account verification: configure SMTP or Twilio. New accounts cannot access protected features until verified.
- Web Push: supply VAPID credentials and obtain browser permission.
- S3: supply a private bucket, region/endpoint and credentials if selected. Local private storage was tested.
- Calls: supply STUN and preferably authenticated TURN; validate HTTPS, permissions, actual microphones/cameras and cross-network connectivity.
- Public identity: supply official contact/social links and legal/retention text before opening publicly.

## Remaining limits and release checks

1. Docker files were provided, but the Docker daemon was unavailable. Container-image build and Compose startup were not executed. PostgreSQL ran natively for verification.
2. Redis adapter/rate-limit integration is implemented but was not exercised against a live Redis server or multiple application instances. Production startup requires Redis and an HTTPS origin. Load, failover, proxy and backup/restore tests remain operator work.
3. Call signaling was tested; actual audio/video media exchange, camera switching, speaker routing and real device permission behavior were not verified. Calls are one-to-one; group calling is not included. WebRTC media is not recorded.
4. AI is text-only. Image/file AI analysis is not included. The HTTP provider test uses a local fixture, not a paid/live model.
5. French is the complete interface language. English navigation and a language preference are provided as the multilingual extension point; the entire interface has not been translated to English.
6. Push delivery is best effort and does not have a durable retry queue. Other configured provider failures return explicit errors; operators must monitor delivery and provider budgets.
7. Account deletion anonymizes shared messages/audit references rather than erasing other participants’ conversation history. Shared media and backups need an operator retention/purge policy. Lost TOTP recovery requires a trusted operator; self-service recovery codes are not included.
8. Upload validation checks signatures, size and access rights. No antivirus scanning service was integrated. Documents are forced to download. Add scanning if required by deployment policy.
9. The messenger does not claim end-to-end encryption. Use HTTPS/WSS, private storage and controlled database access. No independent penetration test or compliance certification was performed.
10. A feature-detected, read-only WebMCP search tool is included. No supported WebMCP runtime was available for its contract test; ordinary browser use does not depend on it.

These are concrete deployment and product limitations, not simulated success states. Consult `README.md` for configuration, API routes, storage and deployment instructions.
