// In-memory single-use challenge store with TTL.
// Academic choice: keeps the prototype simple with no extra infra (no Redis).
// Challenges are random per request, short-lived, and deleted after one use
// (replay protection). A multi-instance production deployment would need a
// shared store instead.

interface Entry {
  challenge: string;
  expiresAt: number;
}

const store = new Map<string, Entry>();

function sweep() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

export function saveChallenge(key: string, challenge: string, ttlMs: number) {
  sweep();
  store.set(key, { challenge, expiresAt: Date.now() + ttlMs });
}

export function consumeChallenge(key: string): string | null {
  sweep();
  const entry = store.get(key);
  if (!entry) return null;
  store.delete(key);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.challenge;
}

export function peekChallenge(key: string): string | null {
  return store.get(key)?.challenge ?? null;
}

export function clearChallenges() {
  store.clear();
}
