// NFR "Performance": cryptographic operations must complete in < 1 s.
// Measures the real code paths (software ES256 authenticator + SimpleWebAuthn
// verification) without a database.  Usage: npm run bench
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { SoftAuthenticator } from '../src/security/softAuthenticator.js';

const ORIGIN = 'http://localhost:3000';
const RP_ID = 'localhost';
const N = Number(process.argv[2] ?? 200);

async function time<T>(fn: () => Promise<T> | T): Promise<[T, number]> {
  const t = performance.now();
  const v = await fn();
  return [v, performance.now() - t];
}

function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const pct = (p: number) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { mean: s.reduce((a, b) => a + b, 0) / s.length, p50: pct(50), p95: pct(95), max: s[s.length - 1] };
}

async function main() {
  const rows: Record<string, number[]> = {
    'Key-pair generation + attestation (client)': [],
    'Registration verification (server)': [],
    'Challenge signing (client)': [],
    'Signature verification (server)': [],
  };
  for (let i = 0; i < N; i++) {
    const auth = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
    const regOpts = await generateRegistrationOptions({ rpName: 'bench', rpID: RP_ID, userName: `u${i}`, attestationType: 'none' });
    const [att, t1] = await time(() => auth.create(regOpts));
    const [reg, t2] = await time(() => verifyRegistrationResponse({ response: att, expectedChallenge: regOpts.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID }));
    const authOpts = await generateAuthenticationOptions({ rpID: RP_ID });
    const [assertion, t3] = await time(() => auth.get(authOpts));
    const [, t4] = await time(() =>
      verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: authOpts.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: reg.registrationInfo!.credential,
      }),
    );
    rows['Key-pair generation + attestation (client)'].push(t1);
    rows['Registration verification (server)'].push(t2);
    rows['Challenge signing (client)'].push(t3);
    rows['Signature verification (server)'].push(t4);
  }
  console.log(`\nES256 WebAuthn crypto benchmark (${N} iterations, Node ${process.version})\n`);
  console.log('Operation'.padEnd(46) + 'mean ms'.padStart(9) + 'p50'.padStart(9) + 'p95'.padStart(9) + 'max'.padStart(9) + '   < 1 s?');
  let ok = true;
  for (const [name, samples] of Object.entries(rows)) {
    const s = stats(samples);
    ok &&= s.max < 1000;
    console.log(name.padEnd(46) + [s.mean, s.p50, s.p95, s.max].map((v) => v.toFixed(2).padStart(9)).join('') + `   ${s.max < 1000 ? 'yes' : 'NO'}`);
  }
  const verifyMean = stats(rows['Signature verification (server)']).mean;
  console.log(`\n≈ ${Math.round(1000 / verifyMean)} login verifications per second per CPU core.\n`);
  process.exit(ok ? 0 : 1);
}

main();
