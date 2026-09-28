import { Router } from 'express';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { consumeChallenge, saveChallenge } from '../challengeStore.js';
import { logActivity } from '../activity.js';
import { signRecoveryToken, verifyRecoveryToken } from '../auth.js';
import { verifyRecoveryCode } from '../recovery.js';
import { wrapRouter } from '../middleware/wrapRouter.js';

export const recoveryRouter = Router();

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64);

// Step 1: verify the recovery code, get a short-lived recovery token.
recoveryRouter.post('/verify', async (req, res) => {
  const parsed = z
    .object({ username: usernameSchema, recoveryCode: z.string().trim().min(1).max(64) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Username and recovery code are required.' });
    return;
  }
  const username = parsed.data.username.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username } });
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
  await prisma.user.update({
    where: { id: user.id },
    data: { recoveryLastUsedAt: new Date() },
  });
  await logActivity(user.id, 'RECOVERY_USED', 'Recovery code verified.', { req });
  res.json({ recoveryToken: signRecoveryToken(user.id, user.username) });
});

// Step 2: registration options for the replacement credential (auth = recovery token).
recoveryRouter.post('/register-options', async (req, res) => {
  const parsed = z
    .object({ username: usernameSchema, recoveryToken: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }
  let claims;
  try {
    claims = verifyRecoveryToken(parsed.data.recoveryToken);
  } catch {
    res.status(401).json({ error: 'Recovery session expired. Please verify your code again.' });
    return;
  }
  const username = parsed.data.username.trim().toLowerCase();
  if (claims.username !== username) {
    res.status(401).json({ error: 'Recovery token does not match this account.' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  const activeCreds = await prisma.credential.findMany({
    where: { userId: user.id, revokedAt: null },
  });
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: user.username,
    timeout: 60000,
    attestationType: 'none',
    excludeCredentials: activeCreds.map((c) => ({ id: c.credentialID })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    supportedAlgorithmIDs: [-7, -257],
  });
  saveChallenge(`rec:${user.id}`, options.challenge, config.challengeTtlMs);
  res.json(options);
});

// Step 3: verify + store the replacement credential.
recoveryRouter.post('/register-verify', async (req, res) => {
  const parsed = z
    .object({
      username: usernameSchema,
      recoveryToken: z.string().min(1),
      attResp: z.record(z.unknown()),
      deviceLabel: z.string().trim().min(1).max(64).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }
  let claims;
  try {
    claims = verifyRecoveryToken(parsed.data.recoveryToken);
  } catch {
    res.status(401).json({ error: 'Recovery session expired. Please verify your code again.' });
    return;
  }
  const username = parsed.data.username.trim().toLowerCase();
  if (claims.username !== username) {
    res.status(401).json({ error: 'Recovery token does not match this account.' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  const expectedChallenge = consumeChallenge(`rec:${user.id}`);
  if (!expectedChallenge) {
    res.status(400).json({ error: 'Challenge expired. Please restart recovery.' });
    return;
  }
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: parsed.data.attResp as never,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
    });
  } catch {
    res.status(400).json({ error: 'Credential verification failed. Please try again.' });
    return;
  }
  if (!verification.verified || !verification.registrationInfo) {
    res.status(400).json({ error: 'Credential verification failed. Please try again.' });
    return;
  }
  const { credential } = verification.registrationInfo;
  const exists = await prisma.credential.findUnique({ where: { credentialID: credential.id } });
  if (exists) {
    res.status(409).json({ error: 'This authenticator is already registered.' });
    return;
  }
  const deviceLabel = parsed.data.deviceLabel?.trim() || 'Replacement device';
  await prisma.credential.create({
    data: {
      userId: user.id,
      credentialID: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: BigInt(credential.counter ?? 0),
      transports: [],
      deviceLabel,
    },
  });
  await logActivity(user.id, 'DEVICE_ADDED', `Replacement device registered via recovery: ${deviceLabel}.`, {
    deviceLabel,
    req,
  });
  res.json({ verified: true });
});

wrapRouter(recoveryRouter);
