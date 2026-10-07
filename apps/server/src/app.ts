import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { devicesRouter } from './routes/devices.js';
import { recoveryRouter } from './routes/recovery.js';
import { usersRouter } from './routes/users.js';
import { activityRouter } from './routes/activity.js';
import { sessionsRouter } from './routes/sessions.js';
import { demoRouter } from './routes/demo.js';
import { linkRouter } from './routes/link.js';
import { originCheck } from './middleware/originCheck.js';
import { rateLimit } from './middleware/rateLimit.js';
import { SIMULATOR_HEADER, SIMULATOR_TOKEN } from './security/simulatorToken.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: config.webOrigin,
      credentials: true,
    }),
  );
  app.use(originCheck);

  const perIpLimiter = rateLimit({
    windowMs: 60_000,
    max: () => config.rateLimitPerMinute,
    key: (req) => req.ip ?? 'unknown',
    skip: (req) => req.get(SIMULATOR_HEADER) === SIMULATOR_TOKEN,
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, rpID: config.rpID, origin: config.origin }));

  app.use('/api/auth', perIpLimiter, authRouter);
  app.use('/api/recovery', perIpLimiter, recoveryRouter);
  app.use('/api/link', perIpLimiter, linkRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/activity', activityRouter);
  if (config.enableDemoRoutes) app.use('/api/demo', demoRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // Fallback error handler: never leak stack traces to clients.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if ((err as { type?: string })?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON body.' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
