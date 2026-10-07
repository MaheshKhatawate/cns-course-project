import crypto from 'node:crypto';
import type { Request } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { cose, decodeCredentialPublicKey, isoBase64URL } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';
import type { Credential, User } from '@prisma/client';
import { config } from './config.js';
import { prisma } from './db.js';
import { logActivity } from './activity.js';

// COSE algorithms we accept: ES256 (ECDSA P-256 / SHA-256), EdDSA (Ed25519), RS256.
export const SUPPORTED_ALGORITHMS = [-7, -8, -257];
const ALG_NAMES: Record<number, string> = { [-7]: 'ES256 (ECDSA P-256, SHA-256)', [-8]: 'EdDSA (Ed25519)', [-257]: 'RS256 (RSASSA-PKCS1-v1_5, SHA-256)' };
const TRANSPORTS: AuthenticatorTransportFuture[] = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'];

export function newWebAuthnUserId(): string {
  return isoBase64URL.fromBuffer(crypto.randomBytes(32));
}

function toTransports(list: string[] | undefined): AuthenticatorTransportFuture[] {
  return (list ?? []).filter((t): t is AuthenticatorTransportFuture => TRANSPORTS.includes(t as never));
}

export function registrationOptions(user: { username: string; displayName: string; webauthnUserId: string }, existing: Credential[] = []) {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: user.username,
    userDisplayName: user.displayName,
    userID: isoBase64URL.toBuffer(user.webauthnUserId),
    timeout: 60000,
    attestationType: 'none',
    // Prevents registering the same authenticator twice for one account.
    excludeCredentials: existing.map((c) => ({ id: c.credentialID, transports: toTransports(c.transports) })),
    // Discoverable credentials enable usernameless login; user verification = biometric/PIN.
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
  });
}

export function authenticationOptions(allowed: Credential[] = []) {
  return generateAuthenticationOptions({
    rpID: config.rpID,
    timeout: 60000,
    userVerification: 'preferred',
    allowCredentials: allowed.map((c) => ({ id: c.credentialID, transports: toTransports(c.transports) })),
  });
}

export type NewCredential = Pick<
  Credential,
  'credentialID' | 'publicKey' | 'algorithm' | 'counter' | 'transports' | 'aaguid' | 'deviceType' | 'backedUp'
>;

// Verifies an attestation (registration) response: challenge, origin, RP ID hash,
// user presence and the self-signed public key. Returns what we persist — never a private key.
export async function verifyRegistration(attResp: unknown, expectedChallenge: string): Promise<NewCredential | null> {
  try {
    const response = attResp as RegistrationResponseJSON;
    const v = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
    });
    if (!v.verified || !v.registrationInfo) return null;
    const { credential, aaguid, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
    const coseKey = decodeCredentialPublicKey(credential.publicKey);
    return {
      credentialID: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      algorithm: coseKey.get(cose.COSEKEYS.alg) ?? null,
      counter: BigInt(credential.counter ?? 0),
      transports: toTransports(response.response?.transports),
      aaguid,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    };
  } catch {
    return null;
  }
}

type AssertionResult =
  | {
      ok: true;
      user: User;
      credential: Credential;
      info: { newCounter: number; userVerified: boolean; deviceType: string; backedUp: boolean; origin: string; rpID: string };
    }
  | { ok: false; status: number; error: string };

