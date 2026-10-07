import dotenv from 'dotenv';
import path from 'node:path';

// Load apps/server/.env first (takes precedence), then repo-root .env as fallback.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

// Parses durations like "1h", "15m", "30s", "7d" or a plain number of seconds.
export function parseDurationMs(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(input.trim());
  if (!m) throw new Error(`Invalid duration "${input}" (use e.g. 15m, 1h, 7d)`);
  const n = Number(m[1]);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] ?? 's']!;
  return n * unit;
}

const isProd = process.env.NODE_ENV === 'production';
const jwtSecret = required('JWT_SECRET', isProd ? undefined : 'dev-only-secret-change-me');
if (isProd && jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/passwordless_demo'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  sessionTtlMs: parseDurationMs(process.env.JWT_EXPIRES_IN ?? '1h'),
  recoveryTokenExpiresIn: '10m',
  rpID: process.env.WEBAUTHN_RP_ID ?? 'localhost',
  rpName: process.env.WEBAUTHN_RP_NAME ?? 'Passwordless Demo (CNS)',
  origin: process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:3000',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  // Challenges are single-use and expire after this many ms.
  challengeTtlMs: Number(process.env.CHALLENGE_TTL_MS ?? 5 * 60 * 1000),
  // Sensitive actions (revoke device, add device, new recovery code) need a
  // WebAuthn assertion within this window, otherwise a step-up is required.
  stepUpMaxAgeMs: Number(process.env.STEP_UP_MAX_AGE_MS ?? 5 * 60 * 1000),
  // Per-IP request budget for /api/auth and /api/recovery (per minute).
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120),
  // Recovery-code guesses allowed per IP+username per 15 minutes.
  recoveryAttemptsPer15Min: Number(process.env.RECOVERY_ATTEMPTS_PER_15_MIN ?? 5),
  // Exposes POST /api/demo/attacks (attack simulator). Off in production by default.
  enableDemoRoutes: (process.env.ENABLE_DEMO_ROUTES ?? (isProd ? 'false' : 'true')) === 'true',
  isProd,
};
