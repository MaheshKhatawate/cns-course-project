// In-memory single-use challenge store with TTL.
// Academic choice: keeps the prototype simple with no extra infra (no Redis).
// Challenges are random per request, short-lived, and deleted after one use
// (replay protection). A multi-instance production deployment would need a
// shared store instead.

interface Entry<T = unknown> {
  challenge: string;
  data?: T;
  expiresAt: number;
}

const store = new Map<string, Entry>();

function sweep() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

// `data` carries ceremony state that must not be trusted from the client
// (e.g. the pending username/user handle during registration).
export function saveChallenge<T>(key: string, challenge: string, ttlMs: number, data?: T) {
  sweep();
  store.set(key, { challenge, data, expiresAt: Date.now() + ttlMs });
}

export function consumeChallengeEntry<T>(key: string): { challenge: string; data?: T } | null {
  sweep();
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return null;
  store.delete(key);
  if (entry.expiresAt <= Date.now()) return null;
  return { challenge: entry.challenge, data: entry.data };
}

export function consumeChallenge(key: string): string | null {
  return consumeChallengeEntry(key)?.challenge ?? null;
}

export function peekChallenge(key: string): string | null {
  return store.get(key)?.challenge ?? null;
}

export function clearChallenges() {
  store.clear();
}
