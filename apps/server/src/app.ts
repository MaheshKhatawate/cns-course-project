import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { devicesRouter } from './routes/devices.js';
import { recoveryRouter } from './routes/recovery.js';
import { usersRouter } from './routes/users.js';
import { activityRouter } from './routes/activity.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: config.webOrigin,
      credentials: true,
    }),
  );

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/recovery', recoveryRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/activity', activityRouter);

  // Fallback error handler: never leak stack traces to clients.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
