import type { NextFunction, Request, Response } from 'express';
import { verifySession } from '../auth.js';

export interface AuthedRequest extends Request {
  userId?: string;
  username?: string;
}

export function getToken(req: Request): string | null {
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.session;
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = getToken(req);
  if (!token) {
    res.status(401).json({ error: 'Not authenticated. Please log in with your passkey.' });
    return;
  }
  try {
    const claims = verifySession(token);
    req.userId = claims.sub;
    req.username = claims.username;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    return;
  }
}
