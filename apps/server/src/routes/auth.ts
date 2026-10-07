import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { consumeChallenge, consumeChallengeEntry, saveChallenge } from '../challengeStore.js';
import { verifySession } from '../auth.js';
import { logActivity } from '../activity.js';
import { generateRecoveryCode, hashRecoveryCode } from '../recovery.js';
import { authenticationOptions, newWebAuthnUserId, registrationOptions, verifyAssertion, verifyRegistration } from '../webauthn.js';
import { clearSessionCookie, issueSession } from '../sessions.js';
import { getToken, requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { wrapRouter } from '../middleware/wrapRouter.js';

export const authRouter = Router();

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Use 3–64 letters, numbers, dots, underscores or dashes.')
  .max(64, 'Use 3–64 letters, numbers, dots, underscores or dashes.')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Use 3–64 letters, numbers, dots, underscores or dashes.');

export const deviceLabelSchema = z.string().trim().min(1).max(64);

export function norm(name: string) {
  return name.trim().toLowerCase();
}

export function toPublicUser(u: { id: string; username: string; displayName: string; createdAt: Date }) {
  return { id: u.id, username: u.username, displayName: u.displayName, createdAt: u.createdAt.toISOString() };
}

interface PendingRegistration {
  username: string;
  displayName: string;
  webauthnUserId: string;
}

// ---- Registration (FR-1) ----
// The account is only created after the authenticator has proven possession of
// a new key pair, so abandoned registrations leave nothing behind and nobody can
// attach a passkey to someone else's existing username.

authRouter.post('/register-options', async (req, res) => {
  const parsed = z
    .object({ username: usernameSchema, displayName: z.string().trim().max(64).optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
    return;
  }
  const username = norm(parsed.data.username);
  const displayName = parsed.data.displayName?.trim() || parsed.data.username.trim();

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    res.status(409).json({
      error: 'That username is already taken. Log in instead, or add a new device from your dashboard.',
    });
    return;
  }

  const pending: PendingRegistration = { username, displayName, webauthnUserId: newWebAuthnUserId() };
  const options = await registrationOptions(pending);
  saveChallenge(`reg:${username}`, options.challenge, config.challengeTtlMs, pending);
  res.json(options);
});

authRouter.post('/register-verify', async (req, res) => {
  const parsed = z
    .object({ username: usernameSchema, attResp: z.record(z.unknown()), deviceLabel: deviceLabelSchema.optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid registration response.' });
    return;
  }
  const username = norm(parsed.data.username);
  const entry = consumeChallengeEntry<PendingRegistration>(`reg:${username}`);
  if (!entry?.data) {
    res.status(400).json({ error: 'Registration expired. Please start again.' });
    return;
  }
  const pending = entry.data;

  const cred = await verifyRegistration(parsed.data.attResp, entry.challenge);
  if (!cred) {
    res.status(400).json({ error: 'Registration verification failed. Please try again.' });
    return;
  }
  if (await prisma.user.findUnique({ where: { username } })) {
    res.status(409).json({ error: 'That username was just taken. Please choose another.' });
    return;
  }
  if (await prisma.credential.findUnique({ where: { credentialID: cred.credentialID } })) {
    res.status(409).json({ error: 'This authenticator is already registered.' });
    return;
  }

  const deviceLabel = parsed.data.deviceLabel || 'My device';
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await hashRecoveryCode(recoveryCode);

  const { user, credential } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { ...pending, recoveryCodeHash, recoveryCreatedAt: new Date() },
    });
    const credential = await tx.credential.create({ data: { ...cred, userId: user.id, deviceLabel } });
    return { user, credential };
  });

  await logActivity(user.id, 'REGISTRATION', 'Account registered with first passkey.', { deviceLabel, req });
  await issueSession(req, res, user, credential.id);
  await logActivity(user.id, 'LOGIN_SUCCESS', 'Signed in after registration.', { deviceLabel, req });

  res.json({
    verified: true,
    user: toPublicUser(user),
    recoveryCode,
    credential: { id: credential.id, deviceLabel, algorithm: credential.algorithm, deviceType: credential.deviceType },
  });
});

// ---- Login: challenge–response (FR-2) ----
// With a username the challenge is bound to that account's passkeys; without one
// the browser offers any discoverable passkey for this site (usernameless login).

