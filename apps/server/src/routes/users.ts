import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { getToken, requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { verifySession } from '../auth.js';
import { wrapRouter } from '../middleware/wrapRouter.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get('/me', async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(401).json({ error: 'Account not found.' });
    return;
  }
  const deviceCount = await prisma.credential.count({
    where: { userId: user.id, revokedAt: null },
  });
  const token = getToken(req);
  let session: { issuedAt: string | null; expiresAt: string | null } = {
    issuedAt: null,
    expiresAt: null,
  };
  if (token) {
    try {
      const decoded = jwt.decode(token) as { iat?: number; exp?: number } | null;
      session = {
        issuedAt: decoded?.iat ? new Date(decoded.iat * 1000).toISOString() : null,
        expiresAt: decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null,
      };
      verifySession(token); // ensures it is still valid, not just decodable
    } catch {
      res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
      return;
    }
  }
  res.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
    deviceCount,
    hasRecoveryCode: Boolean(user.recoveryCodeHash),
    session: { ...session, status: 'authenticated' },
  });
});

wrapRouter(usersRouter);
