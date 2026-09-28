# Passwordless Authentication Using Public-Key Cryptography

Academic **Cryptography and Network Security (CNS)** project demonstrating passwordless
authentication with **FIDO2/WebAuthn**: the browser creates a public/private key pair in the
authenticator, the **private key never leaves the device**, and the server stores only the
**public key**. Login is a challenge–response ceremony verified by the server, followed by a
JWT session.

## Features

- Passwordless registration (real WebAuthn, SimpleWebAuthn)
- Passwordless login (challenge–response, no passwords anywhere)
- Multi-device credentials (one user → many passkeys)
- Device management (list, add, revoke)
- Device revocation (revoked credentials are rejected; kept for audit)
- Recovery code (one-time code shown at registration, stored as bcrypt hash)
- JWT sessions in a secure HTTP-only cookie with expiry
- Authentication/activity logs (registration, login success/failure, device add/revoke, recovery)
- Auth-flow visualization on the dashboard for the project demo

## Tech Stack

- Next.js + TypeScript + Tailwind CSS (frontend, `apps/web`)
- Node.js + Express + TypeScript (backend, `apps/server`)
- PostgreSQL + Prisma ORM (`prisma/`)
- SimpleWebAuthn (`@simplewebauthn/server`, `@simplewebauthn/browser`)
- jsonwebtoken (sessions), bcryptjs (recovery-code hashing)

## Folder Structure

```text
.
├── apps/
│   ├── web/                 # Next.js frontend (/, /register, /login, /dashboard, /devices, /recovery)
│   │   ├── app/             # routes + layout
│   │   ├── components/      # small reusable UI helpers
│   │   └── lib/api.ts       # typed API client + WebAuthn availability check
│   └── server/              # Express backend
│       └── src/
│           ├── routes/      # auth, devices, recovery, users, activity
│           ├── middleware/requireAuth.ts
│           ├── challengeStore.ts  # single-use short-lived challenges (in-memory)
│           ├── auth.ts      # JWT session + recovery tokens
│           ├── recovery.ts  # recovery-code generate/hash/verify
│           └── activity.ts  # activity logging helper
├── packages/shared/         # shared TypeScript types
├── prisma/
│   ├── schema.prisma        # User, Credential, ActivityLog
│   └── migrations/          # initial SQL migration
├── package.json             # npm workspaces + convenience scripts
└── .env.example
```

## Authentication Flow

**Registration:** username → server generates registration options → browser calls
`navigator.credentials.create()` → authenticator creates a key pair → public key is sent to
the server, verified, and stored; the private key stays on the device. A one-time recovery
code is shown (only once).

**Login:** username → server generates a fresh random challenge → browser calls
`navigator.credentials.get()` → user verifies (fingerprint/face/PIN/key) → authenticator
signs the challenge → server verifies the signature, checks the counter (replay/clone
protection), and issues a JWT in an HTTP-only cookie.

## Environment Variables

| Variable | Used by | Meaning / local value |
|---|---|---|
| `DATABASE_URL` | backend, Prisma | e.g. `postgresql://postgres:postgres@localhost:5432/passwordless_demo` |
| `PORT` | backend | `4000` |
| `JWT_SECRET` | backend | long random string (never commit) |
| `JWT_EXPIRES_IN` | backend | `1h` |
| `WEBAUTHN_RP_ID` | backend | `localhost` (hostname only, no port) |
| `WEBAUTHN_RP_NAME` | backend | `Passwordless Demo (CNS)` |
| `WEBAUTHN_ORIGIN` | backend | `http://localhost:3000` (must match frontend exactly) |
| `WEB_ORIGIN` | backend | `http://localhost:3000` (CORS) |
| `NEXT_PUBLIC_API_URL` | frontend | `http://localhost:4000` (in `apps/web/.env.local`) |

## PostgreSQL Setup

1. Install PostgreSQL 14+ and start it.
2. Create the database: `createdb passwordless_demo`
   (or `CREATE DATABASE passwordless_demo;` in `psql`).
3. Copy env files:
   ```bash
   cp .env.example .env
   cp apps/web/.env.example apps/web/.env.local
   ```
4. Edit `.env` — at minimum set a real `JWT_SECRET` and check `DATABASE_URL`.

## Installation

```bash
npm install
```

## Database Setup

```bash
npx prisma generate
npx prisma migrate dev --name init
```

## Startup

```bash
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:4000 (`GET /api/health`)
- Or run separately: `npm run dev:server`, `npm run dev:web`.

> WebAuthn requires a secure context: `localhost` works. Use a platform authenticator
> (Touch ID / Windows Hello), a phone, or a FIDO2 security key. Chrome/Edge/Safari/Firefox
> all support it.

## API Endpoints

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/api/health` | health check | no |
| POST | `/api/auth/register-options` | registration options + challenge | no |
| POST | `/api/auth/register-verify` | verify credential, store public key (+ recovery code first time) | no |
| POST | `/api/auth/login-options` | authentication challenge | no |
| POST | `/api/auth/login-verify` | verify assertion, set JWT cookie | no |
| POST | `/api/auth/logout` | clear session cookie | no |
| GET | `/api/users/me` | current user, device count, session info | JWT |
| GET | `/api/devices` | list devices (active + revoked) | JWT |
| POST | `/api/devices/options` | options to add a device | JWT |
| POST | `/api/devices/verify` | verify + store new device credential | JWT |
| POST | `/api/devices/:id/revoke` | revoke a device | JWT |
| POST | `/api/recovery/verify` | verify recovery code → short-lived token | no |
| POST | `/api/recovery/register-options` | options for replacement credential | recovery token |
| POST | `/api/recovery/register-verify` | verify + store replacement credential | recovery token |
| GET | `/api/activity?limit=` | recent activity | JWT |

## Testing

```bash
npm run test
```

Covers: single-use/expiring challenges, recovery-code hashing, JWT sign/verify/expiry,
auth-middleware rejections, revoked-credential rejection, last-device-without-recovery guard,
and recovery verification. WebAuthn ceremonies themselves need a real browser/authenticator,
so tests cover all surrounding backend logic.

## Limitations

- Academic prototype — **not** security-audited, certified, or production-ready.
- Challenges live in server memory (single instance; use a shared store for multi-instance).
- Recovery is a basic one-time code, not production/social recovery.
- No Docker; run directly with Node 20+ and a local PostgreSQL.
