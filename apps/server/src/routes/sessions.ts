import { Router } from 'express';
import { prisma } from '../db.js';
import { logActivity } from '../activity.js';
import { revokeSessions } from '../sessions.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { wrapRouter } from '../middleware/wrapRouter.js';

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

// FR-6: active sessions (one per successful passkey login), with the device that created each.
sessionsRouter.get('/', async (req: AuthedRequest, res) => {
  const sessions = await prisma.session.findMany({
    where: { userId: req.userId!, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { credential: { select: { deviceLabel: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      deviceLabel: s.credential?.deviceLabel ?? null,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      lastAuthAt: s.lastAuthAt.toISOString(),
      ip: s.ip,
      userAgent: s.userAgent,
      isCurrent: s.id === req.sessionId,
    })),
  });
});

sessionsRouter.post('/revoke-others', async (req: AuthedRequest, res) => {
  const count = await revokeSessions({ userId: req.userId!, id: { not: req.sessionId! } });
  await logActivity(req.userId!, 'SESSION_REVOKED', `Signed out ${count} other session(s).`, { req });
  res.json({ ok: true, count });
});

sessionsRouter.post('/:id/revoke', async (req: AuthedRequest, res) => {
  const session = await prisma.session.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  await revokeSessions({ id: session.id });
  await logActivity(req.userId!, 'SESSION_REVOKED', 'A session was signed out.', { req });
  res.json({ ok: true, signedOut: session.id === req.sessionId });
});

wrapRouter(sessionsRouter);
