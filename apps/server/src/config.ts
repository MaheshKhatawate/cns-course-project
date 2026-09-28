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

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/passwordless_demo'),
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  recoveryTokenExpiresIn: '10m',
  rpID: process.env.WEBAUTHN_RP_ID ?? 'localhost',
  rpName: process.env.WEBAUTHN_RP_NAME ?? 'Passwordless Demo (CNS)',
  origin: process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:3000',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  // Challenges are single-use and expire after this many ms.
  challengeTtlMs: Number(process.env.CHALLENGE_TTL_MS ?? 5 * 60 * 1000),
  isProd: process.env.NODE_ENV === 'production',
};