authRouter.post('/login-options', async (req, res) => {
  const parsed = z.object({ username: usernameSchema.optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid username.' });
    return;
  }
  let userId: string | undefined;
  let allowed: Awaited<ReturnType<typeof prisma.credential.findMany>> = [];
  if (parsed.data.username) {
    const user = await prisma.user.findUnique({ where: { username: norm(parsed.data.username) } });
    if (!user) {
      res.status(404).json({ error: 'Account not found. Please register first.' });
      return;
    }
    allowed = await prisma.credential.findMany({ where: { userId: user.id, revokedAt: null } });
    if (allowed.length === 0) {
      res.status(400).json({ error: 'No active passkeys. Use recovery to register a new one.' });
      return;
    }
    userId = user.id;
  }

  const options = await authenticationOptions(allowed);
  const flowId = crypto.randomUUID();
  saveChallenge(`auth:${flowId}`, options.challenge, config.challengeTtlMs, { userId });
  res.json({ flowId, options });
});

authRouter.post('/login-verify', async (req, res) => {
  const parsed = z
    .object({ flowId: z.string().uuid(), assertionResponse: z.record(z.unknown()) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid login response.' });
    return;
  }
  // Single use: the challenge is deleted here, so a captured response cannot be replayed.
  const entry = consumeChallengeEntry<{ userId?: string }>(`auth:${parsed.data.flowId}`);
  if (!entry) {
    res.status(400).json({ error: 'Challenge expired or already used. Please try logging in again.' });
    return;
  }

  const result = await verifyAssertion(parsed.data.assertionResponse, entry.challenge, {
    expectedUserId: entry.data?.userId,
    req,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const { user, credential, info } = result;

  await prisma.credential.update({
    where: { id: credential.id },
    data: { counter: BigInt(info.newCounter), lastUsedAt: new Date(), backedUp: info.backedUp },
  });
  const { session } = await issueSession(req, res, user, credential.id);
  await logActivity(user.id, 'LOGIN_SUCCESS', 'Successful passkey login.', { deviceLabel: credential.deviceLabel, req });

  res.json({
    verified: true,
    user: toPublicUser(user),
    session: { expiresAt: session.expiresAt.toISOString() },
    verification: {
      credentialId: credential.credentialID,
      deviceLabel: credential.deviceLabel,
      algorithm: credential.algorithm,
      previousCounter: Number(credential.counter),
      newCounter: info.newCounter,
      userVerified: info.userVerified,
      deviceType: info.deviceType,
      backedUp: info.backedUp,
      origin: info.origin,
      rpID: info.rpID,
    },
  });
});

// ---- Step-up re-authentication (FR-6) ----

authRouter.post('/reauth-options', requireAuth, async (req: AuthedRequest, res) => {
  const creds = await prisma.credential.findMany({ where: { userId: req.userId!, revokedAt: null } });
  if (creds.length === 0) {
    res.status(400).json({ error: 'No active passkeys on this account.' });
    return;
  }
  const options = await authenticationOptions(creds);
  saveChallenge(`reauth:${req.sessionId}`, options.challenge, config.challengeTtlMs);
  res.json(options);
});

authRouter.post('/reauth-verify', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ assertionResponse: z.record(z.unknown()) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid response.' });
    return;
  }
  const challenge = consumeChallenge(`reauth:${req.sessionId}`);
  if (!challenge) {
    res.status(400).json({ error: 'Challenge expired. Please try again.' });
    return;
  }
  const result = await verifyAssertion(parsed.data.assertionResponse, challenge, { expectedUserId: req.userId, req });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const now = new Date();
  await prisma.credential.update({
    where: { id: result.credential.id },
    data: { counter: BigInt(result.info.newCounter), lastUsedAt: now },
  });
  await prisma.session.update({ where: { id: req.sessionId! }, data: { lastAuthAt: now } });
  await logActivity(req.userId!, 'STEP_UP', 'Identity re-confirmed with passkey (step-up).', {
    deviceLabel: result.credential.deviceLabel,
    req,
  });
  res.json({ verified: true, freshUntil: new Date(now.getTime() + config.stepUpMaxAgeMs).toISOString() });
});

authRouter.post('/logout', async (req, res) => {
  const token = getToken(req);
  if (token) {
    try {
      const claims = verifySession(token);
      const session = await prisma.session.findUnique({ where: { id: claims.jti } });
      if (session && !session.revokedAt) {
        await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        await logActivity(claims.sub, 'LOGOUT', 'Signed out.', { req });
      }
    } catch {
      // Expired/invalid token: nothing to revoke, just clear the cookie.
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

wrapRouter(authRouter);
