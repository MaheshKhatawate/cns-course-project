import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { consumeChallengeEntry, saveChallenge } from '../challengeStore.js';
import { logActivity } from '../activity.js';
import { checkLinkCode, consumeLinkCode } from '../linkCodes.js';
import { registrationOptions, verifyRegistration } from '../webauthn.js';
import { issueSession } from '../sessions.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { wrapRouter } from '../middleware/wrapRouter.js';
import { deviceLabelSchema, norm, toPublicUser, usernameSchema } from './auth.js';

// The NEW device uses these endpoints: it proves the user approved it (one-time
// code from a signed-in device), then creates its own key pair.
export const linkRouter = Router();

const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => 10,
  key: (req) => `${req.ip}|${String(req.body?.username ?? '').trim().toLowerCase()}`,
  message: 'Too many attempts. Please wait a few minutes and generate a new code.',
});

const INVALID = 'Invalid username or link code (codes expire after 10 minutes).';

linkRouter.post('/options', linkLimiter, async (req, res) => {
  const parsed = z.object({ username: usernameSchema, code: z.string().trim().min(4).max(20) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Username and link code are required.' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { username: norm(parsed.data.username) } });
  const codeId = user ? checkLinkCode(user.id, parsed.data.code) : null;
  if (!user || !codeId) {
    if (user) await logActivity(user.id, 'LOGIN_FAILED', 'Device linking failed: wrong or expired code.', { req });
    res.status(401).json({ error: INVALID });
    return;
  }
  const activeCreds = await prisma.credential.findMany({ where: { userId: user.id, revokedAt: null } });
  const options = await registrationOptions(user, activeCreds);
  saveChallenge(`link:${user.id}`, options.challenge, config.challengeTtlMs, { codeId });
  res.json(options);
});

linkRouter.post('/verify', linkLimiter, async (req, res) => {
  const parsed = z
    .object({ username: usernameSchema, attResp: z.record(z.unknown()), deviceLabel: deviceLabelSchema.optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { username: norm(parsed.data.username) } });
  const entry = user ? consumeChallengeEntry<{ codeId: string }>(`link:${user.id}`) : null;
  if (!user || !entry?.data) {
    res.status(400).json({ error: 'Linking expired. Please enter the code again.' });
    return;
  }
  const cred = await verifyRegistration(parsed.data.attResp, entry.challenge);
  if (!cred) {
    res.status(400).json({ error: 'Passkey verification failed. Please try again.' });
    return;
  }
  if (await prisma.credential.findUnique({ where: { credentialID: cred.credentialID } })) {
    res.status(409).json({ error: 'This authenticator is already registered.' });
    return;
  }
  // The code is single-use: it is deleted only now, after a valid new key was produced.
  if (!consumeLinkCode(user.id, entry.data.codeId)) {
    res.status(401).json({ error: 'This link code has expired or was already used.' });
    return;
  }
  const deviceLabel = parsed.data.deviceLabel || 'Linked device';
  const credential = await prisma.credential.create({ data: { ...cred, userId: user.id, deviceLabel } });
  await logActivity(user.id, 'DEVICE_ADDED', `New device linked with a one-time code: ${deviceLabel}.`, { deviceLabel, req });
  await issueSession(req, res, user, credential.id);
  res.json({ verified: true, user: toPublicUser(user), device: { id: credential.id, deviceLabel } });
});

wrapRouter(linkRouter);
