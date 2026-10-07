import crypto from 'node:crypto';

// Random per-process token sent by the in-process attack simulator so that its
// burst of self-requests does not exhaust the per-IP rate limit for real users
// on the same machine. It is never exposed over HTTP.
export const SIMULATOR_TOKEN = crypto.randomBytes(32).toString('hex');
export const SIMULATOR_HEADER = 'x-attack-simulator';
