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
  session: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  activityLog: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('./db.js', () => ({ prisma: mocks }));

import { createApp } from './app.js';
import { signSession } from './auth.js';
import { clearChallenges, saveChallenge } from './challengeStore.js';

const app = createApp();
const authHeader = (sub = 'u1', username = 'alice', sid = 's1') => ({
  Authorization: `Bearer ${signSession(sub, username, sid)}`,
});
const liveSession = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  userId: 'u1',
  revokedAt: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  lastAuthAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearChallenges();
  mocks.session.findUnique.mockResolvedValue(liveSession());
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

  it('rejects a valid JWT whose server-side session was revoked (logout)', async () => {
    mocks.session.findUnique.mockResolvedValue(liveSession({ revokedAt: new Date() }));
    const res = await request(app).get('/api/devices').set(authHeader());
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it('rejects a JWT whose session belongs to another user', async () => {
    mocks.session.findUnique.mockResolvedValue(liveSession({ userId: 'someone-else' }));
    const res = await request(app).get('/api/devices').set(authHeader());
    expect(res.status).toBe(401);
  });
});

describe('registration', () => {
  it('refuses to attach a passkey to an existing username (account takeover)', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 'u1', username: 'alice' });
    const res = await request(app).post('/api/auth/register-options').send({ username: 'Alice' });
    expect(res.status).toBe(409);
    expect(mocks.user.create).not.toHaveBeenCalled();
  });

  it('returns options without creating the account yet', async () => {
    mocks.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/auth/register-options').send({ username: 'newbie' });
    expect(res.status).toBe(200);
    expect(res.body.challenge).toEqual(expect.any(String));
    expect(res.body.rp.id).toBe('localhost');
    expect(res.body.pubKeyCredParams.map((p: { alg: number }) => p.alg)).toEqual([-7, -8, -257]);
    expect(mocks.user.create).not.toHaveBeenCalled();
  });

  it('rejects invalid usernames', async () => {
    const res = await request(app).post('/api/auth/register-options').send({ username: 'a b' });
    expect(res.status).toBe(400);
  });

  it('rejects register-verify without a pending registration', async () => {
    const res = await request(app)
      .post('/api/auth/register-verify')
      .send({ username: 'newbie', attResp: { id: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
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

  it('supports usernameless (discoverable credential) login', async () => {
    const res = await request(app).post('/api/auth/login-options').send({});
    expect(res.status).toBe(200);
    expect(res.body.flowId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.options.allowCredentials).toEqual([]);
  });

  it('rejects revoked credentials at login-verify time', async () => {
    const flowId = '11111111-1111-4111-8111-111111111111';
    mocks.credential.findUnique.mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      credentialID: 'cred-id',
      revokedAt: new Date(),
      deviceLabel: 'Old laptop',
      user: { id: 'u1', username: 'alice', webauthnUserId: 'handle' },
    });
    saveChallenge(`auth:${flowId}`, 'test-challenge', 60_000, { userId: 'u1' });
    const res = await request(app)
      .post('/api/auth/login-verify')
      .send({ flowId, assertionResponse: { id: 'cred-id', type: 'public-key', response: {} } });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it('rejects a login-verify whose challenge was already used', async () => {
    const res = await request(app)
      .post('/api/auth/login-verify')
      .send({ flowId: '22222222-2222-4222-8222-222222222222', assertionResponse: { id: 'x', response: {} } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired or already used/i);
  });
});

describe('device revocation', () => {
  it('requires a fresh passkey check (step-up) when the session is stale', async () => {
    mocks.session.findUnique.mockResolvedValue(liveSession({ lastAuthAt: new Date(Date.now() - 3_600_000) }));
    const res = await request(app).post('/api/devices/c1/revoke').set(authHeader());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });

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

  it('revokes the device and ends the sessions it created', async () => {
    mocks.credential.findFirst.mockResolvedValue({ id: 'c2', revokedAt: null, deviceLabel: 'Phone' });
    mocks.credential.count.mockResolvedValue(1);
    mocks.user.findUnique.mockResolvedValue({ id: 'u1', recoveryCodeHash: 'hash' });
    mocks.session.updateMany.mockResolvedValue({ count: 2 });
    const res = await request(app).post('/api/devices/c2/revoke').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.endedSessions).toBe(2);
    expect(mocks.credential.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c2' }, data: { revokedAt: expect.any(Date) } }),
    );
    expect(mocks.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ credentialId: 'c2', revokedAt: null }) }),
    );
  });

  it('returns 404 for devices owned by someone else', async () => {
    mocks.credential.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/api/devices/other/revoke').set(authHeader());
    expect(res.status).toBe(404);
  });
});

describe('CSRF protection', () => {
  it('blocks state-changing requests from a foreign Origin', async () => {
    const res = await request(app).post('/api/auth/logout').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('allows requests from the web app origin', async () => {
    const res = await request(app).post('/api/auth/logout').set('Origin', 'http://localhost:3000');
    expect(res.status).toBe(200);
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

describe('recovery', () => {
  it('rejects invalid username/recovery code without revealing which', async () => {
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
      .send({ username: 'alice2', recoveryCode: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
    expect(res.status).toBe(401);
  });

  it('rate-limits recovery code guessing', async () => {
    mocks.user.findUnique.mockResolvedValue(null);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await request(app).post('/api/recovery/verify').send({ username: 'target', recoveryCode: `G${i}` });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('rejects a recovery token after the code was rotated', async () => {
    const { signRecoveryToken } = await import('./auth.js');
    const token = signRecoveryToken('u1', 'alice', 'old-hash');
    mocks.user.findUnique.mockResolvedValue({ id: 'u1', username: 'alice', recoveryCodeHash: 'new-hash' });
    const res = await request(app).post('/api/recovery/register-options').send({ username: 'alice', recoveryToken: token });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/already been used/i);
  });
});
