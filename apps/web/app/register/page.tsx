'use client';

import { useState } from 'react';
import Link from 'next/link';
import { startRegistration } from '@simplewebauthn/browser';
import { errorMessage, post, webauthnStatus } from '@/lib/api';
import { inspectAttestation, saveCeremony } from '@/lib/inspect';
import { Fingerprint, PartyPopper } from 'lucide-react';
import { Alert, AuthCard, RecoveryCodeBox, Steps } from '@/components/ui';

type RegOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

interface RegisterResult {
  verified: boolean;
  user: { username: string; displayName: string };
  recoveryCode: string;
  credential: { deviceLabel: string; algorithm: number | null; deviceType: string | null };
}

const ALG: Record<number, string> = { [-7]: 'ES256 (ECDSA P-256)', [-8]: 'EdDSA (Ed25519)', [-257]: 'RS256 (RSA)' };

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('My laptop');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [saved, setSaved] = useState(false);

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const w = webauthnStatus();
    if (!w.ok) {
      setError(w.reason ?? 'WebAuthn is not available.');
      return;
    }
    setBusy(true);
    try {
      // 1. Server returns a random challenge + RP info (no account is created yet).
      const options = await post<RegOptions>('/api/auth/register-options', {
        username,
        displayName: displayName || undefined,
      });
      // 2. Authenticator generates a new key pair; the private key never leaves it.
      const attResp = await startRegistration({ optionsJSON: options });
      // 3. Server verifies the attestation and stores only the public key.
      const res = await post<RegisterResult>('/api/auth/register-verify', { username, attResp, deviceLabel });
      saveCeremony(inspectAttestation(attResp, { algorithm: res.credential.algorithm, deviceType: res.credential.deviceType }));
      setResult(res);
    } catch (err) {
      setError(errorMessage(err, 'Registration failed.'));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <AuthCard icon={PartyPopper} title="You're all set" subtitle={<>Welcome, {result.user.displayName}. You are signed in.</>}>
        <Steps steps={['Account', 'Key pair', 'Recovery code']} current={2} />
        <Alert kind="success">
          A new key pair was created on <strong>{result.credential.deviceLabel}</strong>
          {result.credential.algorithm != null && <> using {ALG[result.credential.algorithm] ?? `COSE alg ${result.credential.algorithm}`}</>}.
          Only the public key was sent to the server.
        </Alert>
        <RecoveryCodeBox code={result.recoveryCode} username={result.user.username} />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I have saved my recovery code somewhere safe.
        </label>
        {saved ? (
          <Link href="/dashboard" className="btn-primary w-full">Continue to dashboard</Link>
        ) : (
          <button className="btn-primary w-full" disabled>Continue to dashboard</button>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={Fingerprint}
      title="Create your passkey"
      subtitle="Your device generates a public/private key pair after a fingerprint, face or PIN check. No password is ever created."
    >
      <Steps steps={['Account', 'Key pair', 'Recovery code']} current={busy ? 1 : 0} />
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={onRegister} className="space-y-4">
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={64}
            pattern="[a-zA-Z0-9._\-]+"
            title="3–64 letters, numbers, dots, underscores or dashes"
            autoComplete="username webauthn"
            placeholder="e.g. mahesh"
          />
        </div>
        <div>
          <label className="label" htmlFor="displayName">Display name <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="displayName" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} placeholder="Mahesh Khatawate" />
        </div>
        <div>
          <label className="label" htmlFor="deviceLabel">Name this device</label>
          <input id="deviceLabel" className="input" value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} placeholder="e.g. MacBook, Pixel 8" required maxLength={64} />
        </div>
        <button className="btn-primary w-full py-3" disabled={busy}>
          <Fingerprint className="h-4 w-4" /> {busy ? 'Waiting for your authenticator…' : 'Create passkey'}
        </button>
      </form>
      <p className="text-center text-sm text-slate-600">
        Already registered? <Link href="/login" className="font-medium text-indigo-600 hover:underline">Log in</Link>
      </p>
    </AuthCard>
  );
}