// Verifies a signed challenge (authentication assertion) against the stored public key.
// Shared by login and step-up re-authentication.
export async function verifyAssertion(
  assertion: unknown,
  expectedChallenge: string,
  opts: { expectedUserId?: string; req: Request },
): Promise<AssertionResult> {
  const body = assertion as AuthenticationResponseJSON;
  if (!body || typeof body.id !== 'string' || typeof body.response !== 'object') {
    return { ok: false, status: 400, error: 'Invalid login response.' };
  }
  const credential = await prisma.credential.findUnique({ where: { credentialID: body.id }, include: { user: true } });
  if (!credential) {
    return { ok: false, status: 401, error: 'This passkey is not registered with this site.' };
  }
  const { user } = credential;
  if (opts.expectedUserId && credential.userId !== opts.expectedUserId) {
    await logActivity(opts.expectedUserId, 'LOGIN_FAILED', "Login failed: passkey belongs to a different account.", { req: opts.req });
    return { ok: false, status: 401, error: 'This passkey is not valid for this account.' };
  }
  if (credential.revokedAt) {
    await logActivity(user.id, 'LOGIN_FAILED', 'Login failed: revoked passkey used.', { deviceLabel: credential.deviceLabel, req: opts.req });
    return { ok: false, status: 401, error: 'This passkey is not valid for this account (it has been revoked).' };
  }
  // For discoverable credentials the authenticator returns the user handle; it must match.
  const userHandle = body.response.userHandle;
  if (userHandle && userHandle !== user.webauthnUserId) {
    await logActivity(user.id, 'LOGIN_FAILED', 'Login failed: user handle mismatch.', { deviceLabel: credential.deviceLabel, req: opts.req });
    return { ok: false, status: 401, error: 'Login verification failed. Please try again.' };
  }

  try {
    const v = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      credential: {
        id: credential.credentialID,
        publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64')),
        counter: Number(credential.counter),
        transports: toTransports(credential.transports),
      },
    });
    if (!v.verified) throw new Error('not verified');
    const a = v.authenticationInfo;
    return {
      ok: true,
      user,
      credential,
      info: {
        newCounter: a.newCounter,
        userVerified: a.userVerified,
        deviceType: a.credentialDeviceType,
        backedUp: a.credentialBackedUp,
        origin: a.origin,
        rpID: a.rpID,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    // Signature counter did not increase: the private key may have been cloned.
    if (/counter/i.test(message)) {
      await logActivity(user.id, 'LOGIN_FAILED', 'Login rejected: signature counter did not increase (possible cloned authenticator).', {
        deviceLabel: credential.deviceLabel,
        req: opts.req,
      });
      return { ok: false, status: 401, error: 'Login rejected: possible cloned authenticator.' };
    }
    let reason = 'invalid signature or challenge';
    if (/origin/i.test(message)) reason = 'unexpected origin (possible phishing site)';
    else if (/rp ?id/i.test(message)) reason = 'RP ID hash mismatch (credential used for another site)';
    else if (/challenge/i.test(message)) reason = 'challenge mismatch';
    else if (/signature/i.test(message)) reason = 'signature verification failed';
    await logActivity(user.id, 'LOGIN_FAILED', `Login failed: ${reason}.`, { deviceLabel: credential.deviceLabel, req: opts.req });
    return { ok: false, status: 401, error: 'Login verification failed. Please try again.' };
  }
}

// Human-readable view of a stored COSE public key (for the device page / inspector).
export function describePublicKey(publicKeyB64: string, algorithm: number | null) {
  const bytes = Buffer.from(publicKeyB64, 'base64');
  const fingerprint = crypto.createHash('sha256').update(bytes).digest('hex');
  let pem: string | null = null;
  try {
    const key = decodeCredentialPublicKey(new Uint8Array(bytes));
    const kty = key.get(cose.COSEKEYS.kty);
    let jwk: crypto.JsonWebKey | null = null;
    if (kty === cose.COSEKTY.EC2) {
      const k = key as cose.COSEPublicKeyEC2;
      const crv = { 1: 'P-256', 2: 'P-384', 3: 'P-521' }[k.get(cose.COSEKEYS.crv) ?? 0];
      jwk = { kty: 'EC', crv, x: b64u(k.get(cose.COSEKEYS.x)), y: b64u(k.get(cose.COSEKEYS.y)) };
    } else if (kty === cose.COSEKTY.OKP) {
      jwk = { kty: 'OKP', crv: 'Ed25519', x: b64u((key as cose.COSEPublicKeyOKP).get(cose.COSEKEYS.x)) };
    } else if (kty === cose.COSEKTY.RSA) {
      const k = key as cose.COSEPublicKeyRSA;
      jwk = { kty: 'RSA', n: b64u(k.get(cose.COSEKEYS.n)), e: b64u(k.get(cose.COSEKEYS.e)) };
    }
    if (jwk) pem = crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' }).toString();
  } catch {
    pem = null;
  }
  return {
    algorithm: algorithm ?? null,
    algorithmName: algorithm != null ? (ALG_NAMES[algorithm] ?? `COSE alg ${algorithm}`) : 'Unknown',
    fingerprint: fingerprint.match(/.{2}/g)!.slice(0, 16).join(':'),
    pem,
  };
}

function b64u(bytes: Uint8Array | undefined): string | undefined {
  return bytes ? Buffer.from(bytes).toString('base64url') : undefined;
}
