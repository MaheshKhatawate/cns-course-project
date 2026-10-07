import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { consumeChallenge, saveChallenge } from '../challengeStore.js';
import { logActivity } from '../activity.js';
import { describePublicKey, registrationOptions, verifyRegistration } from '../webauthn.js';
import { revokeSessions } from '../sessions.js';
import { requireAuth, requireFreshAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { wrapRouter } from '../middleware/wrapRouter.js';
import { deviceLabelSchema } from './auth.js';
import { activeLinkCode, cancelLinkCode, createLinkCode } from '../linkCodes.js';

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

// FR-4: list all of the user's passkeys (one per device), with public-key details.
devicesRouter.get('/', async (req: AuthedRequest, res) => {
  const [creds, current] = await Promise.all([
    prisma.credential.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'desc' } }),
    prisma.session.findUnique({ where: { id: req.sessionId! } }),
  ]);
  res.json({
    devices: creds.map((c) => ({
      id: c.id,
      deviceLabel: c.deviceLabel,
      createdAt: c.createdAt.toISOString(),
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
      revokedAt: c.revokedAt?.toISOString() ?? null,
      transports: c.transports,
      deviceType: c.deviceType,
      backedUp: c.backedUp,
      aaguid: c.aaguid,
      counter: Number(c.counter),
      isCurrent: current?.credentialId === c.id,
      publicKey: describePublicKey(c.publicKey, c.algorithm),
    })),
  });
});

// Start adding a device: registration options for the already-authenticated user.
devicesRouter.post('/options', requireFreshAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(401).json({ error: 'Account not found.' });
    return;
  }
  const activeCreds = await prisma.credential.findMany({ where: { userId: user.id, revokedAt: null } });
  const options = await registrationOptions(user, activeCreds);
  saveChallenge(`add:${user.id}`, options.challenge, config.challengeTtlMs);
  res.json(options);
});

devicesRouter.post('/verify', async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ attResp: z.record(z.unknown()), deviceLabel: deviceLabelSchema.optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid registration response.' });
    return;
  }
  const expectedChallenge = consumeChallenge(`add:${req.userId}`);
  if (!expectedChallenge) {
    res.status(400).json({ error: 'Challenge expired. Please try adding the device again.' });
    return;
  }
  const cred = await verifyRegistration(parsed.data.attResp, expectedChallenge);
  if (!cred) {
    res.status(400).json({ error: 'Device verification failed. Please try again.' });
    return;
  }
  if (await prisma.credential.findUnique({ where: { credentialID: cred.credentialID } })) {
    res.status(409).json({ error: 'This authenticator is already registered.' });
    return;
  }
  const deviceLabel = parsed.data.deviceLabel || 'My device';
  const created = await prisma.credential.create({ data: { ...cred, userId: req.userId!, deviceLabel } });
  await logActivity(req.userId!, 'DEVICE_ADDED', `New device registered: ${deviceLabel}.`, { deviceLabel, req });
  res.json({ verified: true, device: { id: created.id, deviceLabel: created.deviceLabel } });
});

// FR-4: one-time code that lets a new device/browser enrol its own passkey.
devicesRouter.post('/link-code', requireFreshAuth, async (req: AuthedRequest, res) => {
  const { code, expiresAt } = createLinkCode(req.userId!);
  await logActivity(req.userId!, 'DEVICE_LINK_CODE', 'One-time device link code generated.', { req });
  res.json({ code, expiresAt: expiresAt.toISOString() });
});

devicesRouter.get('/link-code', async (req: AuthedRequest, res) => {
  const active = activeLinkCode(req.userId!);
  res.json({ active: Boolean(active), expiresAt: active?.expiresAt.toISOString() ?? null });
});

devicesRouter.delete('/link-code', async (req: AuthedRequest, res) => {
  cancelLinkCode(req.userId!);
  res.json({ ok: true });
});

devicesRouter.patch('/:id', async (req: AuthedRequest, res) => {
  const parsed = z.object({ deviceLabel: deviceLabelSchema }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Device name must be 1–64 characters.' });
    return;
  }
  const cred = await prisma.credential.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!cred) {
    res.status(404).json({ error: 'Device not found.' });
    return;
  }
  await prisma.credential.update({ where: { id: cred.id }, data: { deviceLabel: parsed.data.deviceLabel } });
  res.json({ ok: true });
});

// FR-5: revoke a lost or compromised key. The credential row is kept for audit, its
// public key is never accepted again, and every session it created is ended.
devicesRouter.post('/:id/revoke', requireFreshAuth, async (req: AuthedRequest, res) => {
  const cred = await prisma.credential.findFirst({ where: { id: req.params.id, userId: req.userId! } });
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
  if (remaining === 0 && !user?.recoveryCodeHash) {
    res.status(400).json({
      error:
        'This is your last active device and no recovery code is set. Register a replacement first to avoid locking yourself out.',
    });
    return;
  }
  await prisma.credential.update({ where: { id: cred.id }, data: { revokedAt: new Date() } });
  const endedSessions = await revokeSessions({ credentialId: cred.id });
  const current = await prisma.session.findUnique({ where: { id: req.sessionId! } });
  await logActivity(req.userId!, 'DEVICE_REVOKED', `Device revoked: ${cred.deviceLabel}.`, {
    deviceLabel: cred.deviceLabel,
    req,
  });
  res.json({
    ok: true,
    endedSessions,
    signedOut: Boolean(current?.revokedAt),
    warning:
      remaining === 0
        ? 'This was your last active device. Keep your recovery code safe — you will need it to register a new one.'
        : null,
  });
});

wrapRouter(devicesRouter);
