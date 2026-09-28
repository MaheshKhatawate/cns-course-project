import { describe, expect, it, beforeEach } from 'vitest';
import { consumeChallenge, saveChallenge, clearChallenges } from './challengeStore.js';
import {
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} from './recovery.js';
import { signRecoveryToken, signSession, verifyRecoveryToken, verifySession } from './auth.js';

describe('challenge store', () => {
  beforeEach(() => clearChallenges());

  it('is single-use: second consume returns null (replay protection)', () => {
    saveChallenge('k1', 'challenge-abc', 60_000);
    expect(consumeChallenge('k1')).toBe('challenge-abc');
    expect(consumeChallenge('k1')).toBeNull();
  });

  it('rejects expired challenges', async () => {
    saveChallenge('k2', 'challenge-old', 10);
    await new Promise((r) => setTimeout(r, 25));
    expect(consumeChallenge('k2')).toBeNull();
  });

  it('isolates challenges per key', () => {
    saveChallenge('a', 'ca', 60_000);
    saveChallenge('b', 'cb', 60_000);
    expect(consumeChallenge('a')).toBe('ca');
    expect(consumeChallenge('b')).toBe('cb');
  });
});

describe('recovery codes', () => {
  it('generates unique codes and verifies case/format-insensitively', async () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    const hash = await hashRecoveryCode(a);
    expect(hash).not.toContain(normalizeRecoveryCode(a)); // never plain text
    expect(await verifyRecoveryCode(a.toLowerCase().replace(/-/g, ' '), hash)).toBe(true);
    expect(await verifyRecoveryCode('WRONG-CODE-1234-5678', hash)).toBe(false);
  });
});

describe('JWT sessions', () => {
  it('signs and verifies a session, and rejects tampered tokens', () => {
    const token = signSession('user-1', 'alice');
    const claims = verifySession(token);
    expect(claims.sub).toBe('user-1');
    expect(claims.username).toBe('alice');
    expect(() => verifySession(token + 'tampered')).toThrow();
  });

  it('rejects expired tokens', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const { config } = await import('./config.js');
    const expired = jwt.sign({ sub: 'u', username: 'x' }, config.jwtSecret, { expiresIn: '1ms' });
    await new Promise((r) => setTimeout(r, 20));
    expect(() => verifySession(expired)).toThrow();
  });

  it('recovery tokens cannot be used as session tokens and vice versa', () => {
    const rec = signRecoveryToken('user-1', 'alice');
    expect(verifyRecoveryToken(rec).purpose).toBe('recovery');
    const session = signSession('user-1', 'alice');
    expect(() => verifyRecoveryToken(session)).toThrow();
  });
});
