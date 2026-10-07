// A software FIDO2 authenticator (ES256 / P-256) used by the tests, the benchmark
// and the attack simulator. It produces byte-for-byte standard WebAuthn responses
// (CBOR attestation object, authenticator data, DER ECDSA signature), so the
// server verifies them exactly like responses from Touch ID, Windows Hello or a
// YubiKey. It also lets us misbehave on purpose (wrong origin, cloned key, ...).
import crypto from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';

interface StoredKey {
  id: string; // base64url credential id
  privateKey: crypto.KeyObject; // never leaves this object
  rpId: string;
  userHandle: string;
  counter: number;
}

const FLAG_UP = 0x01; // user present
const FLAG_UV = 0x04; // user verified (biometric / PIN)
const FLAG_AT = 0x40; // attested credential data included

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => crypto.createHash('sha256').update(b).digest();

function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

export interface CeremonyOverrides {
  origin?: string; // what the browser would put in clientDataJSON
  rpId?: string; // which RP ID the authenticator scopes the key to
}

export class SoftAuthenticator {
  private keys = new Map<string, StoredKey>();

  constructor(private defaults: { origin: string; rpId: string }) {}

  get credentialIds() {
    return [...this.keys.keys()];
  }

  // navigator.credentials.create()
  create(options: PublicKeyCredentialCreationOptionsJSON, o: CeremonyOverrides = {}): RegistrationResponseJSON {
    const rpId = o.rpId ?? options.rp.id ?? this.defaults.rpId;
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credId = crypto.randomBytes(32);
    const id = b64u(credId);

    // COSE_Key: {kty: EC2, alg: ES256, crv: P-256, x, y}
    const coseKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(credId.length);
    const authData = Buffer.concat([
      sha256(rpId),
      Buffer.from([FLAG_UP | FLAG_UV | FLAG_AT]),
      u32(0),
      Buffer.alloc(16), // AAGUID (zeros: no attestation)
      credIdLen,
      credId,
      Buffer.from(coseKey),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, string>>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, string>()],
        ['authData', new Uint8Array(authData)],
      ]),
    );
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge: options.challenge,
      origin: o.origin ?? this.defaults.origin,
      crossOrigin: false,
    });

    this.keys.set(id, { id, privateKey, rpId, userHandle: options.user.id, counter: 0 });
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: b64u(Buffer.from(clientDataJSON)),
        attestationObject: b64u(attestationObject),
        transports: ['internal'],
        publicKeyAlgorithm: -7,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  // navigator.credentials.get()
  get(
    options: PublicKeyCredentialRequestOptionsJSON,
    o: CeremonyOverrides & { credentialId?: string; counter?: number } = {},
  ): AuthenticationResponseJSON {
    const allowed = options.allowCredentials?.map((c) => c.id) ?? [];
    const key =
      (o.credentialId && this.keys.get(o.credentialId)) ||
      [...this.keys.values()].find((k) => allowed.length === 0 || allowed.includes(k.id));
    if (!key) throw new Error('NotAllowedError: no matching credential on this authenticator');

    key.counter = o.counter ?? key.counter + 1;
    const rpId = o.rpId ?? key.rpId;
    const authData = Buffer.concat([sha256(rpId), Buffer.from([FLAG_UP | FLAG_UV]), u32(key.counter)]);
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: o.origin ?? this.defaults.origin, crossOrigin: false }),
    );
    // Signature over authenticatorData || SHA-256(clientDataJSON), ECDSA P-256 (DER).
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), key.privateKey);

    return {
      id: key.id,
      rawId: key.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: key.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  // Simulates an attacker extracting the private key and copying it to a second device.
  clone(): SoftAuthenticator {
    const copy = new SoftAuthenticator(this.defaults);
    for (const [id, k] of this.keys) copy.keys.set(id, { ...k });
    return copy;
  }
}
