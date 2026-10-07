import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { config } from './config.js';
import { prisma } from './db.js';
import { signSession } from './auth.js';

export const SESSION_COOKIE = 'session';

// Creates a server-side session row and sets the signed JWT (jti = session id)
// as an HTTP-only cookie. Called only after a successful WebAuthn ceremony.
export async function issueSession(
  req: Request,
  res: Response,
  user: { id: string; username: string },
  credentialId: string | null,
) {
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      credentialId,
      expiresAt,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
    },
  });
  const token = signSession(user.id, user.username, session.id);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.sessionTtlMs,
    path: '/',
  });
  return { session, token };
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.isProd });
}

export async function revokeSessions(where: Prisma.SessionWhereInput) {
  const result = await prisma.session.updateMany({
    where: { ...where, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
