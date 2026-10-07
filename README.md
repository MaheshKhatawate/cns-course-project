# Passwordless Authentication Using Public-Key Cryptography

**Cryptography and Network Security (CNS) course project — KLE Tech, Team 14**

| Roll No. | USN | Name |
|---|---|---|
| 146 | 01FE23BCS210 | Amogh Annigeri |
| 159 | 01FE23BCS291 | Mahesh Khatawate |
| 160 | 01FE23BCS295 | Raveesh Nayak |
| 161 | 01FE23BCS143 | Sathvik Kemtur |

A working end-to-end passwordless login system built on **FIDO2 / WebAuthn**. Each device
generates its own **ECDSA P-256 key pair** inside its authenticator (Touch ID, Windows Hello,
Android, or a security key). The **private key never leaves the device**. The server stores only
the **public key** and checks a signed, single-use challenge at every login. No password is ever
typed, sent, or stored.

---

## Contents

1. [Problem statement](#1-problem-statement)
2. [Features](#2-features)
3. [Architecture](#3-architecture)
4. [Cryptographic protocol](#4-cryptographic-protocol)
5. [Requirements traceability](#5-requirements-traceability)
6. [Security analysis & threat model](#6-security-analysis--threat-model)
7. [Getting started](#7-getting-started)
8. [Demo walkthrough (for the review)](#8-demo-walkthrough-for-the-review)
9. [Testing, attack simulation & benchmark](#9-testing-attack-simulation--benchmark)
10. [API reference](#10-api-reference)
11. [Data model](#11-data-model)
12. [Configuration](#12-configuration)
13. [Project structure](#13-project-structure)
14. [Limitations & future work](#14-limitations--future-work)

---

## 1. Problem statement

With traditional passwords, users must create, remember, and keep re-entering shared secrets.
Those secrets are open to phishing, brute force, credential stuffing, reuse across sites, and
server database breaches. This project removes shared secrets entirely. A user proves who they
are by showing they **possess and control a private key** that matches a registered public key.

## 2. Features

- **Passwordless registration**: real WebAuthn key pair generation. The account is created only
  after the authenticator proves it holds a new key.
- **Challenge–response login**, either by username or **usernameless** (discoverable passkeys).
- **Multi-device**: one account can hold many passkeys, each with its own key pair.
  - **Link a new device** with a one-time code (8 characters, single-use, 10-minute lifetime,
    locked after 5 wrong guesses). The new device or browser creates its own key pair at `/link`.
  - Or add a USB/NFC security key from the same browser.
  - Rename devices, and view each stored public key (PEM) with its SHA-256 fingerprint.
- **Device revocation**: a revoked key is rejected forever, and every session it created ends
  immediately.
- **Account recovery**: a one-time recovery code (~79 bits, stored as a bcrypt hash) lets you
  register a replacement passkey. Optionally it revokes all old devices. The code **rotates**
  after use, and old recovery tokens stop working.
- **Sessions**: a server-side session table plus an HS256 JWT in an `HttpOnly`, `SameSite=Lax`
  cookie, with expiry. Logout really ends the session. You can list sessions, sign out other
  sessions, and revoke any single session.
- **Step-up re-authentication**: adding or revoking a device, or generating a new recovery code,
  requires a passkey signature made within the last 5 minutes.
- **Hardening**: signature-counter clone detection, rate limiting, CSRF Origin checks, strict
  CORS, helmet security headers, and generic error messages.
- **Activity log**: registrations, logins (success and failure, with the reason), device
  added/revoked, step-up, recovery, and logouts.
- **Teaching aids**:
  - A **ceremony inspector** decodes the challenge, origin, rpIdHash, flags (UP/UV/BE/BS),
    sign count, and DER signature from your last login.
  - A **live attack simulator** runs 19 scenarios (16 attacks, 3 legitimate flows) against the
    real API.
  - A crypto **benchmark**.

## 3. Architecture

```mermaid
flowchart LR
  subgraph Client device
    A[Authenticator<br/>Secure Enclave / TPM / security key<br/><b>private key lives here</b>]
    B[Browser<br/>Next.js app + WebAuthn API]
    A <-- CTAP2 --> B
  end
  subgraph Server
    C[Express API<br/>SimpleWebAuthn verification]
    D[(PostgreSQL<br/>users, <b>public keys</b>,<br/>sessions, activity)]
    E[Challenge store<br/>single-use, 5-min TTL]
    C --> D
    C --> E
  end
  B <-- HTTPS / JSON + HttpOnly cookie --> C
```

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, lucide-react icons, `@simplewebauthn/browser` |
| Backend | Node.js 20+, Express 4, TypeScript, `@simplewebauthn/server`, zod, helmet |
| Database | PostgreSQL 14+ with Prisma ORM (migrations in `prisma/migrations`) |
| Crypto | ECDSA P-256/SHA-256 (ES256), with EdDSA and RS256 also accepted; HS256 JWT; bcrypt; CSPRNG challenges |
| Testing | Vitest, Supertest, a software FIDO2 authenticator, Chrome virtual authenticator (manual E2E) |

## 4. Cryptographic protocol

### Registration (FR-1)

```mermaid
sequenceDiagram
  participant U as User
  participant Auth as Authenticator
  participant B as Browser
  participant S as Server
  B->>S: POST /api/auth/register-options {username}
  S-->>B: challenge (32 random bytes), rp.id, user.id (random handle), algs [ES256, EdDSA, RS256]
  B->>Auth: navigator.credentials.create()
  U->>Auth: fingerprint / face / PIN
  Auth->>Auth: generate key pair (private key never exported)
  Auth-->>B: credentialId, publicKey (COSE), authData{rpIdHash, flags, counter}, clientDataJSON
  B->>S: POST /api/auth/register-verify
  S->>S: check challenge, origin, SHA-256(rpId), UP/UV flags, alg
  S->>S: create user + store PUBLIC key + bcrypt(recovery code)
  S-->>B: recovery code (shown once) + session cookie
```

### Login (FR-2)

```mermaid
sequenceDiagram
  participant Auth as Authenticator
  participant B as Browser
  participant S as Server
  B->>S: POST /api/auth/login-options {username?}
  S-->>B: {flowId, challenge, allowCredentials}
  B->>Auth: navigator.credentials.get()
  Auth->>Auth: sig = ECDSA_Sign(privKey, authData ‖ SHA-256(clientDataJSON))
  Auth-->>B: authData, clientDataJSON, sig, userHandle
  B->>S: POST /api/auth/login-verify {flowId, assertion}
  S->>S: consume challenge (single use) → verify sig with stored public key
  S->>S: origin ✓ rpIdHash ✓ challenge ✓ counter increased ✓ not revoked ✓ userHandle ✓
  S-->>B: Set-Cookie: session=JWT(jti = session id)
```

**What makes it secure:**

- **Origin binding.** The browser writes the page's origin into `clientDataJSON`, which is
  covered by the signature. A phishing site's origin will never match.
- **RP ID binding.** `authenticatorData` begins with `SHA-256(rpId)`. A key created for
  `localhost` cannot be used for any other domain.
- **Freshness.** Each challenge comes from a CSPRNG (32 bytes), is tied to one `flowId`, expires
  after 5 minutes, and is deleted on first use. This stops replay.
- **Integrity.** Changing any byte of `clientDataJSON` or `authenticatorData` invalidates the
  ECDSA signature. This stops man-in-the-middle tampering.
- **Clone detection.** The authenticator's signature counter must strictly increase.
- **Nothing secret on the server.** A public key cannot sign a challenge, so a database leak
  cannot be turned into a login.

## 5. Requirements traceability

| Requirement | Implementation | Verified by |
|---|---|---|
| **FR-1** User registration | `routes/auth.ts` `register-*`, `webauthn.ts#verifyRegistration` | `crypto.test.ts`, `api.test.ts › registration`, scenario `baseline-login` |
| **FR-2** Challenge–response login | `routes/auth.ts` `login-*`, `challengeStore.ts`, `webauthn.ts#verifyAssertion` | scenarios `replay`, `mitm-challenge-swap`, `forged-signature` |
| **FR-3** Key storage & protection | Keys are created by the platform authenticator (Secure Enclave / TPM / security key); only the COSE public key is persisted | scenario `db-leak`; the Devices page shows exactly what is stored |
| **FR-4** Multi-device support | `routes/devices.ts` (add, list, rename, link code), `routes/link.ts`, `linkCodes.ts` | scenarios `device-link`, `link-code-guess`, `revoked-device`; browser E2E |
| **FR-5** Key revocation & recovery | `devices/:id/revoke` (also ends sessions), `routes/recovery.ts` (rotating code, optional revoke-all) | scenarios `revoked-device`, `recovery-reuse`, `recovery-bruteforce` |
| **FR-6** Session management | `sessions.ts`, `routes/sessions.ts`, `requireAuth` (server-side session check), `requireFreshAuth` (step-up) | scenarios `session-after-logout`, `step-up`; `api.test.ts › protected routes` |
| **NFR** Security | ES256/EdDSA/RS256, origin/RP ID checks, counter, rate limits, CSRF checks, helmet | 19 end-to-end scenarios, 45 unit tests |
| **NFR** Usability | One-tap login, usernameless option, clear error messages | browser E2E |
| **NFR** Performance (< 1 s) | — | `npm run bench`: verification ≈ 0.13 ms mean; `crypto.test.ts` asserts < 1 s |
| **NFR** Scalability | Stateless signature checks (≈ 7 000 verifications/s per core); indexed lookups by credential ID | `npm run bench` |
| **NFR** Compatibility | W3C WebAuthn Level 2 / FIDO2 CTAP2, so it works in Chrome, Edge, Safari and Firefox | — |
| **NFR** Availability & reliability | Recovery code, multiple devices, guard against revoking your last device | `api.test.ts › device revocation` |

## 6. Security analysis & threat model

| Threat (from the problem statement) | Mitigation | Automated scenario |
|---|---|---|
| Phishing & spoofing | Origin in the signed clientData; RP ID hash in authData | `phishing-origin`, `phishing-rpid` |
| Brute force & forgery | ECDSA P-256 (~128-bit security); recovery codes ~79 bits + bcrypt + 5 attempts per 15 min | `forged-signature`, `recovery-bruteforce` |
| Credential stuffing & reuse | No shared secret; per-site key pairs; a credential must belong to the claimed account | `credential-stuffing` |
| Server-side breach | Only public keys and bcrypt hashes are stored | `db-leak` |
| Replay | Single-use, flow-bound, expiring challenges | `replay` |
| Man-in-the-middle | Signature covers the challenge and origin (TLS in production) | `mitm-challenge-swap` |
| Cloned authenticator | Signature counter must increase | `cloned-authenticator` |
| Lost / stolen device | Revocation also ends that device's sessions; recovery can revoke all devices | `revoked-device` |
| Session hijacking | HttpOnly cookie, expiry, server-side revocation, step-up for sensitive actions | `session-after-logout`, `step-up` |
| Account takeover via sign-up | Account is created only at verify; existing usernames are refused | `username-takeover` |
| Rogue device enrolment | Link codes need a fresh passkey check to create; single-use, 10-minute lifetime, locked after 5 wrong guesses | `link-code-guess` |
| Recovery abuse | Code rotates after use; recovery token bound to the code generation | `recovery-reuse` |
| CSRF | SameSite=Lax, strict CORS, Origin check on every POST | `csrf` |
| Reset overhead / poor usability | There are no passwords to reset; one-tap login | — |

## 7. Getting started

**Prerequisites:** Node.js 20+, and either Docker (easiest) or a local PostgreSQL 14+.
You also need a browser with WebAuthn support and an authenticator: Touch ID, Windows Hello, a
phone, a security key, or Chrome DevTools → *WebAuthn* → *virtual authenticator*.

```bash
# 1. Install dependencies
npm install

# 2. Configuration
cp .env.example .env                       # set JWT_SECRET to a long random string
cp apps/web/.env.example apps/web/.env.local

# 3. Database
npm run db:up                              # Postgres in Docker (or use your own and edit DATABASE_URL)
npx prisma migrate deploy                  # apply all migrations
npx prisma generate

# 4. Run frontend + backend
npm run dev
```

- Frontend: <http://localhost:3000>
- Backend: <http://localhost:4000> (`GET /api/health`)
- You can also run them separately with `npm run dev:server` and `npm run dev:web`.
- `npm run prisma:studio` opens a database browser. It is useful for showing that **only public
  keys** are stored.

> **Upgrading an existing database** from the first version of this project: run
> `npx prisma migrate deploy`. The new migration adds sessions, credential metadata, and WebAuthn
> user handles, and backfills existing users.

> **"Add a security key here" says to turn on Bluetooth?** The browser already holds a passkey
> for your account, so WebAuthn will not register it twice and offers the phone/QR (hybrid)
> option instead. That option needs Bluetooth on both devices. Use **Link a new device** with a
> second browser instead, or plug in a USB security key.

> WebAuthn requires a secure context. `http://localhost` qualifies; any other host needs HTTPS,
> and `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` / `WEB_ORIGIN` must match it.

**Production build:** run `npm run build`, then `npm run start --workspace=apps/server` and
`npm run start --workspace=apps/web`. In production, set `NODE_ENV=production`, which makes
cookies `Secure`, requires a JWT secret of at least 32 characters, and disables the simulator.

## 8. Demo walkthrough (for the review)

> Full presenter guide with algorithms, viva Q&A and troubleshooting: [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).

1. **Register** (`/register`): pick a username, then confirm with Touch ID or Windows Hello. Save
   the recovery code.
2. **Dashboard**: the *Last ceremony* card decodes what was signed, including the challenge,
   origin, `rpIdHash = SHA-256("localhost")`, UP/UV flags, and sign count.
3. **Log out, then log in.** Try both the username flow and *Sign in with a saved passkey (no
   username)*. Watch the counter increase.
4. **Devices** (`/devices`): open *Public key* to show the PEM, which is all the server knows.
   Then demo multi-device:
   - Click **Generate link code**.
   - Open a **Chrome Incognito window** (⇧⌘N) and go to <http://localhost:3000/link>.
   - In that window, open DevTools (⌥⌘I) → ⋮ → More tools → **WebAuthn** → tick *Enable
     virtual authenticator environment* → **Add**. The window now has its own, separate
     authenticator.
   - Enter your username and the code, then click *Create passkey on this device*.
   - Don't use Safari or another Chrome profile for this on the same Mac. They usually share
     passkeys with your main browser through iCloud Keychain or Google Password Manager, so
     WebAuthn sees the same authenticator and answers "already registered".
   - A USB security key, or a second machine not signed into the same Apple/Google account,
     also works as a real second device.
   - The Devices page refreshes on its own and shows the new device.
   - **Revoke** it. The other browser is signed out immediately and its key is rejected.
5. **Recovery** (`/recovery`): use the saved code to register a replacement. The old code then
   stops working.
6. **Security** (`/security`): click **Run all attacks**. You should see 19/19 scenarios
   behave as expected (16 attacks blocked, 3 legitimate flows allowed), with evidence for each.
   Then walk through the threat model.
7. *(Optional)* `npx prisma studio`: show the `Credential` table, which contains public keys
   only.

## 9. Testing, attack simulation & benchmark

```bash
npm test                    # 45 unit tests, no database needed
npm run test:integration    # 19 end-to-end scenarios against real PostgreSQL (needs DATABASE_URL)
npm run demo:attacks        # same scenarios as a printed report (good for the presentation)
npm run bench               # NFR performance benchmark
```

- **Unit tests** (`api.test.ts`, `security.test.ts`, `crypto.test.ts`) cover:
  - single-use and expiring challenges
  - JWT signing, expiry, tampering, `alg: none`, and token-purpose separation
  - session revocation and the step-up requirement
  - the username takeover guard, CSRF, rate limiting, and recovery token rotation
  - real ES256 registration and login verification, including phishing, wrong RP ID, cloned
    counter, tampered signature, and wrong challenge cases.
- **Software authenticator** (`src/security/softAuthenticator.ts`) produces byte-exact WebAuthn
  responses (CBOR attestation object, authenticatorData, DER ECDSA signatures). The real server
  verification code is therefore exercised without a browser, and it can misbehave on purpose to
  simulate attacks.
- **Browser E2E**: verified manually in Google Chrome with the DevTools virtual authenticator.
  The flow covered:
  - register → usernameless login (ceremony inspector shown)
  - link a second browser with a one-time code (the first browser's device list refreshes)
  - revoke the second browser (its session ends and its key is rejected)
  - recovery with a new device (old devices revoked, new code issued, old code rejected)
  - attack simulator 19/19.

Sample benchmark output (Apple Silicon, Node 24, 200 iterations):

```text
Operation                                       mean ms      p50      p95      max   < 1 s?
Key-pair generation + attestation (client)         0.04     0.04     0.06     0.47   yes
Registration verification (server)                 0.06     0.04     0.08     2.98   yes
Challenge signing (client)                         0.02     0.02     0.03     0.30   yes
Signature verification (server)                    0.13     0.12     0.19     2.35   yes
≈ 7443 login verifications per second per CPU core.
```

## 10. API reference

All bodies are JSON. **Auth**: `JWT` means the session cookie, or `Authorization: Bearer`.
`fresh` means a passkey check within the last 5 minutes; otherwise the server answers
`403 {code: "REAUTH_REQUIRED"}`.

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/api/health` | Health check + RP config | – |
| POST | `/api/auth/register-options` | `{username, displayName?}` → creation options (409 if the username is taken) | – |
| POST | `/api/auth/register-verify` | `{username, attResp, deviceLabel?}` → creates the account, returns the recovery code, sets the session | – |
| POST | `/api/auth/login-options` | `{username?}` → `{flowId, options}` (omit username for usernameless login) | – |
| POST | `/api/auth/login-verify` | `{flowId, assertionResponse}` → sets the session; returns verification details | – |
| POST | `/api/auth/reauth-options` / `reauth-verify` | Step-up: sign a fresh challenge | JWT |
| POST | `/api/auth/logout` | Revoke the current session and clear the cookie | – |
| GET | `/api/users/me` | Profile, session, step-up window, recovery status | JWT |
| POST | `/api/users/me/recovery-code` | Generate a new recovery code (the old one stops working) | JWT + fresh |
| GET | `/api/devices` | Devices with algorithm, type, transports, counter, public-key PEM and fingerprint | JWT |
| POST | `/api/devices/options` / `verify` | Add a device | JWT + fresh |
| PATCH | `/api/devices/:id` | Rename a device | JWT |
| POST | `/api/devices/:id/revoke` | Revoke a device and end its sessions | JWT + fresh |
| POST | `/api/devices/link-code` | Create a one-time device link code (`GET` shows status, `DELETE` cancels) | JWT + fresh |
| POST | `/api/link/options` / `verify` | New device: `{username, code}` → creates its own passkey and signs in (rate-limited) | link code |
| GET | `/api/sessions` | Active sessions | JWT |
| POST | `/api/sessions/:id/revoke` | Sign out one session | JWT |
| POST | `/api/sessions/revoke-others` | Sign out every other session | JWT |
| POST | `/api/recovery/verify` | `{username, recoveryCode}` → 10-minute recovery token (rate-limited) | – |
| POST | `/api/recovery/register-options` / `register-verify` | Register a replacement passkey (`revokeOtherDevices`, default true); rotates the code | recovery token |
| GET | `/api/activity?limit=` | Recent activity (max 100) | JWT |
| GET / POST | `/api/demo/attacks` | List or run the attack scenarios (only when `ENABLE_DEMO_ROUTES=true`) | – |

## 11. Data model

| Table | Key columns | Notes |
|---|---|---|
| `User` | `username` (unique), `webauthnUserId` (random handle), `recoveryCodeHash` (bcrypt) | No password column exists |
| `Credential` | `credentialID`, `publicKey` (COSE, base64), `algorithm`, `counter`, `transports`, `deviceType`, `backedUp`, `revokedAt` | One row per device key; revoked rows are kept for audit |
| `Session` | `id` (= JWT `jti`), `credentialId`, `expiresAt`, `lastAuthAt`, `revokedAt`, `ip`, `userAgent` | Enables logout, revocation and step-up |
| `ActivityLog` | `type`, `message`, `deviceLabel`, `ip` | Audit trail |

## 12. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/passwordless_demo` | PostgreSQL connection |
| `PORT` | `4000` | API port |
| `JWT_SECRET` | dev fallback only | HMAC key for session and recovery tokens (at least 32 characters in production) |
| `JWT_EXPIRES_IN` | `1h` | Session lifetime (`15m`, `1h`, `7d`, …); also sets the cookie max-age |
| `WEBAUTHN_RP_ID` | `localhost` | Relying-party ID (hostname, no port) |
| `WEBAUTHN_RP_NAME` | `Passwordless Demo (CNS)` | Name shown by the authenticator |
| `WEBAUTHN_ORIGIN` | `http://localhost:3000` | Exact origin expected in clientDataJSON |
| `WEB_ORIGIN` | `http://localhost:3000` | CORS / CSRF allowed origin |
| `CHALLENGE_TTL_MS` | `300000` | Challenge lifetime |
| `STEP_UP_MAX_AGE_MS` | `300000` | Step-up window |
| `RATE_LIMIT_PER_MINUTE` | `120` | Per-IP budget for `/api/auth` and `/api/recovery` |
| `RECOVERY_ATTEMPTS_PER_15_MIN` | `5` | Recovery guesses allowed per IP+username |
| `ENABLE_DEMO_ROUTES` | `true` (`false` in production) | Attack simulator endpoint |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Frontend → API URL (`apps/web/.env.local`) |

## 13. Project structure

```text
.
├── apps/
│   ├── server/                      # Express API
│   │   ├── src/
│   │   │   ├── routes/              # auth, devices, link, sessions, recovery, users, activity, demo
│   │   │   ├── middleware/          # requireAuth (+ step-up), rateLimit, originCheck, wrapRouter
│   │   │   ├── security/            # softAuthenticator, attack scenarios, simulator token
│   │   │   ├── webauthn.ts          # registration/assertion verification, public-key description
│   │   │   ├── sessions.ts          # session issue / revoke
│   │   │   ├── challengeStore.ts    # single-use, expiring challenges
│   │   │   ├── auth.ts              # JWT session + recovery tokens
│   │   │   ├── recovery.ts          # recovery code generation / bcrypt
│   │   │   └── *.test.ts            # unit + integration tests
│   │   └── scripts/                 # attacks.ts (report), bench.ts (benchmark)
│   └── web/                         # Next.js frontend
│       ├── app/                     # /, /register, /login, /dashboard, /devices, /link, /recovery, /security
│       ├── components/              # Nav, Alert, Badge, PageHeader, StatCard, Steps, RecoveryCodeBox, CeremonyInspector
│       └── lib/                     # api client (+ step-up), WebAuthn structure decoder
├── packages/shared/                 # shared TypeScript types
├── prisma/                          # schema + migrations
├── docker-compose.yml               # local PostgreSQL
└── .env.example
```

## 14. Limitations & future work

- This is an academic prototype. It has **not** been through a security audit, certification,
  or load testing (all were out of scope for Review 1).
- Challenges and rate-limit counters live in process memory. Running several instances would
  need a shared store such as Redis.
- Attestation is `none`: the server does not check authenticator make or model. Production could
  verify attestation against the FIDO Metadata Service.
- Recovery is a single one-time code. Social recovery and admin-assisted recovery are future work.
- Possible extensions: conditional-UI passkey autofill, WebAuthn PRF for end-to-end encryption,
  and deployment behind TLS with a real domain.

## References

- W3C, *Web Authentication: An API for accessing Public Key Credentials, Level 2*
- FIDO Alliance, *Client to Authenticator Protocol (CTAP) 2.1*
- NIST SP 800-63B, *Digital Identity Guidelines — Authentication and Lifecycle Management*
- Verizon, *Data Breach Investigations Report*
- SimpleWebAuthn documentation, <https://simplewebauthn.dev>
