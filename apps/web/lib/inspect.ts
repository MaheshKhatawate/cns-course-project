// Decodes the raw WebAuthn structures so the demo can show exactly what was signed.

export interface CeremonyInspection {
  kind: 'login' | 'registration';
  at: string;
  credentialId: string;
  clientData: { type: string; challenge: string; origin: string; crossOrigin?: boolean };
  authData: {
    rpIdHash: string;
    flags: { UP: boolean; UV: boolean; BE: boolean; BS: boolean; AT: boolean; ED: boolean };
    flagsByte: string;
    signCount: number;
  } | null;
  signature: string | null;
  userHandle: string | null;
  server?: Record<string, unknown>;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function parseAuthenticatorData(b64url: string) {
  const b = b64urlToBytes(b64url);
  if (b.length < 37) return null;
  const f = b[32];
  return {
    rpIdHash: hex(b.slice(0, 32)),
    flags: {
      UP: !!(f & 0x01), // user present
      UV: !!(f & 0x04), // user verified
      BE: !!(f & 0x08), // backup eligible (synced passkey)
      BS: !!(f & 0x10), // backed up
      AT: !!(f & 0x40), // attested credential data
      ED: !!(f & 0x80), // extensions
    },
    flagsByte: `0x${f.toString(16).padStart(2, '0')}`,
    signCount: new DataView(b.buffer, b.byteOffset + 33, 4).getUint32(0),
  };
}

export function inspectAssertion(
  resp: { id: string; response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string } },
  server?: Record<string, unknown>,
): CeremonyInspection {
  return {
    kind: 'login',
    at: new Date().toISOString(),
    credentialId: resp.id,
    clientData: JSON.parse(new TextDecoder().decode(b64urlToBytes(resp.response.clientDataJSON))),
    authData: parseAuthenticatorData(resp.response.authenticatorData),
    signature: hex(b64urlToBytes(resp.response.signature)),
    userHandle: resp.response.userHandle ?? null,
    server,
  };
}

export function inspectAttestation(
  resp: { id: string; response: { clientDataJSON: string; authenticatorData?: string } },
  server?: Record<string, unknown>,
): CeremonyInspection {
  return {
    kind: 'registration',
    at: new Date().toISOString(),
    credentialId: resp.id,
    clientData: JSON.parse(new TextDecoder().decode(b64urlToBytes(resp.response.clientDataJSON))),
    authData: resp.response.authenticatorData ? parseAuthenticatorData(resp.response.authenticatorData) : null,
    signature: null,
    userHandle: null,
    server,
  };
}

const KEY = 'lastCeremony';

export function saveCeremony(c: CeremonyInspection) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // storage unavailable: the inspector simply stays empty
  }
}

export function loadCeremony(): CeremonyInspection | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CeremonyInspection) : null;
  } catch {
    return null;
  }
}
