import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

// Minimal fixed-window, in-memory rate limiter (single instance prototype).
// Slows down brute-force guessing of recovery codes and request flooding.
export function rateLimit(opts: {
  windowMs: number;
  max: () => number;
  key: (req: Request) => string;
  skip?: (req: Request) => boolean;
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (opts.skip?.(req)) return next();
    const now = Date.now();
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    const key = opts.key(req);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const max = opts.max();
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: opts.message ?? 'Too many requests. Please wait and try again.' });
      return;
    }
    next();
  };
}
