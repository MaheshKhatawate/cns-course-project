import { describe, expect, it, beforeEach } from 'vitest';
import { consumeChallenge, saveChallenge, clearChallenges } from './challengeStore.js';
import {
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} from './recovery.js';
import { signRecoveryToken, signSession, verifyRecoveryToken, verifySession } from './auth.js';
import { parseDurationMs } from './config.js';

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
    const token = signSession('user-1', 'alice', 'session-1');
    const claims = verifySession(token);
    expect(claims.sub).toBe('user-1');
    expect(claims.username).toBe('alice');
    expect(claims.jti).toBe('session-1');
    expect(() => verifySession(token + 'tampered')).toThrow();
  });

  it('rejects expired tokens', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const { config } = await import('./config.js');
    const expired = jwt.sign({ sub: 'u', username: 'x', purpose: 'session' }, config.jwtSecret, { expiresIn: '1ms', jwtid: 's' });
    await new Promise((r) => setTimeout(r, 20));
    expect(() => verifySession(expired)).toThrow();
  });

  it('recovery tokens cannot be used as session tokens and vice versa', () => {
    const rec = signRecoveryToken('user-1', 'alice', 'bcrypt-hash');
    expect(verifyRecoveryToken(rec).purpose).toBe('recovery');
    expect(() => verifySession(rec)).toThrow();
    const session = signSession('user-1', 'alice', 's1');
    expect(() => verifyRecoveryToken(session)).toThrow();
  });

  it('rejects tokens signed with the "none" algorithm', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const unsigned = jwt.sign({ sub: 'u', username: 'x', purpose: 'session', jti: 's' }, '', { algorithm: 'none' });
    expect(() => verifySession(unsigned)).toThrow();
  });
});

describe('config', () => {
  it('parses session durations', () => {
    expect(parseDurationMs('15m')).toBe(900_000);
    expect(parseDurationMs('1h')).toBe(3_600_000);
    expect(parseDurationMs('7d')).toBe(604_800_000);
    expect(parseDurationMs('30')).toBe(30_000);
    expect(() => parseDurationMs('soon')).toThrow();
  });
});

describe('device link codes', () => {
  it('are single-use and case/format-insensitive', async () => {
    const { createLinkCode, checkLinkCode, consumeLinkCode, clearLinkCodes } = await import('./linkCodes.js');
    clearLinkCodes();
    const { code } = createLinkCode('u1');
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const id = checkLinkCode('u1', code.toLowerCase().replace('-', ' '));
    expect(id).toBeTruthy();
    expect(consumeLinkCode('u1', id!)).toBe(true);
    expect(checkLinkCode('u1', code)).toBeNull();
  });

  it('are invalidated after 5 wrong guesses', async () => {
    const { createLinkCode, checkLinkCode, clearLinkCodes } = await import('./linkCodes.js');
    clearLinkCodes();
    const { code } = createLinkCode('u2');
    for (let i = 0; i < 5; i++) expect(checkLinkCode('u2', 'WRON-GGGG')).toBeNull();
    expect(checkLinkCode('u2', code)).toBeNull();
  });
});
