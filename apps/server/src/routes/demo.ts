import { Router } from 'express';
import { runScenarios, scenarios } from '../security/scenarios.js';
import { wrapRouter } from '../middleware/wrapRouter.js';

// Attack simulator for the project demo (disabled in production unless
// ENABLE_DEMO_ROUTES=true). Runs every scenario against this same server over
// HTTP using throwaway accounts, which are deleted afterwards.
export const demoRouter = Router();

let running = false;

demoRouter.get('/attacks', (_req, res) => {
  res.json({ scenarios: scenarios.map(({ id, title, threat, expected }) => ({ id, title, threat, expected })) });
});

demoRouter.post('/attacks', async (req, res) => {
  if (running) {
    res.status(409).json({ error: 'A simulation is already running.' });
    return;
  }
  running = true;
  try {
    const port = req.socket.localPort;
    const only = Array.isArray(req.body?.only) ? (req.body.only as string[]) : undefined;
    const results = await runScenarios(`http://127.0.0.1:${port}`, { only });
    res.json({ results, passed: results.filter((r) => r.passed).length, total: results.length });
  } finally {
    running = false;
  }
});

wrapRouter(demoRouter);
