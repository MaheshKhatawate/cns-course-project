import type { NextFunction, Request, Response, Router } from 'express';

type Handler = (req: never, res: Response, next: NextFunction) => unknown;

// Wraps async route handlers so DB/unexpected failures become a generic 500
// instead of an unhandled rejection that crashes the process (Express 4 does
// not catch async errors on its own).
export function wrapRouter(router: Router) {
  for (const layer of (router as unknown as { stack: Array<{ route?: { stack: Array<{ handle: Handler }> } }> }).stack) {
    const route = layer.route;
    if (!route) continue;
    for (const s of route.stack) {
      const orig = s.handle;
      s.handle = ((req: Request, res: Response, next: NextFunction) =>
        Promise.resolve(orig(req as never, res, next)).catch(next)) as Handler;
    }
  }
}
