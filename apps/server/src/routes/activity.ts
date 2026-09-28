import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { wrapRouter } from '../middleware/wrapRouter.js';

export const activityRouter = Router();
activityRouter.use(requireAuth);

activityRouter.get('/', async (req: AuthedRequest, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 10) || 10, 1), 50);
  const logs = await prisma.activityLog.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json({
    activity: logs.map((l) => ({
      id: l.id,
      type: l.type,
      message: l.message,
      deviceLabel: l.deviceLabel,
      createdAt: l.createdAt.toISOString(),
    })),
  });
});

wrapRouter(activityRouter);
