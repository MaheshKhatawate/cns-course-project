import { Router } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { consumeChallenge, saveChallenge } from '../challengeStore.js';
import { signSession } from '../auth.js';
import { logActivity } from '../activity.js';
import { generateRecoveryCode, hashRecoveryCode } from '../recovery.js';
import { wrapRouter } from '../middleware/wrapRouter.js';

export const authRouter = Router();

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Use 3–64 letters, numbers, dots, underscores or dashes.');

const optionsSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(64).optional(),
  deviceLabel: z.string().trim().min(1).max(64).optional(),
});

function norm(name: string) {
  return name.trim().toLowerCase();
}

function toPublicUser(u: { id: string; username: string; displayName: string; createdAt: Date }) {
  return { id: u.id, username: u.username, displayName: u.displayName, createdAt: u.createdAt.toISOString() };
}

// ---- Registration ----

authRouter.post('/register-options', async (req, res) => {
  const parsed = optionsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
    return;
  }
  const username = norm(parsed.data.username);
  const displayName = parsed.data.displayName?.trim() || parsed.data.username.trim();

  let user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    user = await prisma.user.create({ data: { username, displayName } });
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
    excludeCredentials: activeCreds.map((c) => ({
      id: c.credentialID,
      transports: (c.transports as ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'cable')[]) ?? undefined,
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    supportedAlgorithmIDs: [-7, -257],
  });

  saveChallenge(`reg:${user.id}`, options.challenge, config.challengeTtlMs);
  res.json(options);
});

authRouter.post('/register-verify', async (req, res) => {
  const parsed = z
    .object({
      username: usernameSchema,
      attResp: z.record(z.unknown()),
      deviceLabel: z.string().trim().min(1).max(64).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid registration response.' });
    return;
  }
  const username = norm(parsed.data.username);
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    res.status(404).json({ error: 'Account not found. Please start registration again.' });
    return;
  }

  const expectedChallenge = consumeChallenge(`reg:${user.id}`);
  if (!expectedChallenge) {
    await logActivity(user.id, 'LOGIN_FAILED', 'Registration failed: expired challenge.', { req });
    res.status(400).json({ error: 'Challenge expired. Please start registration again.' });
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
    await logActivity(user.id, 'LOGIN_FAILED', 'Registration failed: invalid response.', { req });
    res.status(400).json({ error: 'Registration verification failed. Please try again.' });
    return;
  }

  if (!verification.verified || !verification.registrationInfo) {
    await logActivity(user.id, 'LOGIN_FAILED', 'Registration failed: not verified.', { req });
    res.status(400).json({ error: 'Registration verification failed. Please try again.' });
    return;
  }

  const { credential } = verification.registrationInfo;
  const credentialID = credential.id;
  const publicKeyB64 = Buffer.from(credential.publicKey).toString('base64');

  const existing = await prisma.credential.findUnique({ where: { credentialID } });
  if (existing) {
    res.status(409).json({ error: 'This authenticator is already registered.' });
    return;
  }

  const isFirstCredential =
    (await prisma.credential.count({ where: { userId: user.id, revokedAt: null } })) === 0;

  await prisma.credential.create({
    data: {
      userId: user.id,
      credentialID,
      publicKey: publicKeyB64,
      counter: BigInt(credential.counter ?? 0),
      transports: [],
      deviceLabel: parsed.data.deviceLabel?.trim() || 'My device',
    },
  });

  // First credential for the account: create the one-time recovery code.
  let recoveryCode: string | undefined;
  if (isFirstCredential) {
    recoveryCode = generateRecoveryCode();
    await prisma.user.update({
      where: { id: user.id },
      data: { recoveryCodeHash: await hashRecoveryCode(recoveryCode), recoveryCreatedAt: new Date() },
    });
  }

  await logActivity(
    user.id,
    'REGISTRATION',
    isFirstCredential ? 'Account registered with first passkey.' : 'New passkey registered.',
    { deviceLabel: parsed.data.deviceLabel, req },
  );

  res.json({ verified: true, user: toPublicUser(user), ...(recoveryCode ? { recoveryCode } : {}) });
});

