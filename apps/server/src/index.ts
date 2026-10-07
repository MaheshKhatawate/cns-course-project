import { config } from './config.js';
import { createApp } from './app.js';
import { prisma } from './db.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Auth server listening on http://localhost:${config.port}`);
  console.log(`WebAuthn RP ID "${config.rpID}", expected origin ${config.origin}`);
  if (config.enableDemoRoutes) console.log('Demo attack simulator enabled at POST /api/demo/attacks');
});

// Periodically delete long-expired sessions (kept 7 days for the audit trail).
const cleanup = setInterval(() => {
  prisma.session
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } })
    .catch(() => {});
}, 60 * 60 * 1000);
cleanup.unref();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
