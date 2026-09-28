import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  credential: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  activityLog: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('./db.js', () => ({ prisma: mocks }));

import { createApp } from './app.js';
import { signSession } from './auth.js';
import { clearChallenges } from './challengeStore.js';

const app = createApp();
const authHeader = (sub = 'u1', username = 'alice') => ({
  Authorization: `Bearer ${signSession(sub, username)}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearChallenges();
});

describe('protected routes', () => {
  it('rejects unauthenticated requests to /api/users/me', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('rejects expired/invalid JWTs', async () => {
    const res = await request(app).get('/api/users/me').set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated device listing', async () => {
    const res = await request(app).get('/api/devices');
    expect(res.status).toBe(401);
  });
});

describe('login options', () => {
  it('returns 404 for unknown usernames', async () => {
    mocks.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/auth/login-options').send({ username: 'nobody' });
    expect(res.status).toBe(404);
  });

  it('refuses login when the account has no active passkeys', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 'u1', username: 'alice' });
    mocks.credential.findMany.mockResolvedValue([]);
    const res = await request(app).post('/api/auth/login-options').send({ username: 'alice' });
    expect(res.status).toBe(400);
  });

  it('rejects revoked credentials at login-verify time', async () => {
    const { saveChallenge } = await import('./challengeStore.js');
    mocks.user.findUnique.mockResolvedValue({ id: 'u1', username: 'alice' });
    mocks.credential.findUnique.mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      credentialID: 'cred-id',
      revokedAt: new Date(),
      deviceLabel: 'Old laptop',
    });
    saveChallenge('auth:u1', 'test-challenge', 60_000);
    const res = await request(app)
      .post('/api/auth/login-verify')
      .send({ username: 'alice', assertionResponse: { id: 'cred-id', type: 'public-key' } });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });
});

describe('device revocation', () => {
  it('rejects revoking an already-revoked device', async () => {
    mocks.credential.findFirst.mockResolvedValue({ id: 'c1', revokedAt: new Date(), deviceLabel: 'X' });
    const res = await request(app).post('/api/devices/c1/revoke').set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been revoked/i);
  });

  it('blocks removing the last device when no recovery code exists', async () => {
    mocks.credential.findFirst.mockResolvedValue({ id: 'c1', revokedAt: null, deviceLabel: 'Only' });
    mocks.credential.count.mockResolvedValue(0);
    mocks.user.findUnique.mockResolvedValue({ id: 'u1', recoveryCodeHash: null });
    const res = await request(app).post('/api/devices/c1/revoke').set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last active device/i);
  });

  it('returns 404 for devices owned by someone else', async () => {
    mocks.credential.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/api/devices/other/revoke').set(authHeader());
    expect(res.status).toBe(404);
  });
});

describe('database failures', () => {
  it('returns a generic 500 without leaking internals or crashing', async () => {
    mocks.user.findUnique.mockRejectedValue(new Error('connect ECONNREFUSED secret-details'));
    const res = await request(app).post('/api/auth/login-options').send({ username: 'alice' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Something went wrong. Please try again.');
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|secret-details/);
  });
});

describe('recovery', () => {  it('rejects invalid username/recovery code without revealing which', async () => {
    mocks.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/recovery/verify')
      .send({ username: 'alice', recoveryCode: 'NOPE-NOPE-NOPE-NOPE' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid username or recovery code/i);
  });

  it('rejects a wrong recovery code for a real account', async () => {
    const { hashRecoveryCode } = await import('./recovery.js');
    mocks.user.findUnique.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      recoveryCodeHash: await hashRecoveryCode('AAAA-BBBB-CCCC-DDDD'),
    });
    const res = await request(app)
      .post('/api/recovery/verify')
      .send({ username: 'alice', recoveryCode: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
    expect(res.status).toBe(401);
  });
});
