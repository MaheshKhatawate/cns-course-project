'use client';

import { useState } from 'react';
import Link from 'next/link';
import { startRegistration } from '@simplewebauthn/browser';
import { api, webauthnStatus } from '@/lib/api';
import { Alert } from '@/components/ui';

type RegOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

export default function RecoveryPage() {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('Replacement device');
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ recoveryToken: string }>('/api/recovery/verify', {
        method: 'POST',
        body: JSON.stringify({ username, recoveryCode: code }),
      });
      setRecoveryToken(res.recoveryToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery failed.');
    } finally {
      setBusy(false);
    }
  }

  async function registerReplacement(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const w = webauthnStatus();
    if (!w.ok) {
      setError(w.reason ?? 'WebAuthn is not available.');
      return;
    }
    setBusy(true);
    try {
      const options = await api<RegOptions>('/api/recovery/register-options', {
        method: 'POST',
        body: JSON.stringify({ username, recoveryToken }),
      });
      const attResp = await startRegistration({ optionsJSON: options });
      await api('/api/recovery/register-verify', {
        method: 'POST',
        body: JSON.stringify({ username, recoveryToken, attResp, deviceLabel }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register replacement device.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-bold">Account recovery</h1>
      <Alert kind="info">
        Basic academic recovery: the one-time code shown at registration lets you register a
        replacement passkey. This is not a production-grade social recovery system.
      </Alert>
      {error && <Alert kind="error">{error}</Alert>}
      {done ? (
        <>
          <Alert kind="success">Replacement device registered. You can now log in.</Alert>
          <Link href="/login" className="btn-primary inline-block">Go to login</Link>
        </>
      ) : !recoveryToken ? (
        <form onSubmit={verifyCode} className="space-y-3">
          <div>
            <label className="label" htmlFor="username">Username</label>
            <input id="username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="code">Recovery code</label>
            <input id="code" className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="XXXX-XXXX-XXXX-XXXX" />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify recovery code'}
          </button>
        </form>
      ) : (
        <form onSubmit={registerReplacement} className="space-y-3">
          <Alert kind="success">Code verified (valid for 10 minutes). Now register a replacement passkey.</Alert>
          <div>
            <label className="label" htmlFor="deviceLabel">Device label</label>
            <input id="deviceLabel" className="input" value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} required />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Waiting for your authenticator…' : 'Register replacement passkey'}
          </button>
        </form>
      )}
    </div>
  );
}
