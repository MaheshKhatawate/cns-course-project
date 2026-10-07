import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { consumeChallenge, saveChallenge } from '../challengeStore.js';
import { logActivity } from '../activity.js';
import { recoveryGeneration, signRecoveryToken, verifyRecoveryToken } from '../auth.js';
import { generateRecoveryCode, hashRecoveryCode, verifyRecoveryCode } from '../recovery.js';
import { registrationOptions, verifyRegistration } from '../webauthn.js';
import { issueSession, revokeSessions } from '../sessions.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { wrapRouter } from '../middleware/wrapRouter.js';
import { deviceLabelSchema, norm, toPublicUser } from './auth.js';

export const recoveryRouter = Router();

const usernameSchema = z.string().trim().min(3).max(64);

// Recovery codes are ~79-bit secrets, but guessing is still throttled per IP+username.
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => config.recoveryAttemptsPer15Min,
  key: (req) => `${req.ip}|${String(req.body?.username ?? '').trim().toLowerCase()}`,
  message: 'Too many recovery attempts. Please wait 15 minutes and try again.',
});

// The recovery token is only valid while the verified recovery code is still current.
async function userFromRecoveryToken(token: string, username: string) {
  let claims;
  try {
    claims = verifyRecoveryToken(token);
  } catch {
    return { error: 'Recovery session expired. Please verify your code again.' } as const;
  }
  if (claims.username !== norm(username)) return { error: 'Recovery token does not match this account.' } as const;
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user?.recoveryCodeHash || recoveryGeneration(user.recoveryCodeHash) !== claims.gen) {
    return { error: 'This recovery code has already been used. Please start again.' } as const;
  }
  return { user } as const;
}

// Step 1: verify the recovery code, get a short-lived recovery token.
recoveryRouter.post('/verify', recoveryLimiter, async (req, res) => {
  const parsed = z
    .object({ username: usernameSchema, recoveryCode: z.string().trim().min(1).max(64) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Username and recovery code are required.' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { username: norm(parsed.data.username) } });
  // Generic message to avoid username enumeration.
  if (!user || !user.recoveryCodeHash) {
    res.status(401).json({ error: 'Invalid username or recovery code.' });
    return;
  }
  const ok = await verifyRecoveryCode(parsed.data.recoveryCode, user.recoveryCodeHash);
  if (!ok) {
    await logActivity(user.id, 'LOGIN_FAILED', 'Recovery failed: invalid recovery code.', { req });
    res.status(401).json({ error: 'Invalid username or recovery code.' });
    return;
  }
  await logActivity(user.id, 'RECOVERY_USED', 'Recovery code verified.', { req });
  res.json({
    recoveryToken: signRecoveryToken(user.id, user.username, user.recoveryCodeHash),
    expiresInSeconds: 600,
  });
});

// Step 2: registration options for the replacement credential (auth = recovery token).
recoveryRouter.post('/register-options', async (req, res) => {
  const parsed = z.object({ username: usernameSchema, recoveryToken: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }
  const r = await userFromRecoveryToken(parsed.data.recoveryToken, parsed.data.username);
  if ('error' in r) {
    res.status(401).json({ error: r.error });
    return;
  }
  const activeCreds = await prisma.credential.findMany({ where: { userId: r.user.id, revokedAt: null } });
  const options = await registrationOptions(r.user, activeCreds);
  saveChallenge(`rec:${r.user.id}`, options.challenge, config.challengeTtlMs);
  res.json(options);
});

// Step 3: verify + store the replacement credential, rotate the recovery code
// (old code and token stop working), optionally revoke every other device.
recoveryRouter.post('/register-verify', async (req, res) => {
  const parsed = z
    .object({
      username: usernameSchema,
      recoveryToken: z.string().min(1),
      attResp: z.record(z.unknown()),
      deviceLabel: deviceLabelSchema.optional(),
      revokeOtherDevices: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }
  const r = await userFromRecoveryToken(parsed.data.recoveryToken, parsed.data.username);
  if ('error' in r) {
    res.status(401).json({ error: r.error });
    return;
  }
  const { user } = r;
  const expectedChallenge = consumeChallenge(`rec:${user.id}`);
  if (!expectedChallenge) {
    res.status(400).json({ error: 'Challenge expired. Please restart recovery.' });
    return;
  }
  const cred = await verifyRegistration(parsed.data.attResp, expectedChallenge);
  if (!cred) {
    res.status(400).json({ error: 'Credential verification failed. Please try again.' });
    return;
  }
  if (await prisma.credential.findUnique({ where: { credentialID: cred.credentialID } })) {
    res.status(409).json({ error: 'This authenticator is already registered.' });
    return;
  }

  const deviceLabel = parsed.data.deviceLabel || 'Replacement device';
  const revokeOthers = parsed.data.revokeOtherDevices ?? true;
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await hashRecoveryCode(recoveryCode);
  const now = new Date();

  const { credential, revokedDevices } = await prisma.$transaction(async (tx) => {
    let revokedDevices = 0;
    if (revokeOthers) {
      revokedDevices = (
        await tx.credential.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } })
      ).count;
    }
    const credential = await tx.credential.create({ data: { ...cred, userId: user.id, deviceLabel } });
    await tx.user.update({
      where: { id: user.id },
      data: { recoveryCodeHash, recoveryCreatedAt: now, recoveryLastUsedAt: now },
    });
    return { credential, revokedDevices };
  });
  if (revokeOthers) await revokeSessions({ userId: user.id });

  await logActivity(
    user.id,
    'DEVICE_ADDED',
    `Replacement device registered via recovery: ${deviceLabel}.` +
      (revokeOthers ? ` ${revokedDevices} old device(s) revoked.` : ''),
    { deviceLabel, req },
  );
  await logActivity(user.id, 'RECOVERY_CODE_ROTATED', 'Recovery code rotated after use.', { req });
  await issueSession(req, res, user, credential.id);

  res.json({ verified: true, user: toPublicUser(user), recoveryCode, revokedDevices });
});

wrapRouter(recoveryRouter);
