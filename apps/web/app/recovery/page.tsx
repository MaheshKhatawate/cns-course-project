'use client';

import { useState } from 'react';
import Link from 'next/link';
import { startRegistration } from '@simplewebauthn/browser';
import { errorMessage, post, webauthnStatus } from '@/lib/api';
import { Fingerprint, LifeBuoy } from 'lucide-react';
import { Alert, AuthCard, RecoveryCodeBox, Steps } from '@/components/ui';

type RegOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

export default function RecoveryPage() {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('Replacement device');
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ recoveryCode: string; revokedDevices: number } | null>(null);

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await post<{ recoveryToken: string }>('/api/recovery/verify', { username, recoveryCode: code });
      setRecoveryToken(res.recoveryToken);
    } catch (err) {
      setError(errorMessage(err, 'Recovery failed.'));
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
      const options = await post<RegOptions>('/api/recovery/register-options', { username, recoveryToken });
      const attResp = await startRegistration({ optionsJSON: options });
      const res = await post<{ recoveryCode: string; revokedDevices: number }>('/api/recovery/register-verify', {
        username,
        recoveryToken,
        attResp,
        deviceLabel,
        revokeOtherDevices: revokeOthers,
      });
      setDone(res);
    } catch (err) {
      setError(errorMessage(err, 'Could not register replacement device.'));
    } finally {
      setBusy(false);
    }
  }

  const step = done ? 3 : recoveryToken ? 1 : 0;

  return (
    <AuthCard
      icon={LifeBuoy}
      title="Account recovery"
      subtitle="Lost every device? Use the one-time recovery code you saved at registration to register a replacement passkey."
    >
      <Steps steps={['Verify code', 'New passkey', 'New code']} current={step} />
      {error && <Alert kind="error">{error}</Alert>}
      {done ? (
        <>
          <Alert kind="success">
            Replacement passkey registered and you are signed in.
            {done.revokedDevices > 0 && ` ${done.revokedDevices} old device(s) were revoked and their sessions ended.`} Your old recovery
            code no longer works. Here is your new one:
          </Alert>
          <RecoveryCodeBox code={done.recoveryCode} username={username.trim().toLowerCase()} />
          <Link href="/dashboard" className="btn-primary w-full">Go to dashboard</Link>
        </>
      ) : !recoveryToken ? (
        <form onSubmit={verifyCode} className="space-y-4">
          <div>
            <label className="label" htmlFor="username">Username</label>
            <input id="username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
          </div>
          <div>
            <label className="label" htmlFor="code">Recovery code</label>
            <input id="code" className="input text-center font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" />
          </div>
          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify recovery code'}
          </button>
          <p className="text-center text-xs text-slate-500">Attempts are rate-limited. The code stops working once it is used.</p>
        </form>
      ) : (
        <form onSubmit={registerReplacement} className="space-y-4">
          <Alert kind="success">Code verified (valid for 10 minutes). Now create a passkey on your new device.</Alert>
          <div>
            <label className="label" htmlFor="deviceLabel">Device name</label>
            <input id="deviceLabel" className="input" value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} required maxLength={64} />
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-white/70 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={revokeOthers} onChange={(e) => setRevokeOthers(e.target.checked)} />
            <span>
              Revoke all my existing devices and sessions
              <span className="block text-xs text-slate-500">Recommended if a device was lost or stolen.</span>
            </span>
          </label>
          <button className="btn-primary w-full py-3" disabled={busy}>
            <Fingerprint className="h-4 w-4" /> {busy ? 'Waiting for your authenticator…' : 'Register replacement passkey'}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
