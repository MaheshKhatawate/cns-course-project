import { Router } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logActivity } from '../activity.js';
import { generateRecoveryCode, hashRecoveryCode } from '../recovery.js';
import { requireAuth, requireFreshAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { wrapRouter } from '../middleware/wrapRouter.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get('/me', async (req: AuthedRequest, res) => {
  const [user, session, deviceCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.userId! } }),
    prisma.session.findUnique({ where: { id: req.sessionId! }, include: { credential: true } }),
    prisma.credential.count({ where: { userId: req.userId!, revokedAt: null } }),
  ]);
  if (!user || !session) {
    res.status(401).json({ error: 'Account not found.' });
    return;
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
    recovery: {
      createdAt: user.recoveryCreatedAt?.toISOString() ?? null,
      lastUsedAt: user.recoveryLastUsedAt?.toISOString() ?? null,
    },
    session: {
      id: session.id,
      status: 'authenticated',
      issuedAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      lastAuthAt: session.lastAuthAt.toISOString(),
      freshUntil: new Date(session.lastAuthAt.getTime() + config.stepUpMaxAgeMs).toISOString(),
      deviceLabel: session.credential?.deviceLabel ?? null,
    },
  });
});

// Replace the recovery code (e.g. if the old one was exposed). Requires a fresh passkey check.
usersRouter.post('/me/recovery-code', requireFreshAuth, async (req: AuthedRequest, res) => {
  const recoveryCode = generateRecoveryCode();
  await prisma.user.update({
    where: { id: req.userId! },
    data: { recoveryCodeHash: await hashRecoveryCode(recoveryCode), recoveryCreatedAt: new Date() },
  });
  await logActivity(req.userId!, 'RECOVERY_CODE_ROTATED', 'A new recovery code was generated; the old one no longer works.', { req });
  res.json({ recoveryCode });
});

wrapRouter(usersRouter);
