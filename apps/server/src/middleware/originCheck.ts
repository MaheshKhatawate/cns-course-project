import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

// CSRF defence in depth (on top of SameSite=Lax cookies and strict CORS):
// state-changing requests that carry an Origin header must come from the web app.
export function originCheck(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== config.webOrigin) {
    res.status(403).json({ error: 'Cross-site request blocked.' });
    return;
  }
  next();
}
