import crypto from 'node:crypto';

// One-time device-linking codes (FR-4). A signed-in user generates a short code;
// a new device/browser enters it to enrol its own passkey on the same account.
// Codes are stored only as SHA-256 hashes, expire after 10 minutes, allow at most
// 5 wrong guesses and are deleted once used. In-memory like the challenge store.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface LinkCode {
  id: string;
  hash: string;
  expiresAt: number;
  attempts: number;
}

const codes = new Map<string, LinkCode>(); // userId → active code

const hash = (code: string) =>
  crypto.createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

export function createLinkCode(userId: string) {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
  const entry = { id: crypto.randomUUID(), hash: hash(formatted), expiresAt: Date.now() + LINK_CODE_TTL_MS, attempts: 0 };
  codes.set(userId, entry);
  return { code: formatted, expiresAt: new Date(entry.expiresAt) };
}

// Returns the code id when the code is valid; counts failed attempts.
export function checkLinkCode(userId: string, code: string): string | null {
  const entry = codes.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    codes.delete(userId);
    return null;
  }
  const a = Buffer.from(entry.hash, 'hex');
  const b = Buffer.from(hash(code), 'hex');
  if (crypto.timingSafeEqual(a, b)) return entry.id;
  entry.attempts += 1;
  if (entry.attempts >= MAX_ATTEMPTS) codes.delete(userId);
  return null;
}

export function consumeLinkCode(userId: string, id: string): boolean {
  const entry = codes.get(userId);
  if (!entry || entry.id !== id || entry.expiresAt <= Date.now()) return false;
  codes.delete(userId);
  return true;
}

export function activeLinkCode(userId: string) {
  const entry = codes.get(userId);
  return entry && entry.expiresAt > Date.now() ? { expiresAt: new Date(entry.expiresAt) } : null;
}

export function cancelLinkCode(userId: string) {
  codes.delete(userId);
}

export function clearLinkCodes() {
  codes.clear();
}
