import type { NextFunction, Request, Response } from 'express';
import { verifySession } from '../auth.js';
import { config } from '../config.js';
import { prisma } from '../db.js';

export interface AuthedRequest extends Request {
  userId?: string;
  username?: string;
  sessionId?: string;
  sessionLastAuthAt?: Date;
}

export function getToken(req: Request): string | null {
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.session;
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Valid JWT signature + expiry is not enough: the server-side session must also
// exist and not be revoked (logout, device revocation, "sign out other sessions").
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = getToken(req);
  if (!token) {
    res.status(401).json({ error: 'Not authenticated. Please log in with your passkey.' });
    return;
  }
  let claims;
  try {
    claims = verifySession(token);
  } catch {
    res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    return;
  }
  try {
    const session = await prisma.session.findUnique({ where: { id: claims.jti } });
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date()) {
      res.status(401).json({ error: 'Session expired or revoked. Please log in again.' });
      return;
    }
    req.userId = claims.sub;
    req.username = claims.username;
    req.sessionId = session.id;
    req.sessionLastAuthAt = session.lastAuthAt;
    next();
  } catch (err) {
    next(err);
  }
}

// Step-up authentication for sensitive actions: the user must have signed a
// WebAuthn challenge recently in this session (login or /api/auth/reauth-verify).
export function requireFreshAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const last = req.sessionLastAuthAt?.getTime() ?? 0;
  if (Date.now() - last > config.stepUpMaxAgeMs) {
    res.status(403).json({
      error: 'Please confirm it is you with your passkey before doing this.',
      code: 'REAUTH_REQUIRED',
    });
    return;
  }
  next();
}
