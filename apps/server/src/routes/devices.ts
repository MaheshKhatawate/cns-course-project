import { Router } from 'express';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { consumeChallenge, saveChallenge } from '../challengeStore.js';
import { logActivity } from '../activity.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { wrapRouter } from '../middleware/wrapRouter.js';

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

devicesRouter.get('/', async (req: AuthedRequest, res) => {
  const creds = await prisma.credential.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    devices: creds.map((c) => ({
      id: c.id,
      deviceLabel: c.deviceLabel,
      createdAt: c.createdAt.toISOString(),
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
      revokedAt: c.revokedAt?.toISOString() ?? null,
    })),
  });
});

// Start adding a device: registration options for the already-authenticated user.
devicesRouter.post('/options', async (req: AuthedRequest, res) => {
  const label = z
    .object({ deviceLabel: z.string().trim().min(1).max(64).optional() })
    .safeParse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(401).json({ error: 'Account not found.' });
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
  saveChallenge(`add:${user.id}`, options.challenge, config.challengeTtlMs);
  void label;
  res.json(options);
});

devicesRouter.post('/verify', async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      attResp: z.record(z.unknown()),
      deviceLabel: z.string().trim().min(1).max(64).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid registration response.' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(401).json({ error: 'Account not found.' });
    return;
  }
  const expectedChallenge = consumeChallenge(`add:${user.id}`);
  if (!expectedChallenge) {
    res.status(400).json({ error: 'Challenge expired. Please try adding the device again.' });
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
    res.status(400).json({ error: 'Device verification failed. Please try again.' });
    return;
  }
  if (!verification.verified || !verification.registrationInfo) {
    res.status(400).json({ error: 'Device verification failed. Please try again.' });
    return;
  }
  const { credential } = verification.registrationInfo;
  const exists = await prisma.credential.findUnique({ where: { credentialID: credential.id } });
  if (exists) {
    res.status(409).json({ error: 'This authenticator is already registered.' });
    return;
  }
  const deviceLabel = parsed.data.deviceLabel?.trim() || 'My device';
  const created = await prisma.credential.create({
    data: {
      userId: user.id,
      credentialID: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: BigInt(credential.counter ?? 0),
      transports: [],
      deviceLabel,
    },
  });
  await logActivity(user.id, 'DEVICE_ADDED', `New device registered: ${deviceLabel}.`, {
    deviceLabel,
    req,
  });
  res.json({
    verified: true,
    device: { id: created.id, deviceLabel: created.deviceLabel },
  });
});

devicesRouter.post('/:id/revoke', async (req: AuthedRequest, res) => {
  const cred = await prisma.credential.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!cred) {
    res.status(404).json({ error: 'Device not found.' });
    return;
  }
  if (cred.revokedAt) {
    res.status(400).json({ error: 'This device has already been revoked.' });
    return;
  }
  const remaining = await prisma.credential.count({
    where: { userId: req.userId!, revokedAt: null, id: { not: cred.id } },
  });
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const hasRecovery = Boolean(user?.recoveryCodeHash);
  if (remaining === 0 && !hasRecovery) {
    res.status(400).json({
      error:
        'This is your last active device and no recovery code is set. Register a replacement first to avoid locking yourself out.',
    });
    return;
  }
  await prisma.credential.update({
    where: { id: cred.id },
    data: { revokedAt: new Date() },
  });
  await logActivity(req.userId!, 'DEVICE_REVOKED', `Device revoked: ${cred.deviceLabel}.`, {
    deviceLabel: cred.deviceLabel,
    req,
  });
  res.json({
    ok: true,
    warning:
      remaining === 0
        ? 'This was your last active device. Keep your recovery code safe — you will need it to register a new one.'
        : null,
  });
});

wrapRouter(devicesRouter);
