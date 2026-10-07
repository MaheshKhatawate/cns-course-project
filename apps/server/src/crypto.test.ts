// End-to-end cryptographic checks without a database: a software ES256
// authenticator produces real WebAuthn responses and SimpleWebAuthn verifies them.
import { describe, expect, it } from 'vitest';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { SoftAuthenticator } from './security/softAuthenticator.js';
import { describePublicKey } from './webauthn.js';

const ORIGIN = 'http://localhost:3000';
const RP_ID = 'localhost';

async function registered() {
  const auth = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
  const opts = await generateRegistrationOptions({ rpName: 'test', rpID: RP_ID, userName: 'alice', attestationType: 'none' });
  const att = auth.create(opts);
  const reg = await verifyRegistrationResponse({ response: att, expectedChallenge: opts.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID });
  return { auth, reg, credential: reg.registrationInfo!.credential };
}

async function verifyLogin(auth: SoftAuthenticator, credential: Awaited<ReturnType<typeof registered>>['credential'], o = {}) {
  const opts = await generateAuthenticationOptions({ rpID: RP_ID });
  const response = auth.get(opts, o);
  return verifyAuthenticationResponse({ response, expectedChallenge: opts.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, credential });
}

describe('WebAuthn cryptography (ES256)', () => {
  it('registers a key pair: server receives only the public key', async () => {
    const { reg } = await registered();
    expect(reg.verified).toBe(true);
    const info = describePublicKey(Buffer.from(reg.registrationInfo!.credential.publicKey).toString('base64'), -7);
    expect(info.algorithmName).toMatch(/ES256/);
    expect(info.pem).toMatch(/BEGIN PUBLIC KEY/);
    expect(info.pem).not.toMatch(/PRIVATE/);
  });

  it('verifies a signed challenge and advances the counter', async () => {
    const { auth, credential } = await registered();
    const v = await verifyLogin(auth, credential);
    expect(v.verified).toBe(true);
    expect(v.authenticationInfo.newCounter).toBe(1);
    expect(v.authenticationInfo.userVerified).toBe(true);
  });

  it('rejects an assertion from another origin (phishing)', async () => {
    const { auth, credential } = await registered();
    await expect(verifyLogin(auth, credential, { origin: 'https://evil.example' })).rejects.toThrow(/origin/i);
  });

  it('rejects an assertion scoped to another RP ID', async () => {
    const { auth, credential } = await registered();
    await expect(verifyLogin(auth, credential, { rpId: 'evil.example' })).rejects.toThrow(/rp ?id/i);
  });

  it('rejects a counter that does not increase (cloned key)', async () => {
    const { auth, credential } = await registered();
    await expect(verifyLogin(auth, { ...credential, counter: 5 }, { counter: 3 })).rejects.toThrow(/counter/i);
  });

  it('rejects a tampered signature', async () => {
    const { auth, credential } = await registered();
    const opts = await generateAuthenticationOptions({ rpID: RP_ID });
    const response = auth.get(opts);
    const sig = Buffer.from(response.response.signature, 'base64url');
    sig[10] ^= 0x01;
    response.response.signature = sig.toString('base64url');
    const v = await verifyAuthenticationResponse({ response, expectedChallenge: opts.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, credential }).catch(() => ({ verified: false }));
    expect(v.verified).toBe(false);
  });

  it('rejects a response to a different challenge', async () => {
    const { auth, credential } = await registered();
    const opts = await generateAuthenticationOptions({ rpID: RP_ID });
    const response = auth.get(opts);
    await expect(
      verifyAuthenticationResponse({ response, expectedChallenge: 'some-other-challenge', expectedOrigin: ORIGIN, expectedRPID: RP_ID, credential }),
    ).rejects.toThrow(/challenge/i);
  });

  it('meets the NFR: key generation and verification each take < 1 s', async () => {
    const t0 = performance.now();
    const { auth, credential } = await registered();
    const t1 = performance.now();
    await verifyLogin(auth, credential);
    const t2 = performance.now();
    expect(t1 - t0).toBeLessThan(1000);
    expect(t2 - t1).toBeLessThan(1000);
  });
});
