'use client';

import { useState } from 'react';
import Link from 'next/link';
import { startRegistration } from '@simplewebauthn/browser';
import { api, webauthnStatus } from '@/lib/api';
import { Alert } from '@/components/ui';

type RegOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('My laptop');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRecoveryCode(null);
    const w = webauthnStatus();
    if (!w.ok) {
      setError(w.reason ?? 'WebAuthn is not available.');
      return;
    }
    setBusy(true);
    try {
      const options = await api<RegOptions>('/api/auth/register-options', {
        method: 'POST',
        body: JSON.stringify({ username, displayName: displayName || undefined, deviceLabel }),
      });
      // Real browser WebAuthn ceremony — private key never leaves the authenticator.
      const attResp = await startRegistration({ optionsJSON: options });
      const result = await api<{ verified: boolean; recoveryCode?: string }>('/api/auth/register-verify', {
        method: 'POST',
        body: JSON.stringify({ username, attResp, deviceLabel }),
      });
      if (result.verified) setRecoveryCode(result.recoveryCode ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCode) {
    return (
      <div className="card mx-auto max-w-lg space-y-4">
        <h1 className="text-xl font-bold">Registration complete</h1>
        <Alert kind="success">Your passkey was registered. Only the public key was sent to the server.</Alert>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold">Your recovery code — save it now, it is shown only once:</p>
          <p className="mt-2 text-center text-xl font-mono font-bold tracking-widest">{recoveryCode}</p>
          <p className="mt-2 text-xs text-slate-600">
            You will need this code to register a replacement device if you lose all of your devices.
          </p>
        </div>
        <Link href="/login" className="btn-primary inline-block">Continue to login</Link>
      </div>
    );
  }

  return (
    <div className="card mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-bold">Register a passkey</h1>
      <p className="text-sm text-slate-600">
        Enter a username, then use your device authenticator (fingerprint, face, PIN, or security key).
        Your browser generates a key pair — the private key stays on your device.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={onRegister} className="space-y-3">
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input id="username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} autoComplete="username" />
        </div>
        <div>
          <label className="label" htmlFor="displayName">Display name (optional)</label>
          <input id="displayName" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="deviceLabel">Device label</label>
          <input id="deviceLabel" className="input" value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} placeholder="e.g. MacBook, Pixel 8" />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Waiting for your authenticator…' : 'Start WebAuthn registration'}
        </button>
      </form>
      <p className="text-sm text-slate-600">
        Already registered? <Link href="/login" className="underline">Log in</Link>
      </p>
    </div>
  );
}