// ---- Login ----

authRouter.post('/login-options', async (req, res) => {
  const parsed = z.object({ username: usernameSchema }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid username.' });
    return;
  }
  const username = norm(parsed.data.username);
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    res.status(404).json({ error: 'Account not found. Please register first.' });
    return;
  }
  const creds = await prisma.credential.findMany({ where: { userId: user.id, revokedAt: null } });
  if (creds.length === 0) {
    res.status(400).json({ error: 'No active passkeys. Use recovery to register a new one.' });
    return;
  }

  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    timeout: 60000,
    userVerification: 'preferred',
    allowCredentials: creds.map((c) => ({
      id: c.credentialID,
      transports: (c.transports as ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'cable')[]) ?? undefined,
    })),
  });

  saveChallenge(`auth:${user.id}`, options.challenge, config.challengeTtlMs);
  res.json(options);
});

authRouter.post('/login-verify', async (req, res) => {
  const parsed = z
    .object({ username: usernameSchema, assertionResponse: z.record(z.unknown()) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid login response.' });
    return;
  }
  const username = norm(parsed.data.username);
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }

  const expectedChallenge = consumeChallenge(`auth:${user.id}`);
  if (!expectedChallenge) {
    await logActivity(user.id, 'LOGIN_FAILED', 'Login failed: expired challenge.', { req });
    res.status(400).json({ error: 'Challenge expired. Please try logging in again.' });
    return;
  }

  const body = parsed.data.assertionResponse as { id?: string };
  if (typeof body.id !== 'string') {
    res.status(400).json({ error: 'Invalid login response.' });
    return;
  }
  const credential = await prisma.credential.findUnique({ where: { credentialID: body.id } });
  if (!credential || credential.userId !== user.id || credential.revokedAt) {
    await logActivity(user.id, 'LOGIN_FAILED', 'Login failed: unknown or revoked credential.', { req });
    res.status(401).json({ error: 'This passkey is not valid for this account (it may have been revoked).' });
    return;
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: parsed.data.assertionResponse as never,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      credential: {
        id: credential.credentialID,
        publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64')),
        counter: Number(credential.counter),
        transports: (credential.transports as never) ?? undefined,
      },
    });
  } catch {
    await logActivity(user.id, 'LOGIN_FAILED', 'Login failed: invalid assertion.', {
      deviceLabel: credential.deviceLabel,
      req,
    });
    res.status(401).json({ error: 'Login verification failed. Please try again.' });
    return;
  }

  if (!verification.verified || !verification.authenticationInfo) {
    await logActivity(user.id, 'LOGIN_FAILED', 'Login failed: assertion not verified.', {
      deviceLabel: credential.deviceLabel,
      req,
    });
    res.status(401).json({ error: 'Login verification failed. Please try again.' });
    return;
  }

  // Replay/clone protection: the authenticator counter must move forward.
  const newCounter = BigInt(verification.authenticationInfo.newCounter);
  if (credential.counter > BigInt(0) && newCounter <= credential.counter) {
    await logActivity(user.id, 'LOGIN_FAILED', 'Login rejected: credential counter did not increase.', {
      deviceLabel: credential.deviceLabel,
      req,
    });
    res.status(401).json({ error: 'Login rejected: possible cloned authenticator.' });
    return;
  }

  await prisma.credential.update({
    where: { id: credential.id },
    data: { counter: newCounter, lastUsedAt: new Date() },
  });

  const token = signSession(user.id, user.username);
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 60 * 60 * 1000, // matches default 1h JWT expiry
    path: '/',
  });

  await logActivity(user.id, 'LOGIN_SUCCESS', 'Successful login.', {
    deviceLabel: credential.deviceLabel,
    req,
  });

  res.json({ verified: true, user: toPublicUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true });
});

wrapRouter(authRouter);
